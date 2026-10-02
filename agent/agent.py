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
    ErrorEvent,
    JobContext,
    JobProcess,
    RunContext,
    function_tool,
    get_job_context,
)
from livekit.agents.llm import FallbackAdapter
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


async def report_call_started(payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{WEB_API_URL}/api/internal/calls/start",
                json=payload,
                headers={"authorization": f"Bearer {INTERNAL_API_TOKEN}"},
            )
    except Exception:
        logger.warning("failed to report call start for %s", payload.get("roomName"))


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


def build_llm(model: str):
    """The tenant's OpenAI model, plus an optional backup on any OpenAI-compatible provider
    (Groq, Gemini, OpenRouter...) that takes over if OpenAI fails mid-call."""
    primary = openai.LLM(model=model)
    base_url = os.environ.get("FALLBACK_LLM_BASE_URL")
    api_key = os.environ.get("FALLBACK_LLM_API_KEY")
    fallback_model = os.environ.get("FALLBACK_LLM_MODEL")
    if not (base_url and api_key and fallback_model):
        return primary
    return FallbackAdapter([primary, openai.LLM(model=fallback_model, base_url=base_url, api_key=api_key)])


def summarize_usage(session: AgentSession) -> dict:
    """Provider usage for the call, used to estimate its cost."""
    totals = {"sttSeconds": 0.0, "llmInputTokens": 0, "llmOutputTokens": 0, "ttsCharacters": 0}
    try:
        for usage in session.usage.model_usage:
            if usage.type == "stt_usage":
                totals["sttSeconds"] += usage.audio_duration
            elif usage.type == "llm_usage":
                totals["llmInputTokens"] += usage.input_tokens
                totals["llmOutputTokens"] += usage.output_tokens
            elif usage.type == "tts_usage":
                totals["ttsCharacters"] += usage.characters_count
    except Exception:
        logger.exception("could not read session usage")
    totals["sttSeconds"] = round(totals["sttSeconds"], 1)
    return totals


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
        # Unknown number, suspended tenant or minute limit reached: hang up before any AI cost.
        logger.warning("call rejected for number=%s agent=%s", called_number, metadata.get("agentId"))
        ctx.delete_room()
        return

    started_at = _now()
    transcript: list[dict] = []
    # Keep a reference so the task isn't garbage-collected before it finishes.
    start_report = asyncio.create_task(
        report_call_started(
            {"roomName": ctx.room.name, "agentId": config["id"], "channel": channel, "fromNumber": caller_number}
        )
    )

    session: AgentSession = AgentSession(
        userdata={"outcome": "caller_hung_up"},
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(model=config.get("sttModel") or "nova-3", language=config.get("language") or "en-US"),
        llm=build_llm(config.get("llmModel") or "gpt-4.1-mini"),
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
        await asyncio.gather(start_report, return_exceptions=True)  # end must not land before start
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
                "usage": summarize_usage(session),
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

    # When a provider fails for good, apologise (if text-to-speech still works) and hang up,
    # instead of leaving the caller in silence.
    apologising = False
    tts_failed = False

    async def _apologise_and_hang_up() -> None:
        try:
            handle = session.say(config["apologyMessage"], allow_interruptions=False, add_to_chat_ctx=False)
            await asyncio.wait_for(handle.wait_for_playout(), timeout=15)
        except Exception:
            logger.exception("could not play the apology")
        finally:
            await _end_call("error")

    @session.on("error")
    def _on_error(event: ErrorEvent) -> None:
        nonlocal apologising, tts_failed
        error = event.error
        if getattr(error, "recoverable", True) or apologising:
            return
        logger.error("provider failed", extra={"room": ctx.room.name, "error": str(error)})
        session.userdata["outcome"] = "error"
        if getattr(error, "type", None) == "tts_error":
            tts_failed = True
        if tts_failed:
            return  # can't speak: let the session close and hang up
        apologising = True
        error.recoverable = True  # keep the session open long enough to apologise
        asyncio.create_task(_apologise_and_hang_up())

    @session.on("close")
    def _on_close(event: CloseEvent) -> None:
        if event.error is not None:
            logger.error("session failed", extra={"room": ctx.room.name, "error": str(event.error)})
            session.userdata["outcome"] = "error"
        asyncio.create_task(_end_call(event.reason.value))

    await session.start(agent=Receptionist(config, caller), room=ctx.room)
    await session.say(config["greeting"], allow_interruptions=True)
