"""Voice agent worker.

LiveKit dispatches one job per call (phone via SIP, or browser test call). The job loads the agent's
configuration from the web API (providers, tools, guardrails), runs a speech-to-text -> LLM ->
text-to-speech pipeline with automatic provider fallback, and reports the call when it ends.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import AsyncIterable
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    CloseEvent,
    ErrorEvent,
    JobContext,
    JobProcess,
    ModelSettings,
)
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from providers import available_providers, build_llm, build_stt, build_tts
from tools import build_mcp_servers, build_tools, describe_args

load_dotenv()

logger = logging.getLogger("voice-agent")

AGENT_NAME = os.environ.get("AGENT_NAME", "voice-agent")
WEB_API_URL = os.environ.get("WEB_API_URL", "http://localhost:3000").rstrip("/")
INTERNAL_API_TOKEN = os.environ["INTERNAL_API_TOKEN"]
AUTH = {"authorization": f"Bearer {INTERNAL_API_TOKEN}"}
STILL_THERE = "Are you still there?"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def fetch_agent_config(*, agent_id: str | None, called_number: str | None) -> dict | None:
    params = {"agentId": agent_id} if agent_id else {"number": called_number or ""}
    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.get(f"{WEB_API_URL}/api/internal/agent-config", params=params, headers=AUTH)
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json()


async def _post(path: str, payload: dict, timeout: float = 10.0) -> None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{WEB_API_URL}{path}", json=payload, headers=AUTH)
            res.raise_for_status()
    except Exception:
        logger.exception("request to %s failed", path)


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


def date_context(tz_name: str) -> str:
    """The model doesn't know today's date; booking needs it."""
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz, tz_name = ZoneInfo("UTC"), "UTC"
    now = datetime.now(tz)
    return f"Today is {now:%A, %B %-d, %Y} and the time is {now:%-I:%M %p} ({tz_name})."


def phrase_filter(phrases: list[str]):
    """Removes blocked phrases from what the agent says, even when a phrase spans streamed chunks."""
    words = [p.strip() for p in phrases if p.strip()]
    if not words:
        return None
    pattern = re.compile("|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)), re.IGNORECASE)
    longest = max(len(w) for w in words)

    async def apply(text: AsyncIterable[str]) -> AsyncIterable[str]:
        buffer = ""
        async for chunk in text:
            buffer = pattern.sub("", buffer + chunk)
            # Hold back enough of the tail to catch a phrase that continues in the next chunk.
            if len(buffer) > longest:
                ready, buffer = buffer[:-longest], buffer[-longest:]
                yield ready
        if buffer:
            yield pattern.sub("", buffer)

    return apply


class Receptionist(Agent):
    def __init__(self, *, instructions: str, tools: list, mcp_servers: list, blocked_phrases: list[str]) -> None:
        super().__init__(instructions=instructions, tools=tools, mcp_servers=mcp_servers or None)
        self._filter = phrase_filter(blocked_phrases)

    def tts_node(self, text: AsyncIterable[str], model_settings: ModelSettings):
        if self._filter:
            text = self._filter(text)
        return Agent.default.tts_node(self, text, model_settings)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()
    # Tell the dashboard which providers have API keys, so it only offers those.
    try:
        httpx.post(
            f"{WEB_API_URL}/api/internal/worker", json={"providers": available_providers()}, headers=AUTH, timeout=5.0
        )
    except Exception:
        logger.warning("could not report providers to the web app")


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
    userdata: dict = {"outcome": "caller_hung_up"}
    start_report = asyncio.create_task(
        _post(
            "/api/internal/calls/start",
            {"roomName": ctx.room.name, "agentId": config["id"], "channel": channel, "fromNumber": caller_number},
            timeout=5.0,
        )
    )

    def log_tool(name: str, args: dict, result: str) -> None:
        transcript.append({"role": "tool", "text": f"{name}({describe_args(args)}) → {result[:500]}", "at": _now()})

    providers = config.get("providers") or {}
    language = config.get("language") or "en-US"
    guardrails = config.get("guardrails") or {}
    vad = ctx.proc.userdata["vad"]
    # Agent configs from before provider chains name a single OpenAI model and Cartesia voice.
    stt_chain = providers.get("stt") or [{"provider": "deepgram", "model": "nova-3"}]
    llm_chain = providers.get("llm") or [{"provider": "openai", "model": config.get("llmModel") or "gpt-4.1-mini"}]
    tts_chain = providers.get("tts") or [{"provider": "cartesia", "model": "sonic-3", "voice": config.get("voiceId")}]

    session: AgentSession = AgentSession(
        userdata=userdata,
        vad=vad,
        stt=build_stt(stt_chain, language, vad),
        llm=build_llm(llm_chain),
        tts=build_tts(tts_chain, language),
        turn_handling={"turn_detection": MultilingualModel()},
        user_away_timeout=float(guardrails.get("silenceTimeoutSeconds") or 20),
        max_tool_steps=4,
    )

    @session.on("conversation_item_added")
    def _on_item(event) -> None:
        item = event.item
        if getattr(item, "type", None) == "message" and item.role in ("user", "assistant") and item.text_content:
            transcript.append({"role": item.role, "text": item.text_content, "at": _now()})

    async def _on_shutdown(reason: str) -> None:
        logger.info("call ended", extra={"room": ctx.room.name, "reason": reason, "turns": len(transcript)})
        await asyncio.gather(start_report, return_exceptions=True)  # end must not land before start
        await _post(
            "/api/internal/calls",
            {
                "roomName": ctx.room.name,
                "agentId": config["id"],
                "channel": channel,
                "fromNumber": caller_number,
                "toNumber": called_number,
                "startedAt": started_at,
                "endedAt": _now(),
                "outcome": userdata.get("outcome", "caller_hung_up"),
                "transcript": transcript,
                "usage": summarize_usage(session),
            },
        )

    ctx.add_shutdown_callback(_on_shutdown)

    async def _end_call(reason: str) -> None:
        try:
            await ctx.delete_room()
        finally:
            ctx.shutdown(reason=reason)

    async def _say_and_hang_up(text: str, reason: str) -> None:
        try:
            handle = session.say(text, allow_interruptions=False, add_to_chat_ctx=False)
            await asyncio.wait_for(handle.wait_for_playout(), timeout=15)
        except Exception:
            logger.exception("could not play the closing message")
        finally:
            await _end_call(reason)

    # Guardrail: provider failure. Apologise (if text-to-speech still works) and hang up.
    apologising = False
    tts_failed = False

    @session.on("error")
    def _on_error(event: ErrorEvent) -> None:
        nonlocal apologising, tts_failed
        error = event.error
        if getattr(error, "recoverable", True) or apologising:
            return
        logger.error("provider failed", extra={"room": ctx.room.name, "error": str(error)})
        userdata["outcome"] = "error"
        if getattr(error, "type", None) == "tts_error":
            tts_failed = True
        if tts_failed:
            # Every voice provider failed, so nothing can be said: hang up now rather than leave
            # the caller in silence while the session retries.
            apologising = True
            asyncio.create_task(_end_call("error"))
            return
        apologising = True
        error.recoverable = True  # keep the session open long enough to apologise
        asyncio.create_task(_say_and_hang_up(config["apologyMessage"], "error"))

    # Guardrail: silence. Ask once, then hang up if the caller stays silent.
    asked_if_there = False

    @session.on("user_state_changed")
    def _on_user_state(event) -> None:
        nonlocal asked_if_there
        if event.new_state != "away" or apologising:
            return
        if not asked_if_there:
            asked_if_there = True
            session.say(STILL_THERE, add_to_chat_ctx=False)
        else:
            userdata["outcome"] = "silence_timeout"
            asyncio.create_task(_say_and_hang_up("I'll let you go now. Feel free to call back any time. Goodbye.", "silence"))

    @session.on("user_input_transcribed")
    def _on_user_spoke(_event) -> None:
        nonlocal asked_if_there
        asked_if_there = False

    # Guardrail: maximum call length.
    async def _time_limit(seconds: float) -> None:
        await asyncio.sleep(seconds)
        userdata["outcome"] = "time_limit"
        await _say_and_hang_up("We've reached the time limit for this call. Thank you for calling, goodbye.", "time_limit")

    time_limit = asyncio.create_task(_time_limit(float(guardrails.get("maxCallSeconds") or 900)))

    async def _stop_time_limit() -> None:
        time_limit.cancel()

    ctx.add_shutdown_callback(_stop_time_limit)

    @session.on("close")
    def _on_close(event: CloseEvent) -> None:
        if event.error is not None:
            logger.error("session failed", extra={"room": ctx.room.name, "error": str(event.error)})
            userdata["outcome"] = "error"
        asyncio.create_task(_end_call(event.reason.value))

    tools = build_tools(
        config,
        caller=caller,
        room_name=ctx.room.name,
        caller_number=caller_number,
        session_userdata=userdata,
        log_tool=log_tool,
    )
    instructions = f"{config['systemPrompt']}\n\n## Today\n- {date_context(config.get('timezone') or 'UTC')}"
    agent = Receptionist(
        instructions=instructions,
        tools=tools,
        mcp_servers=build_mcp_servers(config),
        blocked_phrases=guardrails.get("blockedPhrases") or [],
    )
    await session.start(agent=agent, room=ctx.room)
    await session.say(config["greeting"], allow_interruptions=True)
