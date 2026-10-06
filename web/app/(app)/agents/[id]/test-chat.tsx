"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendTestChat, startTestChat } from "./chat-actions";

type Line = { role: "user" | "assistant"; content: string };

/** Chat with the agent from the dashboard, exactly as website visitors will. */
export function TestChat({ agentId }: { agentId: string }) {
  const [session, setSession] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines, pending]);

  function open() {
    setError(null);
    start(async () => {
      const r = await startTestChat(agentId);
      if ("error" in r) return setError(r.error);
      setSession(r.id);
      setLines([{ role: "assistant", content: r.greeting }]);
    });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || !session) return;
    setText("");
    setLines((l) => [...l, { role: "user", content: message }]);
    start(async () => {
      const r = await sendTestChat(session, message);
      if (r.error) setError(r.error);
      else setLines((l) => [...l, { role: "assistant", content: r.reply! }]);
    });
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">Test chat</div>
          <div className="text-sm text-muted">Chat with this bot the way website visitors will. Saved under Calls &amp; chats.</div>
        </div>
        <button className={session ? "btn-secondary" : "btn"} onClick={open} disabled={pending && !session}>
          {session ? "Start over" : "Start test chat"}
        </button>
      </div>
      {session && (
        <div className="border-t border-border pt-4">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-live="polite">
            {lines.map((l, i) => (
              <div key={i} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${l.role === "user" ? "bg-accent text-white" : "bg-surface"}`}>{l.content}</div>
              </div>
            ))}
            {pending && <div className="text-sm text-muted">Typing…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="mt-3 flex gap-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Message" maxLength={2000} />
            <button className="btn" disabled={pending || !text.trim()}>Send</button>
          </form>
        </div>
      )}
      {error && <p className="text-sm text-critical">▲ <span className="text-foreground">{error}</span></p>}
    </div>
  );
}
