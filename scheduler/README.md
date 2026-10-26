# Scheduling engine

Our own calendar and booking system, and the source of truth for jobs. Voice agents use it to find
open times, hold a slot while the caller gives their details, and book a job for a technician.
People use it from the dashboard's **Schedule** pages.

The core works for any industry. A *vertical pack* (`app/verticals/`, HVAC first) supplies:
- the words users see (technician, job);
- the skills catalog and standard services;
- extra job fields, validated per business;
- the title of a job in external calendars.

```
voice agent ──/agent/*──┐                          ┌── web app /schedule ──/api/schedule/* (session)
third-party agent ──────┤  FastAPI  (127.0.0.1:8100) │        └─ mints 60s JWT ──▶ /v1/*
  (vk_ API key)         └─▶ app/api ──▶ app/core ──▶ Postgres schema "sched" (RLS per business)
                                          │
                       arq worker ◀─Redis─┘  hold expiry, calendar push (phase 2: sync, webhooks)
```

## What guarantees what

- **No double booking.** The `bookings_no_overlap` exclusion constraint applies to held and
  confirmed jobs: `EXCLUDE USING gist (staff_id WITH =, blocked_range WITH &&)`. Postgres decides
  every race, not application code. `tests/test_concurrency.py` checks this four ways:
  - 50 simultaneous callers for one technician: exactly one wins;
  - two technicians: exactly two win;
  - overlapping slots race against each other;
  - raw inserts that skip the availability check entirely.
- **Holds.** `hold_slot` reserves the slot for `hold_ttl_sec` (default 3 minutes).
  - The worker expires lapsed holds every 30 seconds, and a new hold also clears lapsed holds in its way.
  - If a hold lapses before booking, `book_appointment` re-holds the same time when it's still free.
- **Live check at confirm.** Before confirming, the engine asks the technician's connected calendar
  for that exact interval (`connectors.live.live_busy`).
- **Retries are safe.** Book, reschedule and cancel need an `idempotency_key`; hold accepts one.
  - A retry gets the stored response.
  - The same key with a different request gets `409 idempotency_mismatch`.
  - Concurrent retries serialise on the key's primary key.
- **Tenant isolation.** Every query filters by `business_id`, and row-level security on every
  `sched` table backs that up.
  - The API connects as role `sched_app`, which is subject to RLS. The role is set as a connection
    startup parameter, so a rolled-back transaction can't drop it.
  - Workers use `sched_worker`, which has `BYPASSRLS`.
  - A tenant whose `status` isn't `active` is locked out.
- **Time zones.** Everything is stored in UTC. Working hours are wall-clock minutes in each person's
  IANA zone, expanded per day with `zoneinfo`, so DST is handled. The agent speaks in the business's
  local time.

## Layout

