# Web app on Vercel, voice on the VPS

The dashboard, API, billing and webhooks run on Vercel. The VPS only runs the real-time voice stack:
LiveKit, LiveKit SIP, the agent worker and the scheduling engine.

```
Browser ──► Vercel (web: dashboard, API, Stripe webhook, cron) ──► Managed Postgres (Neon / Supabase)
                ▲            │ rooms, tokens, outbound calls              ▲
   agent-config,│            ▼                                            │ scheduler DB
   call reports │   VPS: LiveKit ◄─SIP── carriers                         │
                └── agent worker ──────────────► scheduler (FastAPI) ─────┘
                         │ recordings (presigned PUT)
                         ▼
                Object storage (Cloudflare R2 / S3)
```

## 1. Database

Create a Postgres 16 database on Neon or Supabase. Use its **pooled** connection string for
`DATABASE_URL` on Vercel. On Supabase that is the **session** pooler (port 5432) with
`DATABASE_PREPARE=true`; queries through the transaction pooler (port 6543) can hang until the
function times out.

Moving the existing data: `pg_dump` the VPS database (`docker compose exec postgres pg_dump -U voice voice`)
and restore it into the new one. Then point the VPS scheduler's `DATABASE_URL` at the new database too,
and stop the VPS Postgres.

## 2. Object storage for recordings

Create a bucket (Cloudflare R2 has no egress fees) and an access key that can read and write it.
Set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
The agent asks the web app for a presigned URL and uploads straight to the bucket, so recordings
never pass through Vercel (its functions accept at most 4.5 MB).

Existing recordings on the VPS disk: copy `infra`'s recordings volume into the bucket under
`recordings/` (`rclone copy` or `aws s3 sync`), keeping the `<call id>.mp3` names.

## 3. Vercel project

- Import the repo, set the root directory to `web/`. `vercel.json` sets the build command
  (`npm run vercel-build`, which applies migrations on production builds) and two cron jobs.
- Environment variables: everything in `web/.env.example`. `CRON_SECRET` is required for the cron jobs.
- Preview deployments skip migrations. Give Preview its own `DATABASE_URL` (a Neon branch) and set
  `MIGRATE_PREVIEW=true` if you want previews migrated.
- Cron jobs: `vercel.json` runs both daily, which the Hobby plan allows. The VPS runs them on the real
  schedule with `infra/vercel-cron.sh` (below). On a Pro plan you can instead set them in `vercel.json`
  to `*/5 * * * *` (knowledge) and `0 * * * *` (maintenance) and skip the VPS crontab.

## 4. VPS: voice only

- Point the agent at Vercel: `WEB_API_URL=https://app.yourbrand.com` in the agent's environment.
- Expose LiveKit's API and the scheduler over https so Vercel can reach them, e.g. with Caddy:
  `livekit.example.com → 127.0.0.1:7880` (already there for WebRTC) and
  `scheduler.example.com → 127.0.0.1:8100`. The scheduler already requires a signed token
  (`SCHED_JWT_SECRET`) and the internal token on every request.
- Remove the `web` service from `docker compose` once Vercel serves production.
- Crons: put `WEB_API_URL=https://app.yourbrand.com` and `CRON_SECRET=<same as Vercel>` in
  `/etc/voice-cron.env` (`chmod 600`), then add to root's crontab:
  ```
  */5 * * * * /root/voice/infra/vercel-cron.sh knowledge
  0 * * * *   /root/voice/infra/vercel-cron.sh maintenance
  ```
  One app deployment is enough: all brands share the database, so its queue and cleanup cover them all.

## What changes on Vercel

| Before (one VPS) | On Vercel |
|---|---|
| Migrations at server start | `npm run migrate` in the production build |
| Hourly transcript purge in-process | `/api/cron/maintenance` (hourly) |
| Knowledge queue in-process | Processed after the request that queued it, then `/api/cron/knowledge`; sources cut off mid-run are retried after 20 minutes |
| Recordings on disk | Object storage, presigned links |
| Admin → System health checks reach 127.0.0.1 | Set `LIVEKIT_HTTP_URL`, `AGENT_HEALTH_URL`, `SIP_HEALTH_URL`, `REDIS_URL` to reachable addresses, or those checks show as unreachable |
