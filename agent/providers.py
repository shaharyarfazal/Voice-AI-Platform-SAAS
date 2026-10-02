"""Speech-to-text, LLM and text-to-speech from a provider chain.

The web app sends, per role, an ordered list of {provider, model, voice}: the agent's choice first,
then every other provider with an API key. More than one entry becomes a FallbackAdapter, so a
provider outage switches to the next one mid-call instead of dropping the call.
"""

from __future__ import annotations

import logging
import os

from livekit.agents import llm, stt, tts
from livekit.agents.llm import FallbackAdapter as LLMFallback
from livekit.plugins import anthropic, assemblyai, cartesia, deepgram, elevenlabs, google, groq, openai

logger = logging.getLogger("voice-agent.providers")

ENV_KEYS = {
    "stt": {"deepgram": "DEEPGRAM_API_KEY", "assemblyai": "ASSEMBLYAI_API_KEY", "openai": "OPENAI_API_KEY"},
    "llm": {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "google": "GOOGLE_API_KEY",
        "groq": "GROQ_API_KEY",
        "custom": "FALLBACK_LLM_API_KEY",
    },
    "tts": {
        "cartesia": "CARTESIA_API_KEY",
        "elevenlabs": "ELEVEN_API_KEY",
        "openai": "OPENAI_API_KEY",
        "deepgram": "DEEPGRAM_API_KEY",
    },
}


def available_providers() -> dict[str, list[str]]:
    """Providers whose API key is set on this worker."""
    out = {role: [p for p, key in keys.items() if os.environ.get(key)] for role, keys in ENV_KEYS.items()}
    if not (os.environ.get("FALLBACK_LLM_BASE_URL") and os.environ.get("FALLBACK_LLM_MODEL")):
        out["llm"] = [p for p in out["llm"] if p != "custom"]
    return out


def base_language(language: str) -> str:
    """'en-US' -> 'en', 'es-419' -> 'es', 'multi' stays 'multi'."""
    return language.split("-")[0]


def _make_stt(choice: dict, language: str, isolate_voice: bool = False):
    provider, model = choice["provider"], choice.get("model") or ""
    multi = language == "multi"
    if provider == "deepgram":
        # "multi" (code-switching) needs nova-3.
        return deepgram.STT(model="nova-3" if multi else (model or "nova-3"), language=language)
    if provider == "assemblyai":
        # Universal-3 Pro is multilingual; a language code steers it. In noisy mode, voice focus
        # suppresses speech that isn't close to the phone (background voices).
        kwargs: dict = {"model": model or "universal-3-6-pro"}
        if not multi:
            kwargs["language_codes"] = base_language(language)
        if isolate_voice and kwargs["model"] in ("u3-rt-pro", "universal-3-5-pro", "universal-3-6-pro"):
            kwargs["voice_focus"] = "near-field"
        return assemblyai.STT(**kwargs)
    if provider == "openai":
        if multi:
            return openai.STT(model=model or "gpt-4o-mini-transcribe", detect_language=True)
        return openai.STT(model=model or "gpt-4o-mini-transcribe", language=base_language(language))
    raise ValueError(f"unknown STT provider {provider}")


def _make_llm(choice: dict):
    provider, model = choice["provider"], choice.get("model") or ""
    if provider == "openai":
        return openai.LLM(model=model or "gpt-4.1-mini")
    if provider == "anthropic":
        return anthropic.LLM(model=model or "claude-haiku-4-5")
    if provider == "google":
        return google.LLM(model=model or "gemini-2.5-flash")
    if provider == "groq":
        return groq.LLM(model=model or "llama-3.3-70b-versatile")
    raise ValueError(f"unknown LLM provider {provider}")


def _make_tts(choice: dict, language: str):
    provider, model, voice = choice["provider"], choice.get("model") or "", choice.get("voice") or ""
    lang = None if language == "multi" else base_language(language)
    if provider == "cartesia":
        kwargs = {"model": model or "sonic-3", "language": lang or "en"}
        if voice:
            kwargs["voice"] = voice
        return cartesia.TTS(**kwargs)
    if provider == "elevenlabs":
        kwargs = {"model": model or "eleven_flash_v2_5"}
        if voice:
            kwargs["voice_id"] = voice
        if lang:
            kwargs["language"] = lang
        return elevenlabs.TTS(**kwargs)
    if provider == "openai":
        return openai.TTS(model=model or "gpt-4o-mini-tts", voice=voice or "ash")
    if provider == "deepgram":
        return deepgram.TTS(model=model or "aura-2-andromeda-en")
    raise ValueError(f"unknown TTS provider {provider}")


def _build(role: str, chain: list[dict], factory) -> list:
    built = []
    for choice in chain:
        try:
            built.append(factory(choice))
        except Exception:
            logger.exception("skipping %s provider %s", role, choice.get("provider"))
    if not built:
        raise RuntimeError(f"no usable {role} provider (check the API keys in infra/.env)")
    return built


def build_stt(chain: list[dict], language: str, vad, *, isolate_voice: bool = False) -> stt.STT:
    items = _build("stt", chain, lambda c: _make_stt(c, language, isolate_voice))
    return items[0] if len(items) == 1 else stt.FallbackAdapter(items, vad=vad)


def build_llm(chain: list[dict]) -> llm.LLM:
    items = _build("llm", chain, _make_llm)
    # An optional OpenAI-compatible backup (Groq, OpenRouter, a self-hosted model...) goes last.
    base_url, api_key, model = (os.environ.get(k) for k in ("FALLBACK_LLM_BASE_URL", "FALLBACK_LLM_API_KEY", "FALLBACK_LLM_MODEL"))
    if base_url and api_key and model:
        items.append(openai.LLM(model=model, base_url=base_url, api_key=api_key))
    return items[0] if len(items) == 1 else LLMFallback(items)


def build_tts(chain: list[dict], language: str) -> tts.TTS:
    items = _build("tts", chain, lambda c: _make_tts(c, language))
    return items[0] if len(items) == 1 else tts.FallbackAdapter(items)
