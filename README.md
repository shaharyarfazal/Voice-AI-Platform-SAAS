# Voice AI Platform

Multi-tenant AI voice agents for phone and browser calls, on your own infrastructure.

Each company signs up, creates agents (greeting, instructions, voice, model, transfer number),
connects phone numbers, and sees every call with its transcript and duration.

```
Phone (Telnyx / Twilio) ──SIP──► LiveKit SIP ─┐
Browser test call ─────WebRTC───────────────► LiveKit server ──► agent worker (Python)
                                                                  Deepgram → OpenAI → Cartesia
                                                                         │
                                                       config + call log ▼
                                         web: Next.js dashboard and API ── Postgres
```

| Directory | What it is |
|---|---|
| `agent/` | LiveKit Agents worker: speech-to-text, LLM, text-to-speech, turn detection, transfer and hang-up tools. Reports each call to the web API. |
| `web/` | Next.js dashboard and API: sign-up, agents, phone numbers, calls, browser test calls. |
| `infra/` | Docker Compose for one server: LiveKit, LiveKit SIP, Postgres, Redis, Caddy. |
| `docs/` | [Deploy on a VPS](docs/deploy-vps.md), [connect Telnyx and Twilio](docs/telephony.md). |

## How a call works

1. A call reaches LiveKit, either from a carrier over SIP or from the dashboard's test button.
2. LiveKit dispatches the `voice-agent` worker into the call's room.
3. The agent fetches its configuration from `GET /api/internal/agent-config`, by the dialled
   number or, for test calls, by agent id. Unknown numbers are hung up straight away.
4. The agent greets the caller and runs the conversation.
5. When the call ends, the agent posts the duration, outcome and transcript to
   `POST /api/internal/calls`.

## Local development

You need Node 22, Python 3.11, Postgres 16, and a LiveKit server (`livekit-server --dev`).

```sh
# Database
createdb voice && psql voice -f web/db/schema.sql

# Web
cd web && npm install
cat > .env.local <<EOF
DATABASE_URL=postgres://localhost/voice
SESSION_SECRET=$(openssl rand -hex 32)
INTERNAL_API_TOKEN=dev-internal-token
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
EOF
npm run dev

# Agent (in another terminal)
cd agent && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m livekit.agents download-files
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
WEB_API_URL=http://localhost:3000 INTERNAL_API_TOKEN=dev-internal-token \
DEEPGRAM_API_KEY=... OPENAI_API_KEY=... CARTESIA_API_KEY=... \
python -m livekit.agents start agent.py
```

Then sign up at http://localhost:3000, create an agent and press **Start test call**.

## Not built yet

- Billing and plan limits (call minutes are already recorded per tenant)
- Buying numbers from the dashboard through the Telnyx/Twilio APIs. Today numbers are bought
  in the carrier portal and added by hand, and any tenant can claim any unregistered number.
- Booking tools (calendar), knowledge base, post-call webhooks
- Password reset and team members
- Outbound calls
