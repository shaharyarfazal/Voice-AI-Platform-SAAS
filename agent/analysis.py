"""Post-call analysis: a summary, the caller's sentiment, whether the call succeeded, and any
custom fields the client asked for, extracted by the LLM from the transcript."""

from __future__ import annotations

import json
import logging
import re

from livekit.agents import llm

logger = logging.getLogger("voice-agent.analysis")

SENTIMENTS = ("positive", "neutral", "negative", "unknown")
CASTS = {"string": str, "number": (int, float), "boolean": bool}


def _prompt(transcript: list[dict], success_criteria: str, fields: list[dict]) -> str:
    lines = "\n".join(
        f"{'Caller' if t['role'] == 'user' else 'Agent' if t['role'] == 'assistant' else 'Tool'}: {t['text']}"
        for t in transcript
    )
    custom = "\n".join(f'  "{f["name"]}": {f["type"]} or null. {f["description"]}' for f in fields) or "  (none)"
    criteria = success_criteria.strip() or "The caller's request was handled or they got what they called for."
    return (
        "Analyse this phone call between an AI agent and a caller. Reply with one JSON object only, no other text:\n"
        "{\n"
        '  "summary": two or three sentences on what the caller wanted and what happened,\n'
        '  "user_sentiment": "positive", "neutral" or "negative",\n'
        '  "call_successful": true or false,\n'
        '  "custom_data": an object with these keys (null if the call doesn\'t say):\n'
        f"{custom}\n"
        "}\n\n"
        f"A call is successful when: {criteria}\n\n"
        f"Transcript:\n{lines}"
    )


def _parse(text: str, fields: list[dict]) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    data = json.loads(match.group(0)) if match else {}
    custom_in = data.get("custom_data") if isinstance(data.get("custom_data"), dict) else {}
    custom = {}
    for f in fields:
        value = custom_in.get(f["name"])
        ok = value is None or (isinstance(value, CASTS[f["type"]]) and not (f["type"] == "number" and isinstance(value, bool)))
        custom[f["name"]] = value if ok else None
    sentiment = data.get("user_sentiment")
    successful = data.get("call_successful")
    return {
        "summary": str(data.get("summary") or "")[:5000],
        "user_sentiment": sentiment if sentiment in SENTIMENTS else "unknown",
        "call_successful": successful if isinstance(successful, bool) else None,
        "custom_data": custom,
    }


def empty_analysis(fields: list[dict], summary: str = "") -> dict:
    return {
        "summary": summary,
        "user_sentiment": "unknown",
        "call_successful": None,
        "custom_data": {f["name"]: None for f in fields},
    }


async def analyse_call(model: llm.LLM, transcript: list[dict], success_criteria: str, fields: list[dict]) -> dict:
    if not any(t["role"] == "user" for t in transcript):
        return empty_analysis(fields, "The caller didn't say anything.")
    ctx = llm.ChatContext()
    ctx.add_message(role="user", content=_prompt(transcript, success_criteria, fields))
    text = ""
    async with model.chat(chat_ctx=ctx) as stream:
        async for chunk in stream:
            if chunk.delta and chunk.delta.content:
                text += chunk.delta.content
    try:
        return _parse(text, fields)
    except (ValueError, TypeError):
        logger.warning("analysis was not valid JSON")
        return empty_analysis(fields)