| Path | What |
|---|---|
| `app/core/availability.py` | Slots: working hours − time off − held/confirmed jobs − external busy, with buffers, notice, max days ahead, daily caps, skills and ZIP zones |
| `app/core/booking.py` | State machine: hold → confirm → complete; reschedule, cancel, expire |
| `app/core/assignment/` | Who gets the job. `least_busy` now; strict round-robin, weighted and priority are Phase 4 (until then they fall back, and the booking's `assignment_reason` says so) |
| `app/connectors/` | `CalendarConnector` interface (OAuth, free/busy, events, webhooks, incremental sync) and the hooks the engine calls |
| `app/verticals/` | Industry packs |
| `app/api/agent.py`, `app/api/calls.py` | Voice agent tool API ([openapi/agent.yaml](openapi/agent.yaml)) |
| `app/api/dashboard/` | `/v1/*` for the web app |
| `alembic/versions/` | Migrations for schema `sched`; they also create the roles, RLS policies and grants |

## Voice agent tool API

Authenticate with one of:
- **Our own agent:** `Authorization: Bearer $INTERNAL_API_TOKEN` and `X-Agent-Id: <agent uuid>`.
- **Other agents:** a workspace API key, `Authorization: Bearer vk_…`.

| Endpoint | Purpose |
|---|---|
| `POST /agent/check_availability` | `service`, optional `date`/`time_window`/`address`/`technician`/`urgency` → up to `limit` slots spread over the day(s), each with a `slot_id` (local `YYYY-MM-DDTHH:MM`) |
| `POST /agent/hold_slot` | `slot_id`, `service` → `hold_id`, technician first name, expiry |
| `POST /agent/book_appointment` | `hold_id`, customer name, phone, address, issue, `call_id`, `idempotency_key` → confirmation code, day, arrival window, technician |
| `POST /agent/find_appointments` | caller's phone → upcoming jobs |
| `POST /agent/reschedule_appointment` | by `booking_id`, or phone (+ date) → moved in one transaction |
| `POST /agent/cancel_appointment` | by `booking_id`, or phone (+ date) |
| `POST /calls/{call_id}/artifacts` | recording (URL or file), transcript and summary after the call |

Every response has `ok` and a `message` the LLM can say aloud. Errors add a stable `code` and,
where it helps, `alternatives` (the nearest open slots). Our own agent's recordings and transcripts
are already stored by the web app (`public.calls`); the job drawer reads them from there by
`call_id`, so `/calls/{id}/artifacts` is for third-party agents.

To turn it on for an agent, enable **Book jobs for your team** on the agent's Tools tab
(`tools.scheduling`). The agent then gets the six tools in `agent/tools.py`.

## Running it

In production it runs from `infra/docker-compose.yml` as `scheduler` (API) and `scheduler-worker`.
Set `SCHED_JWT_SECRET` in `infra/.env` (any random 32+ characters, e.g. `openssl rand -hex 32`),
then:

```sh
cd infra && docker compose up -d --build scheduler scheduler-worker web agent
```

Then set up a workspace on **Schedule → Services & settings**, or seed demo data:

```sh
docker compose exec scheduler python -m scripts.seed --tenant-id <workspace id> --jobs
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…`, the web app's database. The connecting user must be able to create roles and `SET ROLE` (the compose `voice` superuser can) |
| `REDIS_URL` | arq queue (compose uses database 2) |
| `INTERNAL_API_TOKEN` | shared with the web app and agent |
| `SCHED_JWT_SECRET` | shared with the web app; signs dashboard requests |
| `ENCRYPTION_KEY` | same as the web app; encrypts OAuth tokens in the same format as `web/lib/crypto.ts` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | technicians' Google calendars (same client as sign-in) |
| `APP_URL` | public address of the web app: OAuth redirect and webhook URLs are built from it |
| `SYNC_HORIZON_DAYS` | how far ahead busy time is cached (default 90) |
| `STORAGE_DRIVER` | `local` (private volume, signed links) or `s3` (`S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_REGION`; install the `s3` extra) |
| `DB_APP_ROLE`, `DB_WORKER_ROLE` | default `sched_app` / `sched_worker` |

## Tests

They need a real Postgres 16, because the guarantees under test live in the database. Point
`TEST_DATABASE_URL` at a throwaway database: it is wiped. For example:

```sh
docker network create sched-test
docker run -d --name sched-test-db --network sched-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sched_test postgres:16-alpine
docker build --target dev -t sched-dev scheduler
docker run --rm --network sched-test -v $PWD/scheduler:/app \
  -e TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@sched-test-db:5432/sched_test sched-dev python -m pytest -q
```

After changing the agent API, regenerate the spec with `python -m scripts.export_openapi`
(a test fails if it's stale).

## Calendar sync (Google)

**Connecting.** Schedule → Team → *Connect Google Calendar* (an admin, on the technician's behalf),
or *Send a link instead* (the technician opens it and connects their own account; valid 7 days).
- The OAuth `state` is HMAC-signed and names the business and technician.
- A nonce cookie ties the callback to the browser that started the flow.
- Tokens are AES-GCM encrypted (`ENCRYPTION_KEY`) and never logged.
- On connect, the primary calendar is used for busy time and receives jobs; this can be changed per
  calendar. Future events (now → `SYNC_HORIZON_DAYS`, default 90) are imported and a push channel
  is opened.

**Calendar → engine.**
- Google notifies `/api/schedule-webhooks/google`. The web app forwards it; the engine checks the
  channel's secret, acknowledges at once, and runs an incremental sync (sync token) in the background.
- Busy times go into `external_busy_blocks`. Event titles are never stored.
- Events we wrote are recognised by a private extended property (`sched_booking_id`). Echoes of our
  own writes are ignored using the etag and the times we pushed.
- If someone **moves** our event, the job follows if that time is free; otherwise it's only flagged.
- If someone **deletes** our event, the job is flagged, not canceled. Either way it shows as
  "changed outside the schedule" for review: keep, revert, put back, or cancel.

**Engine → calendar.**
- After each change a job is queued that makes the calendar match the job. Event ids are derived
  from the booking id, so retries can't duplicate. The event carries the address (location), the
  customer's phone and the issue, plus a link to the job; never the transcript.
- Transient errors retry in place, then the job retries with exponential backoff (6 tries).
- After that the job goes to `sync_failures`, which the dashboard shows with a Retry button.

**At confirm,** the engine asks Google's free/busy for the exact interval; the cache isn't trusted
for this. If Google is unreachable it falls back to the cache and counts it in
`sched_live_check_fallback_total`.

**Revoked access** sets the account to `needs_reauth`. By default the technician is then not
auto-booked (`unavailable_on_reauth`), and the Schedule page asks for a reconnect. Other technicians
are unaffected.

**Scheduled jobs (worker):**

| Job | When |
|---|---|
| Hold expiry | every 30 s |
| Reconciliation sync | every 10 min (full re-list of the window once a day) |
| Token refresh | every 10 min |
| Channel renewal | hourly; channels last 7 days and are renewed a day early |

**Webhooks in local development.** Google only calls public HTTPS addresses. Expose the web app with
a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`). Then:
- set `APP_URL` to the tunnel's URL for both the web app and the scheduler;
- add `<tunnel>/api/schedule-oauth/google/callback` as a redirect URI on a *development* OAuth client.

Without a tunnel everything still works: changes arrive through the 10-minute reconciliation, and
the live check at confirm is unaffected.

Microsoft (Phase 3), iCloud and CRMs plug into `app/connectors/` the same way.
