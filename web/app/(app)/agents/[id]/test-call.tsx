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
import { createLocalAudioTrack, DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { Icon } from "@/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  initializing: "Starting…",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

/** Why the call ended, in words. Anything else shows the raw reason, which helps support. */
const END_REASON: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.CLIENT_INITIATED]: "You ended the call.",
  [DisconnectReason.ROOM_DELETED]: "The agent ended the call.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "The agent ended the call.",
  [DisconnectReason.SIGNAL_CLOSE]: "The connection to the call server dropped. Check your internet connection and try again.",
  [DisconnectReason.STATE_MISMATCH]: "The connection to the call server dropped. Try again.",
  [DisconnectReason.JOIN_FAILURE]: "Couldn't join the call. Try again.",
};

/** Why the agent hung up, as it tells the room just before leaving. */
const AGENT_END_REASON: Record<string, string> = {
  completed: "The agent ended the call after saying goodbye.",
  silence: "The agent hung up because it didn't hear you for a while (silence timeout, set on the agent's Call settings).",
  time_limit: "The call reached the agent's maximum call length.",
  error:
    "The agent ended the call because an AI provider failed (language model, voice or speech recognition). The call's page under Calls shows which one.",
};

// Browser-side cleanup before audio leaves the device. voiceIsolation is stronger where supported.
const AUDIO_CAPTURE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true };

function newRoom() {
  return new Room({ adaptiveStream: true, audioCaptureDefaults: AUDIO_CAPTURE });
}

type CallToken = { url: string; token: string; at: number };
/** Tokens last 15 minutes; one fetched in advance is used if it's younger than this. */
const TOKEN_FRESH_MS = 10 * 60_000;

async function fetchToken(agentId: string): Promise<CallToken> {
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) throw new Error(await res.text());
  const { url, token } = await res.json();
  return { url, token, at: Date.now() };
}

function AgentStatus() {
  const { state, audioTrack } = useVoiceAssistant();
  return (
    <div className="flex items-center gap-3">
      <div className="test-call-bars h-10 w-24">
        <BarVisualizer state={state} track={audioTrack} barCount={5} />
      </div>
      <span className="text-sm font-medium" aria-live="polite">{STATE_LABEL[state] ?? state}</span>
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
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${you ? "bg-accent text-on-accent" : "bg-card"}`}>
              <span className={`mb-0.5 block text-xs ${you ? "text-on-accent/70" : "text-muted"}`}>{you ? "You" : "Agent"}</span>
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
  const [endReason, setEndReason] = useState<string | null>(null);

  useEffect(() => {
    let agentReason: string | null = null;
    const onAttributes = (changed: Record<string, string>) => {
      if (changed.end_reason) agentReason = changed.end_reason;
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      setStatus((s) => (s === "live" ? "ended" : s));
      if (agentReason) setEndReason(AGENT_END_REASON[agentReason] ?? `The agent ended the call (${agentReason}).`);
      else setEndReason(reason === undefined ? null : (END_REASON[reason] ?? `Disconnected (${DisconnectReason[reason] ?? reason}).`));
    };
    room.on(RoomEvent.ParticipantAttributesChanged, onAttributes);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ParticipantAttributesChanged, onAttributes);
    };
  }, [room]);

  useEffect(() => () => void room.disconnect(), [room]);

  // Fetch the next call's token ahead of time and warm up the connection to the media server, so
  // pressing the button goes straight to joining. The agent is only dispatched when someone joins.
  const nextToken = useRef<Promise<CallToken> | null>(null);
  const prepare = useCallback(() => {
    const pending = fetchToken(agentId);
    pending.then((t) => room.prepareConnection(t.url, t.token)).catch(() => {});
    pending.catch(() => {
      if (nextToken.current === pending) nextToken.current = null;
    });
    nextToken.current = pending;
  }, [agentId, room]);
  useEffect(() => {
    if (status === "idle" || status === "ended") prepare();
  }, [prepare, status]);

  async function takeToken(): Promise<CallToken> {
    const pending = nextToken.current;
    nextToken.current = null;
    if (pending) {
      const t = await pending.catch(() => null);
      if (t && Date.now() - t.at < TOKEN_FRESH_MS) return t;
    }
    return fetchToken(agentId);
  }

  async function start() {
    setError(null);
    setEndReason(null);
    setStatus("starting");
    // A fresh room per call, so the transcript starts empty.
    const next = status === "idle" ? room : newRoom();
    if (next !== room) setRoom(next);
    // Ask for the microphone while connecting, instead of after.
    const mic = createLocalAudioTrack(AUDIO_CAPTURE);
    try {
      const { url, token } = await takeToken();
      await next.connect(url, token);
      await next.localParticipant.publishTrack(await mic, { source: Track.Source.Microphone });
      setStatus("live");
    } catch (e) {
      mic.then((t) => t.stop()).catch(() => {});
      void next.disconnect();
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Could not start the call");
    }
  }

  const live = status === "live";
  return (
    <RoomContext.Provider value={room}>
      <section className={`card relative space-y-5 overflow-hidden ${live ? "ring-2 ring-lime" : ""}`} aria-label="Test call">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${live ? "bg-lime text-on-lime" : "bg-surface"}`}>
              {live && <span className="absolute inset-0 animate-ping rounded-full bg-lime/60" />}
              <Icon name="mic" className="relative h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-medium">Test call</h2>
              <p className="text-sm text-muted">
                {live ? "You're on a call with this agent. Speak into your microphone." : "Talk to this agent from your browser. It's saved like a phone call."}
              </p>
              {error && <p className="mt-1 text-sm text-critical">▲ <span className="text-foreground">{error}</span></p>}
            </div>
          </div>
          {live ? (
            <div className="flex items-center gap-4">
              <AgentStatus />
              <button className="btn" onClick={() => room.disconnect()}>End call</button>
            </div>
          ) : (
            <button className="btn-lime" onClick={start} disabled={status === "starting"}>
              <Icon name={status === "starting" ? "phone" : "mic"} className={`h-4 w-4 ${status === "starting" ? "animate-pulse" : ""}`} />
              {status === "starting" ? "Connecting…" : status === "ended" ? "Call again" : "Start test call"}
            </button>
          )}
        </div>
        {status !== "idle" && (
          <div className="rounded-2xl bg-surface p-4">
            <LiveTranscript />
            {status === "ended" && endReason && <p className="mt-3 text-sm">{endReason}</p>}
            {status === "ended" && <p className="mt-3 text-xs text-muted">Call ended. The recording, transcript and analysis are on the Calls page in a few seconds.</p>}
          </div>
        )}
        <RoomAudioRenderer />
      </section>
    </RoomContext.Provider>
  );
}
