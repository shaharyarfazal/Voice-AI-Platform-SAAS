"use client";

import "@livekit/components-styles";
import {
  BarVisualizer,
  RoomAudioRenderer,
  RoomContext,
  useRoomContext,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Room, RoomEvent } from "livekit-client";
import { useEffect, useRef, useState } from "react";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  initializing: "Starting…",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

function newRoom() {
  return new Room({
    adaptiveStream: true,
    // Browser-side cleanup before audio leaves the device. voiceIsolation is stronger where supported.
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true },
  });
}

function AgentStatus() {
  const { state, audioTrack } = useVoiceAssistant();
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-28">
        <BarVisualizer state={state} track={audioTrack} barCount={5} />
      </div>
      <span className="text-sm text-muted" aria-live="polite">{STATE_LABEL[state] ?? state}</span>
    </div>
  );
}

/** What the caller and the agent say, as it's said. */
function LiveTranscript() {
  const room = useRoomContext();
  const lines = useTranscriptions();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  if (lines.length === 0) {
    return <p className="text-sm text-muted">The transcript appears here as you and the agent talk.</p>;
  }
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pr-1" aria-live="polite" aria-label="Live transcript">
      {lines.map((line) => {
        const you = line.participantInfo.identity === room.localParticipant.identity;
        return (
          <div key={line.streamInfo.id} className={`flex ${you ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${you ? "bg-accent text-white" : "bg-surface"}`}>
              <span className={`mb-0.5 block text-xs ${you ? "text-white/80" : "text-muted"}`}>{you ? "You" : "Agent"}</span>
              {line.text}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** Talk to the agent from the browser; the same agent code answers phone calls. */
export function TestCall({ agentId }: { agentId: string }) {
  const [room, setRoom] = useState<Room>(newRoom);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "ended">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDisconnected = () => setStatus((s) => (s === "live" ? "ended" : s));
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  useEffect(() => () => void room.disconnect(), [room]);

  async function start() {
    setError(null);
    setStatus("starting");
    // A fresh room per call, so the transcript starts empty.
    const next = status === "idle" ? room : newRoom();
    if (next !== room) setRoom(next);
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { url, token } = await res.json();
      await next.connect(url, token);
      await next.localParticipant.setMicrophoneEnabled(true);
      setStatus("live");
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Could not start the call");
    }
  }

  const live = status === "live";
  return (
    <RoomContext.Provider value={room}>
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-medium">Test call</div>
            <div className="text-sm text-muted">
              {live ? "You're on a call with this agent. Speak into your microphone." : "Talk to this agent from your browser. It's saved like a phone call."}
            </div>
            {error && <p className="mt-1 text-sm text-critical">▲ <span className="text-foreground">{error}</span></p>}
          </div>
          {live ? (
            <div className="flex items-center gap-4">
              <AgentStatus />
              <button className="btn-secondary" onClick={() => room.disconnect()}>End call</button>
            </div>
          ) : (
            <button className="btn" onClick={start} disabled={status === "starting"}>
              {status === "starting" ? "Connecting…" : status === "ended" ? "Call again" : "Start test call"}
            </button>
          )}
        </div>
        {status !== "idle" && (
          <div className="border-t border-border pt-4">
            <LiveTranscript />
            {status === "ended" && <p className="mt-3 text-xs text-muted">Call ended. The recording, transcript and analysis are on the Calls page in a few seconds.</p>}
          </div>
        )}
        <RoomAudioRenderer />
      </div>
    </RoomContext.Provider>
  );
}
