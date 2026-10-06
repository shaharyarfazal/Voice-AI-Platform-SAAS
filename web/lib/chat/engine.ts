import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type FullAgentRow } from "../agent-runtime-config";
import { PROVIDERS, providerChain, resolveProviders, type ProviderChoice } from "../catalog";
import { chatTools, type ToolCtx } from "./tools";

// Text chat with an agent: the same instructions, knowledge base and tools as the voice agent,
// answered by the agent's LLM (falling back to the other providers with keys if it fails).

export type ChatMessage = { role: "user" | "assistant"; content: string; at: string };
export type ChatResult = { reply: string; inputTokens: number; outputTokens: number; tools: { name: string; args: unknown }[] };
type AgentRow = FullAgentRow & { tenant_id: string };

const MAX_TOOL_ROUNDS = 4;
const MAX_REPLY_TOKENS = 1024;
const FALLBACK_REPLY = "Sorry, I'm having trouble answering right now. Please try again in a moment.";

/** OpenAI-compatible endpoints. Claude goes through Anthropic's own SDK instead. */
const COMPATIBLE: Record<string, { baseUrl: string; envKey: string }> = {
  openai: { baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", envKey: "OPENAI_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", envKey: "GOOGLE_API_KEY" },
};

/** LLM providers with a key on the web app. */
export function chatProvidersAvailable(): string[] {
  return PROVIDERS.filter((p) => p.role === "llm" && p.id !== "custom" && process.env[p.envKey]).map((p) => p.id);
}

type Tools = ReturnType<typeof chatTools>;

async function runTool(tools: Tools, name: string, args: unknown, ctx: ToolCtx): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `There is no tool called ${name}.`;
  try {
    return (await tool.run((args ?? {}) as Record<string, unknown>, ctx)).slice(0, 8000);
  } catch {
    return `${name} failed. Tell the visitor you couldn't complete that.`;
  }
}

async function viaCompatible(choice: ProviderChoice, system: string, history: ChatMessage[], tools: Tools, ctx: ToolCtx, log: ChatResult["tools"]): Promise<ChatResult> {
  const p = COMPATIBLE[choice.provider];
  type Msg = { role: string; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };
  const messages: Msg[] = [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  let input = 0;
  let output = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${process.env[p.envKey]}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: choice.model,
        messages,
        ...(choice.provider === "openai" ? { max_completion_tokens: MAX_REPLY_TOKENS } : { max_tokens: MAX_REPLY_TOKENS }),
        ...(tools.length && round < MAX_TOOL_ROUNDS
          ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`${choice.provider} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      choices: { message: Msg }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    input += body.usage?.prompt_tokens ?? 0;
    output += body.usage?.completion_tokens ?? 0;
    const message = body.choices[0]?.message;
    if (!message) throw new Error(`${choice.provider}: empty response`);
    if (!message.tool_calls?.length) return { reply: (message.content ?? "").trim() || FALLBACK_REPLY, inputTokens: input, outputTokens: output, tools: log };
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      log.push({ name: call.function.name, args });
      messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(tools, call.function.name, args, ctx) });
    }
  }
  return { reply: FALLBACK_REPLY, inputTokens: input, outputTokens: output, tools: log };
}

async function viaAnthropic(choice: ProviderChoice, system: string, history: ChatMessage[], tools: Tools, ctx: ToolCtx, log: ChatResult["tools"]): Promise<ChatResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema }));
  // Newer Claude models think by default; low effort keeps chat replies quick.
  const effort = /claude-(sonnet|opus|fable)-5/.test(choice.model) ? { output_config: { effort: "low" as const } } : {};
  let input = 0;
  let output = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: choice.model,
      max_tokens: 4096,
      system,
      messages,
      ...(toolDefs.length && round < MAX_TOOL_ROUNDS ? { tools: toolDefs } : {}),
      ...effort,
    });
    input += response.usage.input_tokens;
    output += response.usage.output_tokens;
    if (response.stop_reason === "refusal") {
      return { reply: "Sorry, I can't help with that. Is there anything else I can do for you?", inputTokens: input, outputTokens: output, tools: log };
    }
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { reply: text || FALLBACK_REPLY, inputTokens: input, outputTokens: output, tools: log };
    }
    // The whole assistant turn goes back unchanged (thinking blocks included), then all results in one message.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      log.push({ name: use.name, args: use.input });
      results.push({ type: "tool_result", tool_use_id: use.id, content: await runTool(tools, use.name, use.input, ctx) });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: FALLBACK_REPLY, inputTokens: input, outputTokens: output, tools: log };
}

export async function runChat(agent: AgentRow, history: ChatMessage[], ctx: Omit<ToolCtx, "agentId" | "tenantId">): Promise<ChatResult> {
  const system = await buildSystemPrompt(agent, "chat");
  const tools = chatTools(agent);
  const providers = resolveProviders(agent.providers as never, agent);
  const chain = providerChain("llm", providers.llm, chatProvidersAvailable(), agent.language || "en-US").filter(
    (c) => c.provider === "anthropic" || c.provider in COMPATIBLE,
  );
  const fullCtx: ToolCtx = { ...ctx, agentId: agent.id, tenantId: agent.tenant_id };
  // Keep the conversation within a sensible size: the last 30 messages.
  const recent = history.slice(-30);
  for (const choice of chain) {
    if (!process.env[PROVIDERS.find((p) => p.role === "llm" && p.id === choice.provider)?.envKey ?? ""]) continue;
    const log: ChatResult["tools"] = [];
    try {
      return choice.provider === "anthropic"
        ? await viaAnthropic(choice, system, recent, tools, fullCtx, log)
        : await viaCompatible(choice, system, recent, tools, fullCtx, log);
    } catch (e) {
      console.error(`chat: ${choice.provider}/${choice.model} failed, trying the next provider`, e instanceof Error ? e.message : e);
    }
  }
  return { reply: FALLBACK_REPLY, inputTokens: 0, outputTokens: 0, tools: [] };
}

/** A one-off text answer (no tools) from the first LLM with a key, e.g. to summarise a website. */
export async function completeText(system: string, user: string): Promise<string | null> {
  const order = ["openai", "anthropic", "google", "groq"].filter((p) => chatProvidersAvailable().includes(p));
  for (const provider of order) {
    const choice = { provider, model: PROVIDERS.find((p) => p.role === "llm" && p.id === provider)!.defaultModel };
    const history: ChatMessage[] = [{ role: "user", content: user, at: new Date().toISOString() }];
    const ctx: ToolCtx = { agentId: "", tenantId: "", sessionId: "", visitor: {} };
    try {
      const r = provider === "anthropic"
        ? await viaAnthropic(choice, system, history, [], ctx, [])
        : await viaCompatible(choice, system, history, [], ctx, []);
      if (r.reply && r.reply !== FALLBACK_REPLY) return r.reply;
    } catch (e) {
      console.error(`completeText: ${provider} failed`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}
