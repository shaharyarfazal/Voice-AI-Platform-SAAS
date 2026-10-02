# Deploy on a VPS (Contabo or similar)

Everything runs on one server with Docker Compose: LiveKit (media), LiveKit SIP (phone calls),
the voice agent, the dashboard, Postgres, Redis and Caddy (HTTPS).

A 6 vCPU / 12 GB server is enough to start. The AI work (speech-to-text, LLM, text-to-speech)
happens at Deepgram, OpenAI and Cartesia, so the server mostly forwards audio. Each live call
runs in its own agent process; watch CPU and memory as call volume grows (see "Capacity" below).

## 1. Prepare the server

Use Ubuntu 24.04. Install Docker:

```sh
curl -fsSL https://get.docker.com | sh
```

Open these ports in the firewall (and in Contabo's firewall, if you enabled it):

| Port | Protocol | Used for |
|---|---|---|
| 22 | TCP | SSH |
| 80, 443 | TCP | Dashboard and LiveKit over HTTPS (Caddy) |
| 7881 | TCP | WebRTC over TCP fallback |
| 50000–60000 | UDP | WebRTC media (browser calls) |
| 5060 | UDP and TCP | SIP signalling from Telnyx/Twilio |
| 10000–20000 | UDP | SIP call audio (RTP) |

With `ufw`:

```sh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 7881/tcp
ufw allow 50000:60000/udp && ufw allow 5060 && ufw allow 10000:20000/udp
ufw enable
```

Postgres and Redis listen on 127.0.0.1 only and must not be opened.

## 2. DNS

Create two A records pointing at the server's public IP, for example:

- `app.yourdomain.com` (dashboard)
- `livekit.yourdomain.com` (browser test calls)

## 3. Configure and start

```sh
git clone https://github.com/shaharyarfazal/voice-ai-platform-saas.git
cd voice-ai-platform-saas/infra
cp .env.example .env
nano .env            # fill in every value; generate secrets with: openssl rand -hex 32
docker compose up -d --build
docker compose logs -f agent    # wait for "registered worker"
```

Open `https://app.yourdomain.com`, sign up, create an agent and press **Start test call**.

## 4. Phone calls

Follow [telephony.md](telephony.md) to point Telnyx and/or Twilio numbers at the server, then:

```sh
docker compose run --rm agent python setup_sip.py
```

Add each number on the **Phone numbers** page and pick the agent that answers it.

## Updating

```sh
git pull && cd infra && docker compose up -d --build
```

The agent drains live calls before it restarts (`stop_grace_period: 2m`).
The database schema in `web/db/schema.sql` is applied only when the Postgres volume is first
created; apply later schema changes by hand with `docker compose exec postgres psql -U voice voice`.

## Backups

```sh
docker compose exec postgres pg_dump -U voice voice | gzip > backup-$(date +%F).sql.gz
```

Run it from cron and copy the files off the server.

## Capacity

There is no reliable per-call figure until you measure real calls on your server. To measure:
run several test calls at once and watch `docker stats`. The agent worker stops accepting new
calls when the server's CPU load passes 70% (LiveKit's default), so callers are never put on an
overloaded server. When you outgrow one server, run more `agent` containers on other machines
pointed at the same LiveKit URL; LiveKit spreads calls across them.
