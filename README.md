# Voice AI Platform

Multi-tenant AI voice agents for phone and browser calls, on your own infrastructure.

Each business signs up, answers a short setup wizard (its website is read into a knowledge base), and
gets a phone receptionist, an outbound caller and a website chatbot ready to use. Teams share
workspaces; agencies resell to clients under their own brand with sub-accounts.

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
| `agent/` | LiveKit Agents worker. `providers.py` builds speech-to-text, LLM and voice from each agent's provider chain with automatic fallback; `tools.py` has the built-in tools (end call, transfer, check availability, book appointment), clients' custom HTTP functions and MCP servers; `agent.py` runs the call with guardrails (call time limit, silence hang-up, blocked words, apology on failure). |
| `web/` | Next.js dashboard and API: sign-up, agents, phone numbers, calls, browser test calls, and the owner's admin panel at `/admin`. Database migrations run on startup (`web/lib/migrations.ts`). |
| `infra/` | Docker Compose for one server: LiveKit, LiveKit SIP, Postgres, Redis, Caddy. |
| `docs/` | [Deploy on a VPS](docs/deploy-vps.md), [connect Telnyx and Twilio (inbound and outbound)](docs/telephony.md), [Google and Microsoft sign-in and calendars](docs/integrations.md), [webhooks and recordings](docs/webhooks.md), [white label](docs/white-label.md). The REST API reference is built in at `/docs`. |

## How a call works

1. A call reaches LiveKit, either from a carrier over SIP or from the dashboard's test button.
2. LiveKit dispatches the `voice-agent` worker into the call's room.
3. The agent fetches its configuration from `GET /api/internal/agent-config`, by the dialled
   number or, for test calls, by agent id. Unknown numbers are hung up straight away.
4. The agent greets the caller and runs the conversation.
5. When the call ends, the agent uploads the recording, posts the duration, outcome and
   transcript to `POST /api/internal/calls`, then has the LLM analyse the call and posts that to
   `POST /api/internal/calls/analysis`. The web app sends the client's `call_started`,
   `call_ended` and `call_analyzed` webhooks along the way.

## Local development

You need Node 22, Python 3.11, Postgres 16, and a LiveKit server (`livekit-server --dev`).

```sh
# Database (tables are created by the web app on startup)
createdb voice

# Web
cd web && npm install
cat > .env.local <<EOF
DATABASE_URL=postgres://localhost/voice
SESSION_SECRET=$(openssl rand -hex 32)
INTERNAL_API_TOKEN=dev-internal-token
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
PLATFORM_ADMIN_EMAILS=you@example.com
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

Unit tests: `cd web && npm test`.

## What clients can configure per agent

- **Voice & language:** 27 languages or multilingual auto-detect, picked from searchable lists.
  Standard mode: the LLM (OpenAI, Claude, Gemini, Groq), speech recognition (Deepgram, AssemblyAI,
  ElevenLabs Scribe, OpenAI) and voice (Cartesia, ElevenLabs, OpenAI, Deepgram), with every other
  provider that has an API key as an automatic fallback. The model and voice lists come live from each
  provider's API (your ElevenLabs and Cartesia voice libraries included), with curated, annotated
  defaults. OpenAI Realtime mode: one speech-to-speech model with OpenAI's voices.
- **Test calls** from the browser show a live transcript as you talk.
- **Tools:** end call, transfer to a person, check availability and book appointments in a
  connected Google or Outlook calendar.
- **Custom functions and MCP servers:** call the client's own systems during a call.
  Only public https addresses are allowed; credentials are stored encrypted.
- **Guardrails:** allowed topics, forbidden topics, blocked words, maximum call length, silence
  timeout. Platform-wide rules (no prompt leaks, no made-up facts, emergencies to 911/112) always apply.
- **Recording & webhooks:** call recording (MP3), `call_started` / `call_ended` / `call_analyzed`
  webhooks (signed, with transcript and recording link), and post-call analysis: summary,
  sentiment, success, and custom fields to extract. See [docs/webhooks.md](docs/webhooks.md).
- **Call audio:** "noisy places" mode (stricter voice detection, a few words needed to interrupt,
  and AssemblyAI voice isolation when AssemblyAI is the speech recognizer) and response speed
  (how long a pause ends the caller's turn). Every call records its response time and where the
  time went (pause detection, AI first word, voice first audio) on the call page.

LiveKit's own noise and background-voice cancellation only works on LiveKit Cloud; on a
self-hosted server it reports "not authorized" and passes audio through unchanged.

## Platform features

- **Workspaces and teams:** invite people by link with owner, admin or member roles; switch between
  workspaces; agencies create client sub-accounts with their own branding and custom domain.
- **Setup wizard:** business details, then the website is crawled (or documents uploaded), an AI
  writes a business profile, and three agents are created from templates the platform admin edits
  under Admin → Templates.
- **Knowledge base:** websites (sitemap + links, up to 200 pages), single pages, PDF, Word, text and
  CSV. Passages are embedded with OpenAI (`text-embedding-3-small`) when the web app has
  `OPENAI_API_KEY`, and searched together with keyword matching. Agents call
  `search_knowledge_base` during calls and chats.
- **Chatbots:** agents of type chat, answered by the web app with the agent's LLM (Claude through
  Anthropic's SDK; OpenAI, Gemini and Groq through their OpenAI-compatible APIs) with the same
  knowledge, booking and custom functions. Agents can be duplicated and exported/imported as JSON.
- **Widgets:** one `<script>` tag for chat, click-to-call or both. Public widget keys only reach their
  agent, from listed websites, within rate limits; each chat has its own signed token.
- **Outbound calls** from the dashboard or `POST /api/v1/calls`, with per-call details for the agent.
- **REST API** with expiring API keys (stored hashed, shown once), documented at `/docs` with an
  OpenAPI file at `/api/v1/openapi.json`.

## Admin panel

Users listed in `PLATFORM_ADMIN_EMAILS` (or promoted on the Users page) get `/admin`:
live calls, service health and server load (refreshing every 5 seconds), clients (create, price,
suspend, minute limits, transcript retention), users, every call with its cost, monthly billing
with CSV export, and platform settings (AI disclosure, safety rules, provider rates). Everyone
else gets a 404 there.

## Not built yet

- Taking payments (Stripe). Billing amounts and a CSV export exist; invoicing is manual.
- Buying numbers from the dashboard through the Telnyx/Twilio APIs. Today numbers are bought
  in the carrier portal and added by hand, and any tenant can claim any unregistered number.
- SMS confirmations
- Password reset by email, and sending invites by email (invite links are copied and shared by hand)
- Bulk outbound campaigns (calls are placed one at a time from the dashboard or the API)
