import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDERS, providerChain, resolveProviders } from "../lib/catalog.ts";

test("primary first, then other providers with keys as fallbacks", () => {
  const chain = providerChain("llm", { provider: "anthropic", model: "claude-haiku-4-5" }, ["openai", "anthropic", "groq"], "en-US");
  assert.deepEqual(chain.map((c) => c.provider), ["anthropic", "openai", "groq"]);
  assert.equal(chain[1].model, "gpt-4.1-mini");
});

test("English-only providers are skipped for other languages", () => {
  const chain = providerChain("tts", { provider: "cartesia", model: "sonic-3", voice: "v" }, ["cartesia", "deepgram", "elevenlabs"], "es");
  assert.deepEqual(chain.map((c) => c.provider), ["cartesia", "elevenlabs"]);
  const en = providerChain("tts", { provider: "cartesia", model: "sonic-3", voice: "v" }, ["cartesia", "deepgram"], "en-US");
  assert.deepEqual(en.map((c) => c.provider), ["cartesia", "deepgram"]);
});

test("a primary without an API key falls back to the first available provider", () => {
  const chain = providerChain("stt", { provider: "assemblyai", model: "x" }, ["deepgram"], "en-US");
  assert.deepEqual(chain.map((c) => c.provider), ["deepgram"]);
});

test("non-streaming speech-to-text is never added as an automatic fallback", () => {
  const chain = providerChain("stt", { provider: "deepgram", model: "nova-3" }, ["deepgram", "openai", "assemblyai"], "en-US");
  assert.deepEqual(chain.map((c) => c.provider), ["deepgram", "assemblyai"]);
});

test("ElevenLabs Scribe is a streaming speech-to-text fallback", () => {
  const chain = providerChain("stt", { provider: "deepgram", model: "nova-3" }, ["deepgram", "elevenlabs", "openai"], "es");
  assert.deepEqual(chain.map((c) => c.provider), ["deepgram", "elevenlabs"]);
  assert.equal(chain[1].model, "scribe_v2_realtime");
});

test("agents saved before Realtime use the standard pipeline", () => {
  const p = resolveProviders(null, { llm_model: "gpt-4.1-mini", voice_id: "v" });
  assert.equal(p.mode, "pipeline");
  assert.deepEqual(p.realtime, { model: "gpt-realtime", voice: "marin" });
  assert.equal(resolveProviders({ mode: "realtime" } as never, { llm_model: "", voice_id: "" }).mode, "realtime");
});

test("every provider's default model is in its own model list", () => {
  for (const p of PROVIDERS.filter((x) => x.id !== "custom")) {
    assert.ok(p.models.some((m) => m.value === p.defaultModel), `${p.role}/${p.id}`);
  }
});
