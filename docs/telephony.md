# Connect Telnyx and Twilio numbers

Calls arrive over SIP at your server (`sip:<server-ip>:5060`). LiveKit SIP accepts them only
from the carrier IPs you list in `infra/.env`, then the agent answers based on the number dialled.

Both carriers share one LiveKit trunk. Which carrier owns a number is recorded on the
dashboard's **Phone numbers** page.

## Telnyx

1. In the Telnyx portal, create a **SIP Connection** of type **IP Address** (or FQDN).
2. Set the inbound destination to your server's public IP, port `5060`, transport UDP.
3. Set the number format to **+E.164** so the dialled number arrives as `+14155550100`.
4. Assign your phone numbers to this connection.
5. Copy Telnyx's current SIP signalling IP ranges from their documentation into
   `TELNYX_SIP_IPS` in `infra/.env` (comma-separated).

## Twilio

1. In the Twilio console, create an **Elastic SIP Trunk**.
2. Under **Origination**, add the URI `sip:<server-ip>:5060`.
3. Assign your phone numbers to the trunk.
4. Copy Twilio's current SIP signalling IP ranges for your region from their documentation into
   `TWILIO_SIP_IPS` in `infra/.env`.

## Apply

```sh
cd infra
docker compose up -d agent          # picks up the new .env values
docker compose run --rm agent python setup_sip.py
```

The script is safe to re-run whenever you change the IP lists. Then add each number in the
dashboard and choose its agent. Calls to numbers that aren't in the dashboard are hung up before
any AI provider is called, so they cost nothing.

## Transfers

When an agent has a transfer number, the caller can ask for a person and the agent transfers
the call with a SIP REFER. Your carrier must allow call transfer on the trunk or connection
(in Twilio: enable **Call Transfer (SIP REFER)** on the trunk and allow transfers to the PSTN).

## Outbound calls

Agents can call people (from the dashboard's "Call a number" panel on an outbound agent, or with
`POST /api/v1/calls`). LiveKit dials out through the carrier that owns the caller ID you choose,
using SIP credentials from `infra/.env`:

- **Telnyx:** in the Telnyx portal, create a SIP connection with **Credentials** authentication and
  an outbound voice profile, assign your numbers to it, then set `TELNYX_SIP_USERNAME` and
  `TELNYX_SIP_PASSWORD`. (`TELNYX_SIP_DOMAIN` defaults to `sip.telnyx.com`.)
- **Twilio:** on your Elastic SIP Trunk, under **Termination**, set a termination URI
  (e.g. `yourtrunk.pstn.twilio.com`) and a credential list. Set `TWILIO_SIP_DOMAIN` to that URI and
  `TWILIO_SIP_USERNAME` / `TWILIO_SIP_PASSWORD` to the credential.

Restart with `docker compose up -d` after editing `.env`. The agent waits for the person to answer
before it speaks; unanswered calls are logged with the outcome `no_answer`. At most 10 outbound
calls run at once per workspace.

Calling rules apply to you, not the software: in the US (TCPA) and many other countries you need
the person's prior consent for automated or AI calls, must honour do-not-call requests, and must
call only at reasonable hours. The outbound template tells the agent to end the call politely if
someone asks not to be called again.
