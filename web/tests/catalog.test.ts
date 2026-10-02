import assert from "node:assert/strict";
import { test } from "node:test";
import { providerChain } from "../lib/catalog.ts";

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
