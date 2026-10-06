import "server-only";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

export const AGENT_NAME = process.env.AGENT_NAME ?? "voice-agent";

/** Token for a browser test call; joining the room dispatches the agent with the agent id. */
export async function createTestCallToken(agentId: string, userId: string) {
  const roomName = `web-${agentId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `user-${userId}`,
    ttl: "15m",
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata: JSON.stringify({ agentId }) })],
  });
  return { roomName, token: await token.toJwt(), url: process.env.NEXT_PUBLIC_LIVEKIT_URL! };
}

/** Token for a website visitor's voice call through a widget. */
export async function createWidgetCallToken(agentId: string, widgetId: string) {
  const id = crypto.randomUUID();
  const roomName = `widget-${id.slice(0, 13)}`;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `visitor-${id.slice(0, 8)}`,
    ttl: "10m",
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata: JSON.stringify({ agentId, widgetId }) })],
  });
  return { roomName, token: await token.toJwt(), url: process.env.NEXT_PUBLIC_LIVEKIT_URL! };
}
