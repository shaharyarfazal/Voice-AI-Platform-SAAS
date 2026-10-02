# Deploy on a VPS (Contabo or similar)

Everything runs on one server with Docker Compose: LiveKit (media), LiveKit SIP (phone calls),
the voice agent, the dashboard, Postgres, Redis and Caddy (HTTPS).

A 6 vCPU / 12 GB server is enough to start. The AI work (speech-to-text, LLM, text-to-speech)
happens at Deepgram, OpenAI and Cartesia, so the server mostly forwards audio. Each live call
runs in its own agent process; watch CPU and memory as call volume grows (see "Capacity" below).

## 1. Prepare the server

Use Ubuntu 22.04 or 24.04. Install Docker:

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

## Server already runs nginx

If nginx already listens on ports 80/443 (for example in front of n8n), keep it and skip Caddy:

1. Delete the `COMPOSE_PROFILES=caddy` line from `infra/.env`, then start the stack as above.
2. Add the site, with your domains in place of the examples:

   ```sh
   sed -e 's/app.example.com/app.yourdomain.com/' -e 's/livekit.example.com/livekit.yourdomain.com/' \
     infra/nginx/voice-platform.conf | sudo tee /etc/nginx/sites-available/voice-platform.conf
   sudo ln -s /etc/nginx/sites-available/voice-platform.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. Add HTTPS with certbot (it edits the site and renews the certificates):

   ```sh
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d app.yourdomain.com -d livekit.yourdomain.com
   ```

Call audio does not pass through nginx, so the UDP ports above must still be open.

## 4. Phone calls

Follow [telephony.md](telephony.md) to point Telnyx and/or Twilio numbers at the server, then:

```sh
docker compose run --rm agent python setup_sip.py
```

Add each number on the **Phone numbers** page and pick the agent that answers it.

## Admin panel

Put your login email in `PLATFORM_ADMIN_EMAILS` in `infra/.env` and restart the dashboard
(`docker compose up -d web`). An **Admin panel** link then appears in your dashboard, at
`/admin`. Start in **Settings**: enter your provider prices so costs and margins are real.

## Where the data lives

Everything is in the Postgres container (`infra-postgres-1`), stored in the Docker volume
`infra_postgres-data` on the server's disk. It is reachable only from the server itself
(127.0.0.1:15432). Open a SQL shell with `docker compose exec postgres psql -U voice voice`.
The tables are created and upgraded automatically when the dashboard starts.

## Updating

```sh
git pull && cd infra && docker compose up -d --build
```

The agent drains live calls before it restarts (`stop_grace_period: 2m`).
Database changes are applied automatically when the dashboard restarts.

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
