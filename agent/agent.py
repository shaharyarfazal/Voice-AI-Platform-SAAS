"""Voice agent worker.

LiveKit dispatches one job per call (phone via SIP, or browser test call). The job looks up
the agent configuration from the web API, runs a cascaded STT -> LLM -> TTS pipeline, and
reports the call (duration, transcript, outcome) back to the web API when it ends.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from livekit import api, rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    CloseEvent,
    JobContext,
    JobProcess,
    RunContext,
    function_tool,
    get_job_context,
)
from livekit.plugins import cartesia, deepgram, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv()

logger = logging.getLogger("voice-agent")

AGENT_NAME = os.environ.get("AGENT_NAME", "voice-agent")
WEB_API_URL = os.environ.get("WEB_API_URL", "http://localhost:3000").rstrip("/")
INTERNAL_API_TOKEN = os.environ["INTERNAL_API_TOKEN"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def fetch_agent_config(*, agent_id: str | None, called_number: str | None) -> dict | None:
    params = {"agentId": agent_id} if agent_id else {"number": called_number or ""}
    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.get(
            f"{WEB_API_URL}/api/internal/agent-config",
            params=params,
            headers={"authorization": f"Bearer {INTERNAL_API_TOKEN}"},
        )
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json()


async def report_call(payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{WEB_API_URL}/api/internal/calls",
                json=payload,
                headers={"authorization": f"Bearer {INTERNAL_API_TOKEN}"},
            )
            res.raise_for_status()
    except Exception:
        logger.exception("failed to report call %s", payload.get("roomName"))


class Receptionist(Agent):
    def __init__(self, config: dict, caller: rtc.RemoteParticipant) -> None:
        super().__init__(instructions=config["systemPrompt"])
        self._config = config
        self._caller = caller

    @function_tool()
    async def end_call(self, context: RunContext) -> None:
        """End the call. Use when the caller says goodbye or the conversation is finished."""
        await context.wait_for_playout()
        context.session.userdata["outcome"] = "completed"
        get_job_context().delete_room()

    @function_tool()
    async def transfer_to_human(self, context: RunContext) -> str:
        """Transfer the caller to a human. Use when the caller asks for a person or you cannot help.
        Tell the caller you are transferring them before calling this."""
        transfer_number = self._config.get("transferNumber")
        if not transfer_number:
            return "Transfers are not available. Offer to take a message instead."
        if self._caller.kind != rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            return "This is a browser call and cannot be transferred. Offer to take a message instead."

        await context.wait_for_playout()
        job = get_job_context()
        await job.api.sip.transfer_sip_participant(
            api.TransferSIPParticipantRequest(
                room_name=job.room.name,
                participant_identity=self._caller.identity,
                transfer_to=f"tel:{transfer_number}",
            )
        )
        context.session.userdata["outcome"] = "transferred"
        return "The caller has been transferred."


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    caller = await ctx.wait_for_participant()

    # Browser test calls carry the agent id in the dispatch metadata; phone calls are routed
    # by the number that was dialled.
    metadata = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
    called_number = caller.attributes.get("sip.trunkPhoneNumber")
    caller_number = caller.attributes.get("sip.phoneNumber")
    channel = "phone" if caller.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP else "web"

    config = await fetch_agent_config(agent_id=metadata.get("agentId"), called_number=called_number)
    if config is None:
        logger.warning("no agent configured for number=%s agent=%s", called_number, metadata.get("agentId"))
        ctx.delete_room()
        return

    started_at = _now()
    transcript: list[dict] = []

    session: AgentSession = AgentSession(
        userdata={"outcome": "caller_hung_up"},
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(model=config.get("sttModel") or "nova-3", language=config.get("language") or "en-US"),
        llm=openai.LLM(model=config.get("llmModel") or "gpt-4.1-mini"),
        tts=cartesia.TTS(model=config.get("ttsModel") or "sonic-3", voice=config["voiceId"]),
        turn_handling={"turn_detection": MultilingualModel()},
    )

    @session.on("conversation_item_added")
    def _on_item(event) -> None:
        item = event.item
        if getattr(item, "type", None) == "message" and item.role in ("user", "assistant") and item.text_content:
            transcript.append({"role": item.role, "text": item.text_content, "at": _now()})

    async def _on_shutdown(reason: str) -> None:
        logger.info("call ended", extra={"room": ctx.room.name, "reason": reason, "turns": len(transcript)})
        await report_call(
            {
                "roomName": ctx.room.name,
                "agentId": config["id"],
                "channel": channel,
                "fromNumber": caller_number,
                "toNumber": called_number,
                "startedAt": started_at,
                "endedAt": _now(),
                "outcome": session.userdata.get("outcome", "caller_hung_up"),
                "transcript": transcript,
            }
        )

    ctx.add_shutdown_callback(_on_shutdown)

    # The session closes when the caller hangs up or a provider fails for good. End the job then,
    # so the call is reported right away, and hang up so a phone caller isn't left on a silent line.
    async def _end_call(reason: str) -> None:
        try:
            await ctx.delete_room()
        finally:
            ctx.shutdown(reason=reason)

    @session.on("close")
    def _on_close(event: CloseEvent) -> None:
        if event.error is not None:
            logger.error("session failed", extra={"room": ctx.room.name, "error": str(event.error)})
            session.userdata["outcome"] = "error"
        asyncio.create_task(_end_call(event.reason.value))

    await session.start(agent=Receptionist(config, caller), room=ctx.room)
    await session.say(config["greeting"], allow_interruptions=True)
