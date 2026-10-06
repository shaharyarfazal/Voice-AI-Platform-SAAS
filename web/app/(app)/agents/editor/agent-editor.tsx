"use client";

import { useActionState, useState, useTransition } from "react";
import { DAYS, WEBHOOK_EVENTS, type AnalysisField, type Day, type PostCall, type WebhookEvent } from "@/lib/agent-settings";
import { Combobox } from "@/components/combobox";
import { languageLabel, LANGUAGES, providersFor, type Choice, type Role } from "@/lib/catalog";
import { saveAgent, sendTestWebhook, type TestWebhookResult } from "../actions";
import type { EditorContext, EditorFunction, EditorMcp, EditorState } from "./types";

const TABS = [
  { id: "general", label: "General" },
  { id: "voice", label: "Voice & language" },
  { id: "tools", label: "Tools" },
  { id: "functions", label: "Custom functions & MCP" },
  { id: "guardrails", label: "Guardrails" },
  { id: "after", label: "Recording & webhooks" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const DAY_LABELS: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

const EXAMPLE_PARAMETERS = JSON.stringify(
  { type: "object", properties: { order_number: { type: "string", description: "The order number the caller reads out" } }, required: ["order_number"] },
  null,
  2,
);

function Toggle({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children?: React.ReactNode }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {children && <span className="mt-0.5 block text-sm text-muted">{children}</span>}
      </span>
    </label>
  );
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Converts editor state to what the server action validates. Returns an error string for bad JSON. */
function toPayload(s: EditorState): unknown | string {
  const custom = [];
  for (const f of s.tools.custom) {
    let parameters: unknown;
    try {
      parameters = JSON.parse(f.parametersText || "{}");
    } catch {
      return `The parameters of "${f.name || "a custom function"}" aren't valid JSON`;
    }
    custom.push({
      name: f.name.trim(),
      description: f.description,
      url: f.url.trim(),
      parameters,
      speakBefore: f.speakBefore,
      authorization: f.authorization || undefined,
      keepAuthorization: f.keepAuthorization,
    });
  }
  return {
    ...s,
    guardrails: { ...s.guardrails, blockedPhrases: s.guardrails.blockedPhrases.map((w) => w.trim()).filter(Boolean) },
    tools: {
      ...s.tools,
      custom,
      mcp: s.tools.mcp.map((m) => ({
        name: m.name.trim(),
        url: m.url.trim(),
        allowedTools: m.allowedToolsText.split(",").map((t) => t.trim()).filter(Boolean),
        authorization: m.authorization || undefined,
        keepAuthorization: m.keepAuthorization,
      })),
    },
  };
}

export function AgentEditor({ id, initial, context }: { id?: string; initial: EditorState; context: EditorContext }) {
  const [state, action, pending] = useActionState(saveAgent, undefined);
  const [s, setS] = useState(initial);
  const [tab, setTab] = useState<TabId>("general");
  const [clientError, setClientError] = useState<string | null>(null);
  const [payload, setPayload] = useState("");
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const setTools = (patch: Partial<EditorState["tools"]>) => setS((p) => ({ ...p, tools: { ...p.tools, ...patch } }));
  const setBooking = (patch: Partial<EditorState["booking"]>) => setS((p) => ({ ...p, booking: { ...p.booking, ...patch } }));
  const setPostCall = (patch: Partial<PostCall>) => setS((p) => ({ ...p, postCall: { ...p.postCall, ...patch } }));
  const setGuard = (patch: Partial<EditorState["guardrails"]>) => setS((p) => ({ ...p, guardrails: { ...p.guardrails, ...patch } }));

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const p = toPayload(s);
        if (typeof p === "string") {
          e.preventDefault();
          setClientError(p);
          setTab("functions");
          return;
        }
        setClientError(null);
        // Set synchronously so the hidden input carries this exact state.
        const json = JSON.stringify(p);
        setPayload(json);
        (e.currentTarget.elements.namedItem("payload") as HTMLInputElement).value = json;
      }}
      className="space-y-6"
    >
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="payload" value={payload} readOnly />

      <div className="flex overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      <section hidden={tab !== "general"} className="space-y-5">
        <Field label="Name" htmlFor="name" hint="Only you see this.">
          <input className="input" id="name" value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Front desk" />
        </Field>
        <Field label="Greeting" htmlFor="greeting" hint="The first thing callers hear.">
          <input className="input" id="greeting" value={s.greeting} onChange={(e) => set("greeting", e.target.value)} />
        </Field>
        <Field
          label="Instructions"
          htmlFor="systemPrompt"
          hint="Describe the business, what the agent should do, and the facts it may share. Safety rules and tool instructions are added automatically."
        >
          <textarea className="input min-h-72 font-mono text-[13px]" id="systemPrompt" value={s.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
        </Field>
        <Toggle checked={s.announceAi} onChange={(v) => set("announceAi", v)} title="Tell callers they're speaking to an AI">
          Said before the greeting, with a note that the call may be transcribed. Required in the EU; recommended everywhere.
        </Toggle>
      </section>

      {/* Voice & language */}
      <section hidden={tab !== "voice"} className="space-y-6">
        <VoiceSettings s={s} context={context} set={set} />

        <fieldset className="card space-y-4">
          <legend className="px-1 text-sm font-medium">Call audio</legend>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Caller surroundings">
            {(
              [
                ["standard", "Quiet callers", "Offices, homes. Most responsive to short replies like \"yes\"."],
                ["noisy", "Noisy places", "Reception desks, streets, restaurants, cars. Ignores quieter background voices and noise, and needs a few words before the caller can interrupt."],
              ] as const
            ).map(([value, title, body]) => (
              <label key={value} className={`toggle-row ${s.guardrails.noiseProfile === value ? "border-accent" : ""}`}>
                <input
                  type="radio"
                  name="noiseProfile"
                  className="mt-1 accent-[var(--accent)]"
                  checked={s.guardrails.noiseProfile === value}
                  onChange={() => setGuard({ noiseProfile: value })}
                />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{body}</span>
                </span>
              </label>
            ))}
          </div>
          {s.guardrails.noiseProfile === "noisy" && s.providers.stt.provider !== "assemblyai" && (
            <p className="hint">
              For the strongest background-voice filtering, choose AssemblyAI for speech recognition: in noisy mode it isolates the voice closest to the phone.
            </p>
          )}
          <Field label="Response speed" htmlFor="responseSpeed" hint="How long a pause means the caller has finished. Faster replies sooner but may cut off people who pause mid-sentence.">
            <select
              className="input max-w-sm"
              id="responseSpeed"
              value={s.guardrails.responseSpeed}
              onChange={(e) => setGuard({ responseSpeed: e.target.value as EditorState["guardrails"]["responseSpeed"] })}
            >
              <option value="fast">Fast (0.3 s pause)</option>
              <option value="balanced">Balanced (0.5 s pause)</option>
              <option value="patient">Patient (0.9 s pause): for elderly callers or slow speakers</option>
            </select>
          </Field>
        </fieldset>
      </section>

      {/* Tools */}
      <section hidden={tab !== "tools"} className="space-y-4">
        <Toggle checked={s.tools.endCall} onChange={(v) => setTools({ endCall: v })} title="End call">
          The agent hangs up after saying goodbye.
        </Toggle>
        <Toggle checked={s.tools.transferCall} onChange={(v) => setTools({ transferCall: v })} title="Transfer to a person">
          When the caller asks for a human, or the agent can&apos;t help. Phone calls only.
        </Toggle>
        {s.tools.transferCall && (
          <div className="ml-7">
            <Field label="Transfer number" htmlFor="transferNumber" hint="E.164 format, e.g. +14155550100">
              <input className="input max-w-xs" id="transferNumber" value={s.transferNumber} onChange={(e) => set("transferNumber", e.target.value)} placeholder="+14155550100" />
            </Field>
          </div>
        )}
        <Toggle checked={s.tools.booking} onChange={(v) => setTools({ booking: v })} title="Check availability and book appointments">
          Uses your connected Google or Outlook calendar.
        </Toggle>
        {s.tools.booking && <BookingSettings s={s} context={context} setBooking={setBooking} />}
      </section>

      {/* Custom functions & MCP */}
      <section hidden={tab !== "functions"} className="space-y-8">
        <CustomFunctions items={s.tools.custom} onChange={(custom) => setTools({ custom })} />
        <McpServers items={s.tools.mcp} onChange={(mcp) => setTools({ mcp })} />
      </section>

      {/* Guardrails */}
      <section hidden={tab !== "guardrails"} className="space-y-5">
        <p className="rounded-lg bg-surface p-3 text-sm text-muted">
          Always on: the agent never reveals its instructions, ignores attempts to change its role, never makes up facts or availability, sends emergencies to 911/112 and never takes card numbers.
        </p>
        <Field label="Only help with" htmlFor="allowedTopics" hint="Leave empty to allow anything about your business. Everything else is politely declined.">
          <textarea className="input min-h-20" id="allowedTopics" value={s.guardrails.allowedTopics} onChange={(e) => setGuard({ allowedTopics: e.target.value })} placeholder="Appointments, opening hours, prices and directions" />
        </Field>
        <Field label="Never do or discuss" htmlFor="forbidden">
          <textarea className="input min-h-20" id="forbidden" value={s.guardrails.forbidden} onChange={(e) => setGuard({ forbidden: e.target.value })} placeholder="Competitors, discounts, medical diagnoses" />
        </Field>
        <Field label="Blocked words" htmlFor="blockedPhrases" hint="Comma-separated. Removed from anything the agent says, even if the AI produces them.">
          <input
            className="input"
            id="blockedPhrases"
            value={s.guardrails.blockedPhrases.join(", ")}
            onChange={(e) => setGuard({ blockedPhrases: e.target.value.split(",").map((w) => w.trimStart()).filter((w, i, a) => w || i === a.length - 1) })}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Maximum call length (minutes)" htmlFor="maxCallMinutes" hint="The agent says goodbye and hangs up at the limit.">
            <input className="input" id="maxCallMinutes" type="number" min={1} max={120} value={s.guardrails.maxCallMinutes} onChange={(e) => setGuard({ maxCallMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Hang up after silence (seconds)" htmlFor="silenceTimeoutSeconds" hint='Asks "Are you still there?" once first.'>
            <input className="input" id="silenceTimeoutSeconds" type="number" min={5} max={120} value={s.guardrails.silenceTimeoutSeconds} onChange={(e) => setGuard({ silenceTimeoutSeconds: Number(e.target.value) })} />
          </Field>
        </div>
      </section>

      {/* Recording & webhooks */}
      <section hidden={tab !== "after"} className="space-y-6">
        <PostCallSettings agentId={id} value={s.postCall} secret={context.webhookSecret} onChange={setPostCall} />
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Create agent"}</button>
        {(clientError || state?.error) && <p className="text-sm text-critical">▲ <span className="text-foreground">{clientError ?? state?.error}</span></p>}
        {!clientError && state?.saved && <p className="text-sm text-good">✓ <span className="text-foreground">Saved. Applies from the next call.</span></p>}
      </div>
    </form>
  );
}

const LANGUAGE_CHOICES: Choice[] = LANGUAGES.map((l) => ({ value: l.code, label: l.label, hint: l.code === "multi" ? "Answers in whatever language the caller speaks" : undefined }));

const ROLE_INFO: Record<Role, { title: string; about: string }> = {
  llm: { title: "AI model", about: "Understands the caller and decides what to say and do." },
  tts: { title: "Voice", about: "How the agent sounds." },
  stt: { title: "Speech recognition", about: "Turns the caller's speech into text." },
};

function VoiceSettings({ s, context, set }: { s: EditorState; context: EditorContext; set: <K extends keyof EditorState>(key: K, value: EditorState[K]) => void }) {
  const providers = s.providers;
  const setProviders = (patch: Partial<EditorState["providers"]>) => set("providers", { ...providers, ...patch });
  const realtimeAvailable = context.available.llm.includes("openai");
  const realtime = providers.mode === "realtime";

  return (
    <>
      <Field label="Language" htmlFor="language" hint="Speech recognition, the AI and the voice all use this language.">
        <Combobox id="language" value={s.language} options={LANGUAGE_CHOICES} onChange={(v) => set("language", v)} searchPlaceholder="Search languages" />
      </Field>

      <div>
        <p className="label">How the agent listens and speaks</p>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Voice pipeline">
          {(
            [
              ["pipeline", "Standard", "Speech recognition → AI model → voice. Mix providers (Claude, Gemini, ElevenLabs, Cartesia…) with automatic fallback if one fails."],
              ["realtime", "OpenAI Realtime", "One speech-to-speech model hears the caller and answers in its own voice. The most natural turn-taking; OpenAI voices only, no fallback."],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className={`toggle-row ${providers.mode === value ? "border-accent bg-accent/5" : ""}`}>
              <input type="radio" name="mode" className="mt-1 accent-[var(--accent)]" checked={providers.mode === value} onChange={() => setProviders({ mode: value })} />
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-sm text-muted">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {realtime ? (
        <fieldset className="card space-y-4">
          <legend className="px-1 text-sm font-medium">OpenAI Realtime</legend>
          {!realtimeAvailable && <Warning>The agent server has no OpenAI API key, so calls can&apos;t use Realtime. Add OPENAI_API_KEY to infra/.env.</Warning>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model" htmlFor="realtime-model">
              <Combobox
                id="realtime-model"
                value={providers.realtime.model}
                options={context.catalog.realtime.models}
                onChange={(model) => setProviders({ realtime: { ...providers.realtime, model } })}
                allowCustom
                customNoun="model name"
                searchPlaceholder="Search models"
              />
            </Field>
            <Field label="Voice" htmlFor="realtime-voice">
              <Combobox
                id="realtime-voice"
                value={providers.realtime.voice}
                options={context.catalog.realtime.voices}
                onChange={(voice) => setProviders({ realtime: { ...providers.realtime, voice } })}
                searchPlaceholder="Search voices"
              />
            </Field>
          </div>
          <p className="hint">Blocked words and the speech-recognition and voice settings below don&apos;t apply in Realtime mode. Call transcripts still work.</p>
        </fieldset>
      ) : (
        (["llm", "tts", "stt"] as Role[]).map((role) => (
          <ProviderPicker
            key={role}
            role={role}
            value={providers[role]}
            available={context.available[role]}
            language={s.language}
            catalog={context.catalog}
            onChange={(v) => setProviders({ [role]: v })}
          />
        ))
      )}
      {!realtime && (
        <p className="rounded-lg bg-surface p-3 text-sm text-muted">
          Automatic fallback: if a provider fails during a call, the agent switches to the next provider with an API key and keeps talking.
        </p>
      )}
    </>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-critical">▲ <span className="text-foreground">{children}</span></p>;
}

function ProviderPicker({
  role,
  value,
  available,
  language,
  catalog,
  onChange,
}: {
  role: Role;
  value: { provider: string; model: string; voice?: string };
  available: string[];
  language: string;
  catalog: EditorContext["catalog"];
  onChange: (v: { provider: string; model: string; voice?: string }) => void;
}) {
  const options = providersFor(role).filter((o) => o.id !== "custom");
  const current = options.find((o) => o.id === value.provider);
  const englishOnly = current && !current.multilingual && !language.startsWith("en");
  const models = catalog.models[role][value.provider] ?? current?.models ?? [];
  const voices = catalog.voices[value.provider] ?? [];
  // Deepgram Aura's voice is its model, so it shows one "Voice" dropdown.
  const voiceIsModel = role === "tts" && value.provider === "deepgram";
  const [previewing, setPreviewing] = useState<HTMLAudioElement | null>(null);
  const previewUrl = voices.find((v) => v.value === value.voice)?.previewUrl;

  function preview() {
    previewing?.pause();
    if (!previewUrl) return;
    const audio = new Audio(previewUrl);
    audio.onended = () => setPreviewing(null);
    void audio.play();
    setPreviewing(audio);
  }

  return (
    <fieldset className="card space-y-4">
      <legend className="px-1 text-sm font-medium">{ROLE_INFO[role].title}</legend>
      <p className="-mt-2 text-sm text-muted">{ROLE_INFO[role].about}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${ROLE_INFO[role].title} provider`}>
        {options.map((o) => {
          const keyed = available.includes(o.id);
          const selected = o.id === value.provider;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!keyed && !selected}
              title={keyed ? undefined : "No API key for this provider on the server"}
              onClick={() => onChange({ provider: o.id, model: o.defaultModel, ...(role === "tts" ? { voice: o.defaultVoice ?? "" } : {}) })}
              className={`rounded-full border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${
                selected ? "border-accent bg-accent/10 font-medium text-foreground" : "border-border text-muted hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {o.label}
              {!keyed && <span className="ml-1 text-xs">(no key)</span>}
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {role === "tts" && !voiceIsModel && (
          <Field label="Voice" htmlFor="tts-voice" hint={voices.length > 1 ? `${voices.length} voices. Or paste any voice ID.` : "Paste a voice ID from your provider account."}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  id="tts-voice"
                  value={value.voice ?? ""}
                  options={voices}
                  onChange={(voice) => onChange({ ...value, voice })}
                  allowCustom
                  customNoun="voice ID"
                  searchPlaceholder="Search voices, accents, languages"
                />
              </div>
              {previewUrl && (
                <button type="button" className="btn-secondary px-3" onClick={preview} aria-label="Play a sample of this voice">
                  {previewing ? "■" : "▶"}
                </button>
              )}
            </div>
          </Field>
        )}
        <Field label={voiceIsModel ? "Voice" : "Model"} htmlFor={`${role}-model`}>
          <Combobox
            id={`${role}-model`}
            value={value.model}
            options={models}
            onChange={(model) => onChange({ ...value, model })}
            allowCustom
            customNoun="model name"
            searchPlaceholder={voiceIsModel ? "Search voices" : "Search models"}
          />
        </Field>
      </div>
      {!available.includes(value.provider) && <Warning>No API key for this provider on the server, so the first available one is used instead.</Warning>}
      {current?.streaming === false && (
        <p className="text-sm text-muted">This provider transcribes after the caller finishes speaking, so replies are slower. Prefer Deepgram, AssemblyAI or ElevenLabs Scribe for phone calls.</p>
      )}
      {englishOnly && <Warning>This voice only speaks English; pick another provider for {languageLabel(language)}.</Warning>}
    </fieldset>
  );
}

function BookingSettings({
  s,
  context,
  setBooking,
}: {
  s: EditorState;
  context: EditorContext;
  setBooking: (p: Partial<EditorState["booking"]>) => void;
}) {
  const b = s.booking;
  if (context.integrations.length === 0) {
    return (
      <div className="ml-7 rounded-lg border border-border p-4 text-sm">
        Connect a calendar first on <a className="underline" href="/integrations">Integrations</a>.
      </div>
    );
  }
  return (
    <div className="ml-7 space-y-5 rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Calendar" htmlFor="integration">
          <select className="input" id="integration" value={b.integrationId ?? ""} onChange={(e) => setBooking({ integrationId: e.target.value || null })}>
            <option value="">Choose a calendar…</option>
            {context.integrations.map((i) => (
              <option key={i.id} value={i.id}>{i.provider === "google" ? "Google" : "Outlook"}: {i.account_email}</option>
            ))}
          </select>
        </Field>
        <Field label="Time zone" htmlFor="timezone" hint="Opening hours and spoken times use this zone.">
          <input className="input" id="timezone" list="timezones" value={b.timezone} onChange={(e) => setBooking({ timezone: e.target.value })} />
          <datalist id="timezones">{context.timezones.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
        <Field label="Appointment length (minutes)" htmlFor="slotMinutes">
          <input className="input" id="slotMinutes" type="number" min={5} max={480} value={b.slotMinutes} onChange={(e) => setBooking({ slotMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Gap between appointments (minutes)" htmlFor="bufferMinutes">
          <input className="input" id="bufferMinutes" type="number" min={0} max={120} value={b.bufferMinutes} onChange={(e) => setBooking({ bufferMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Minimum notice (hours)" htmlFor="minNoticeHours">
          <input className="input" id="minNoticeHours" type="number" min={0} max={720} value={b.minNoticeHours} onChange={(e) => setBooking({ minNoticeHours: Number(e.target.value) })} />
        </Field>
        <Field label="Book up to (days ahead)" htmlFor="maxDaysAhead">
          <input className="input" id="maxDaysAhead" type="number" min={1} max={365} value={b.maxDaysAhead} onChange={(e) => setBooking({ maxDaysAhead: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Event title" htmlFor="eventTitle" hint="{name} becomes the caller's name.">
        <input className="input" id="eventTitle" value={b.eventTitle} onChange={(e) => setBooking({ eventTitle: e.target.value })} />
      </Field>
      <div>
        <div className="label">Bookable hours</div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {DAYS.map((d) => {
            const window = b.hours[d]?.[0];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <label className="flex w-32 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(window)}
                    onChange={(e) => setBooking({ hours: { ...b.hours, [d]: e.target.checked ? [{ start: "09:00", end: "17:00" }] : [] } })}
                  />
                  {DAY_LABELS[d]}
                </label>
                {window ? (
                  <span className="flex items-center gap-2">
                    <input type="time" className="input w-32 py-1" value={window.start} onChange={(e) => setBooking({ hours: { ...b.hours, [d]: [{ ...window, start: e.target.value }] } })} aria-label={`${DAY_LABELS[d]} opens`} />
                    to
                    <input type="time" className="input w-32 py-1" value={window.end} onChange={(e) => setBooking({ hours: { ...b.hours, [d]: [{ ...window, end: e.target.value }] } })} aria-label={`${DAY_LABELS[d]} closes`} />
                  </span>
                ) : (
                  <span className="text-muted">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SecretField({ id, item, onChange }: { id: string; item: { authorization: string; hasAuthorization: boolean; keepAuthorization: boolean }; onChange: (p: Partial<EditorFunction & EditorMcp>) => void }) {
  return (
    <Field
      label="Authorization header (optional)"
      htmlFor={id}
      hint={item.keepAuthorization ? "A value is saved. Type a new one to replace it." : "e.g. Bearer sk_live_…  Stored encrypted; never shown again."}
    >
      <div className="flex gap-2">
        <input
          className="input"
          id={id}
          type="password"
          autoComplete="off"
          placeholder={item.keepAuthorization ? "•••••••• (saved)" : ""}
          value={item.authorization}
          onChange={(e) => onChange({ authorization: e.target.value })}
        />
        {item.keepAuthorization && (
          <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => onChange({ keepAuthorization: false, authorization: "" })}>
            Remove
          </button>
        )}
      </div>
    </Field>
  );
}

function CustomFunctions({ items, onChange }: { items: EditorFunction[]; onChange: (v: EditorFunction[]) => void }) {
  const update = (i: number, patch: Partial<EditorFunction>) => onChange(items.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Custom functions</h3>
        <p className="text-sm text-muted">
          Let the agent call your own systems: look up an order, create a lead, check stock. The agent sends a POST with{" "}
          <code className="text-xs">{`{ function, arguments, call }`}</code> as JSON and reads out the answer. Public https addresses only.
        </p>
      </div>
      {items.map((f, i) => (
        <div key={i} className="card space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">{f.name || "new_function"}</span>
            <button type="button" className="text-sm text-critical underline" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={`fn-name-${i}`} hint="lowercase_with_underscores">
              <input className="input font-mono" id={`fn-name-${i}`} value={f.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="get_order_status" />
            </Field>
            <Field label="URL" htmlFor={`fn-url-${i}`}>
              <input className="input" id={`fn-url-${i}`} value={f.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://api.example.com/voice/order-status" />
            </Field>
          </div>
          <Field label="When should the agent use it?" htmlFor={`fn-desc-${i}`} hint="The AI reads this to decide when to call the function.">
            <textarea className="input min-h-16" id={`fn-desc-${i}`} value={f.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Look up the status of a customer's order when they ask where it is." />
          </Field>
          <Field label="Parameters (JSON Schema)" htmlFor={`fn-params-${i}`} hint="What the agent collects from the caller before calling.">
            <textarea className="input min-h-32 font-mono text-xs" id={`fn-params-${i}`} value={f.parametersText} onChange={(e) => update(i, { parametersText: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Say while waiting (optional)" htmlFor={`fn-say-${i}`}>
              <input className="input" id={`fn-say-${i}`} value={f.speakBefore} onChange={(e) => update(i, { speakBefore: e.target.value })} placeholder="One moment while I look that up." />
            </Field>
            <SecretField id={`fn-auth-${i}`} item={f} onChange={(p) => update(i, p)} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={() =>
          onChange([
            ...items,
            { name: "", description: "", url: "", parametersText: EXAMPLE_PARAMETERS, speakBefore: "", authorization: "", hasAuthorization: false, keepAuthorization: false },
          ])
        }
      >
        + Add custom function
      </button>
    </div>
  );
}

function McpServers({ items, onChange }: { items: EditorMcp[]; onChange: (v: EditorMcp[]) => void }) {
  const update = (i: number, patch: Partial<EditorMcp>) => onChange(items.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">MCP servers</h3>
        <p className="text-sm text-muted">
          Connect a Model Context Protocol server (HTTP) and the agent can use its tools: CRMs, help desks, Zapier and more. Public https addresses only.
        </p>
      </div>
      {items.map((m, i) => (
        <div key={i} className="card space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{m.name || "New MCP server"}</span>
            <button type="button" className="text-sm text-critical underline" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={`mcp-name-${i}`}>
              <input className="input" id={`mcp-name-${i}`} value={m.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="CRM" />
            </Field>
            <Field label="Server URL" htmlFor={`mcp-url-${i}`}>
              <input className="input" id={`mcp-url-${i}`} value={m.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
            </Field>
            <Field label="Only allow these tools (optional)" htmlFor={`mcp-tools-${i}`} hint="Comma-separated tool names. Empty allows all.">
              <input className="input" id={`mcp-tools-${i}`} value={m.allowedToolsText} onChange={(e) => update(i, { allowedToolsText: e.target.value })} />
            </Field>
            <SecretField id={`mcp-auth-${i}`} item={m} onChange={(p) => update(i, p)} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange([...items, { name: "", url: "", allowedToolsText: "", authorization: "", hasAuthorization: false, keepAuthorization: false }])}
      >
        + Add MCP server
      </button>
    </div>
  );
}

const EVENT_INFO: Record<WebhookEvent, string> = {
  call_started: "When the agent answers: call id, agent, direction, caller and dialled numbers.",
  call_ended: "When the call ends: everything above plus duration, end reason, transcript and recording link.",
  call_analyzed: "A few seconds later: everything in call_ended plus the AI summary, sentiment, success and your fields.",
};

function PostCallSettings({ agentId, value, secret, onChange }: { agentId?: string; value: PostCall; secret: string; onChange: (patch: Partial<PostCall>) => void }) {
  const [test, setTest] = useState<TestWebhookResult | null>(null);
  const [testing, startTest] = useTransition();
  const [showSecret, setShowSecret] = useState(false);
  const fields = value.analysisFields;
  const updateField = (i: number, patch: Partial<AnalysisField>) => onChange({ analysisFields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <>
      <Toggle checked={value.recordCalls} onChange={(v) => onChange({ recordCalls: v })} title="Record calls">
        Both sides of the call, playable on the call page and linked in webhooks. Recordings are deleted with transcripts at your retention period. Many places require telling callers they&apos;re being recorded; keep the AI disclosure on.
      </Toggle>

      <fieldset className="card space-y-4">
        <legend className="px-1 text-sm font-medium">Webhooks</legend>
        <Field label="Webhook URL" htmlFor="webhookUrl" hint="Public https address, e.g. an n8n, Make or Zapier webhook trigger. Leave empty for no webhooks.">
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1" id="webhookUrl" value={value.webhookUrl} onChange={(e) => onChange({ webhookUrl: e.target.value })} placeholder="https://n8n.example.com/webhook/calls" />
            <button
              type="button"
              className="btn-secondary"
              disabled={testing || !value.webhookUrl.trim()}
              onClick={() => startTest(async () => setTest(await sendTestWebhook(agentId, value.webhookUrl)))}
            >
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
        </Field>
        {test && (
          <p className={`text-sm ${test.ok ? "text-good" : "text-critical"}`}>
            {test.ok ? "✓" : "▲"} <span className="text-foreground">{test.ok ? `Test call_ended sent. ${test.message}` : `Test failed: ${test.message}`}</span>
          </p>
        )}
        <div className="space-y-2">
          {WEBHOOK_EVENTS.map((event) => (
            <Toggle
              key={event}
              checked={value.webhookEvents.includes(event)}
              onChange={(on) => onChange({ webhookEvents: on ? [...value.webhookEvents, event] : value.webhookEvents.filter((e) => e !== event) })}
              title={event}
            >
              {EVENT_INFO[event]}
            </Toggle>
          ))}
        </div>
        <Field
          label="Signing secret"
          htmlFor="webhookSecret"
          hint={<>Each request has an <code>x-webhook-signature</code> header: <code>v1=</code> + HMAC-SHA256 of <code>{"<x-webhook-timestamp>.<body>"}</code> with this secret. Check it to know the request came from us. Failed deliveries are retried twice.</>}
        >
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 font-mono text-sm" id="webhookSecret" readOnly value={showSecret ? secret : "whsec_" + "•".repeat(24)} />
            <button type="button" className="btn-secondary" onClick={() => setShowSecret((v) => !v)}>{showSecret ? "Hide" : "Show"}</button>
          </div>
        </Field>
      </fieldset>

      <fieldset className="card space-y-4">
        <legend className="px-1 text-sm font-medium">Post-call analysis</legend>
        <p className="text-sm text-muted">After every call the AI writes a summary and rates the caller&apos;s sentiment. It&apos;s shown on the call page and sent in call_analyzed.</p>
        <Field label="A call is successful when" htmlFor="successCriteria" hint="Sets call_successful. Leave empty for: the caller got what they called for.">
          <textarea className="input min-h-16" id="successCriteria" value={value.successCriteria} onChange={(e) => onChange({ successCriteria: e.target.value })} placeholder="An appointment was booked, or the caller's question was answered" />
        </Field>
        <div className="space-y-3">
          <p className="label">Extra fields to pull out of each call</p>
          {fields.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto_2fr_auto]">
              <input className="input font-mono text-sm" aria-label="Field name" value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="customer_name" />
              <select className="input" aria-label="Field type" value={f.type} onChange={(e) => updateField(i, { type: e.target.value as AnalysisField["type"] })}>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Yes / no</option>
              </select>
              <input className="input" aria-label="What to extract" value={f.description} onChange={(e) => updateField(i, { description: e.target.value })} placeholder="The caller's full name" />
              <button type="button" className="text-sm text-muted underline hover:text-critical" onClick={() => onChange({ analysisFields: fields.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {fields.length < 15 && (
            <button type="button" className="btn-secondary" onClick={() => onChange({ analysisFields: [...fields, { name: "", type: "string", description: "" }] })}>
              Add field
            </button>
          )}
        </div>
      </fieldset>
    </>
  );
}
