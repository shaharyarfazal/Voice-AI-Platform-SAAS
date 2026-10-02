type Turn = { role: string; text: string };

/** A call transcript: caller and agent turns, with tool use shown as small system lines. */
export function Transcript({ turns, purged }: { turns: Turn[]; purged: boolean }) {
  if (turns.length === 0) {
    return <p className="text-sm text-muted">{purged ? "Transcript deleted under the data retention policy." : "No transcript."}</p>;
  }
  return (
    <div className="space-y-3">
      {turns.map((turn, i) =>
        turn.role === "tool" ? (
          <div key={i} className="mx-auto max-w-2xl rounded-md border border-dashed border-border px-3 py-1.5 font-mono text-xs text-muted">
            ⚙ {turn.text}
          </div>
        ) : (
          <div key={i} className={turn.role === "assistant" ? "mr-12" : "ml-12 text-right"}>
            <div className="text-xs text-muted">{turn.role === "assistant" ? "Agent" : "Caller"}</div>
            <div
              className={`inline-block rounded-2xl px-3 py-2 text-left text-sm ${
                turn.role === "assistant" ? "bg-surface" : "bg-accent text-white"
              }`}
            >
              {turn.text}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
