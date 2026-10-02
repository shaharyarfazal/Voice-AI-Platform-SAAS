"use client";

import "@livekit/components-styles";
import {
  BarVisualizer,
  RoomAudioRenderer,
  RoomContext,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Room, RoomEvent } from "livekit-client";
import { useEffect, useState } from "react";

function AgentStatus() {
  const { state, audioTrack } = useVoiceAssistant();
  return (
    <div className="flex items-center gap-4">
      <div className="h-12 w-32">
        <BarVisualizer state={state} track={audioTrack} barCount={5} />
      </div>
      <span className="text-sm text-muted">{state}</span>
    </div>
  );
}

/** Talk to the agent from the browser; the same agent code answers phone calls. */
export function TestCall({ agentId }: { agentId: string }) {
  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: true,
        // Browser-side cleanup before audio leaves the device. voiceIsolation is stronger where supported.
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true },
      }),
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDisconnected = () => setConnected(false);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.disconnect();
    };
  }, [room]);

  async function start() {
    setError(null);
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { url, token } = await res.json();
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the call");
    }
  }

  return (
    <RoomContext.Provider value={room}>
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-medium">Test call</div>
          <div className="text-sm text-muted">Talk to this agent from your browser.</div>
          {error && <div className="mt-1 text-sm text-red-600">{error}</div>}
        </div>
        {connected ? (
          <div className="flex items-center gap-4">
            <AgentStatus />
            <button className="btn-secondary" onClick={() => room.disconnect()}>End call</button>
          </div>
        ) : (
          <button className="btn" onClick={start}>Start test call</button>
        )}
        <RoomAudioRenderer />
      </div>
    </RoomContext.Provider>
  );
}
