# Webhooks, recordings and call analysis

Each agent can send three webhooks to one URL (agent editor → **Recording & webhooks**):

| Event | Sent | Contains |
|---|---|---|
| `call_started` | When the agent answers | call id, agent, direction, caller and dialled numbers, start time |
| `call_ended` | When the call ends | the above + end time, duration, end reason, transcript, recording link |
| `call_analyzed` | A few seconds after the end | everything in `call_ended` + `call_analysis` |

All three carry the same `call_id`. They fire for inbound phone calls (`direction: "inbound"`) and
dashboard test calls (`"web"`); outbound calls will use `"outbound"` once outbound calling exists.

## Request

`POST` with a JSON body:

```json
{
  "event": "call_analyzed",
  "call": {
    "call_id": "82980c6d-3f0e-4c1a-9d43-0f2a51b8e9a1",
    "agent_id": "ef2e1dcd-2382-4c14-9273-e8df685611e4",
    "agent_name": "Front desk",
    "direction": "inbound",
    "from_number": "+14155550100",
    "to_number": "+14155550199",
    "start_timestamp": "2026-10-06T16:53:25.366Z",
    "end_timestamp": "2026-10-06T16:55:00.120Z",
    "duration_seconds": 95,
    "end_reason": "completed",
    "transcript": "Agent: Thanks for calling! How can I help?\nUser: I'd like to book Friday.",
    "transcript_object": [
      { "role": "agent", "content": "Thanks for calling! How can I help?", "timestamp": "2026-10-06T16:53:26.010Z" },
      { "role": "user", "content": "I'd like to book Friday.", "timestamp": "2026-10-06T16:53:30.400Z" },
      { "role": "tool", "content": "book_appointment(...) → Booked", "timestamp": "2026-10-06T16:53:41.900Z" }
    ],
    "recording_url": "https://app.example.com/api/recordings/82980c6d-...?expires=1791910123&signature=...",
    "recording_url_expires_at": "2026-10-13T16:55:00.000Z",
    "call_analysis": {
      "summary": "The caller booked an appointment for Friday at 10 am.",
      "user_sentiment": "positive",
      "call_successful": true,
      "custom_data": { "customer_name": "Sara Khan", "party_size": 4 }
    }
  }
}
```

- `end_reason`: `caller_hung_up`, `completed` (the agent ended the call), `transferred`,
  `silence_timeout`, `time_limit` or `error`.
- `recording_url` is `null` when recording is off. The link works without signing in for 7 days;
  add `&download=1` to get it as a file download. The file is an MP3 (64 kbps stereo, about 0.5 MB per minute) with both sides of the call.
- `call_analysis` is `null` in `call_ended`. `user_sentiment` is `positive`, `neutral`, `negative`
  or `unknown`; `call_successful` is `null` when there was nothing to judge (e.g. a silent call).
  `custom_data` has one key per analysis field you defined, `null` when the call didn't say.

A "Send test" button in the editor sends a sample `call_ended` (with `"test": true`) so you can
map the fields in n8n, Make or Zapier before the first real call.

## Verifying the signature

Headers on every request:

- `x-webhook-event`: the event name
- `x-webhook-id`: unique per delivery (the same across retries)
- `x-webhook-timestamp`: Unix seconds
- `x-webhook-signature`: `v1=` + hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with your
  signing secret (shown in the editor, starts with `whsec_`)

Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isValid(rawBody, headers, secret) {
  const ts = headers["x-webhook-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // reject replays
  const expected = "v1=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const given = headers["x-webhook-signature"] ?? "";
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
```

In n8n, turn on the Webhook node's **Raw Body** option and check the signature in a Code node with
the same calculation (`require('crypto')`).

## Delivery

- Only public `https://` URLs are accepted; redirects aren't followed.
- A request counts as delivered on any 2xx answer within 10 seconds. Failed deliveries are retried
  twice, 10 and 60 seconds later. Each call's page lists its deliveries and their results.
- Retries live in the web app's memory: restarting the web container drops pending retries.

## Recordings and retention

Recording is on by default, including for agents created before this feature; turn it off per agent. The agent records both sides
on the agent server and uploads the file to the web app, which stores it in the `recordings`
Docker volume. Recordings, transcripts and analyses are deleted after the client's retention
period (Admin → Clients → "Delete transcripts and recordings after").

Many places require telling callers they are being recorded (for example California, most of the
EU and two-party-consent states). Keep "Tell callers they're speaking to an AI" on, and make sure
the disclosure in Admin → Settings mentions recording, e.g. "This call is answered by an AI
assistant and may be recorded."
