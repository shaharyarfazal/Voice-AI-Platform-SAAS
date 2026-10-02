"use client";

import { useActionState } from "react";
import type { AgentRow } from "@/lib/db";
import { saveAgent } from "./actions";

// Cartesia's default voice in the LiveKit plugin; replace with any voice ID from your Cartesia account.
const DEFAULT_VOICE_ID = "f786b574-daa5-4673-aa0c-cbe3e8534c02";

const DEFAULT_PROMPT = `You are the friendly receptionist for {business name}, answering the phone.

Keep every reply short: one or two sentences, spoken naturally. Never use lists, markdown or emojis.
Ask one question at a time.

Business information:
- Hours: ...
- Address: ...
- Services and prices: ...

If you don't know an answer, say so and offer to transfer the caller or take a message.
When the caller is done, say goodbye and end the call.`;

export function AgentForm({ agent }: { agent?: AgentRow }) {
  const [state, action, pending] = useActionState(saveAgent, undefined);

  return (
    <form action={action} className="space-y-5">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input className="input" id="name" name="name" defaultValue={agent?.name} placeholder="Front desk" required />
      </div>
      <div>
        <label className="label" htmlFor="greeting">Greeting</label>
        <input
          className="input"
          id="greeting"
          name="greeting"
          defaultValue={agent?.greeting ?? "Thanks for calling! How can I help you today?"}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="systemPrompt">Instructions</label>
        <textarea
          className="input min-h-64 font-mono"
          id="systemPrompt"
          name="systemPrompt"
          defaultValue={agent?.system_prompt ?? DEFAULT_PROMPT}
          required
        />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="voiceId">Cartesia voice ID</label>
          <input className="input" id="voiceId" name="voiceId" defaultValue={agent?.voice_id ?? DEFAULT_VOICE_ID} required />
        </div>
        <div>
          <label className="label" htmlFor="language">Language</label>
          <input className="input" id="language" name="language" defaultValue={agent?.language ?? "en-US"} required />
        </div>
        <div>
          <label className="label" htmlFor="llmModel">OpenAI model</label>
          <input className="input" id="llmModel" name="llmModel" defaultValue={agent?.llm_model ?? "gpt-4.1-mini"} required />
        </div>
        <div>
          <label className="label" htmlFor="transferNumber">Transfer number (optional)</label>
          <input
            className="input"
            id="transferNumber"
            name="transferNumber"
            defaultValue={agent?.transfer_number ?? ""}
            placeholder="+14155550100"
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="announceAi" defaultChecked={agent?.announce_ai ?? true} className="mt-1" />
        <span>
          Tell callers they are speaking to an AI and that the call may be transcribed, before the greeting.
          <span className="block text-muted">Required in the EU and recommended everywhere. Turn off only if your greeting already says it.</span>
        </span>
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.saved && <p className="text-sm text-green-600">Saved.</p>}
      <button className="btn" disabled={pending}>{agent ? "Save changes" : "Create agent"}</button>
    </form>
  );
}
