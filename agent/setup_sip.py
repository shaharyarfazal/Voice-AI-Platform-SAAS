"""One-time SIP setup: one inbound trunk for all carriers plus one dispatch rule that sends every
call to the voice agent in its own room. Safe to re-run; the trunk and the rule are updated.

Run on the server:  docker compose run --rm agent python setup_sip.py

The trunk only accepts calls from the carriers' signalling IPs (TELNYX_SIP_IPS, TWILIO_SIP_IPS),
for any dialled number. The agent looks the number up and hangs up on unknown ones before any AI
provider is called. LiveKit allows only one "any number" trunk per IP set, so both carriers share
one trunk; which carrier owns a number is recorded in the dashboard.
"""

from __future__ import annotations

import asyncio
import os

from livekit import api

AGENT_NAME = os.environ.get("AGENT_NAME", "voice-agent")
TRUNK_NAME = "carriers"
RULE_NAME = "inbound-to-agent"


def _ips(name: str) -> list[str]:
    return [ip.strip() for ip in os.environ.get(name, "").split(",") if ip.strip()]


async def main() -> None:
    allowed = _ips("TELNYX_SIP_IPS") + _ips("TWILIO_SIP_IPS")
    if not allowed:
        # LiveKit refuses a trunk that accepts calls from anyone.
        raise SystemExit("Set TELNYX_SIP_IPS and/or TWILIO_SIP_IPS in infra/.env first.")

    lk = api.LiveKitAPI(url=os.environ["LIVEKIT_URL"].replace("ws", "http", 1))
    try:
        trunk = api.SIPInboundTrunkInfo(name=TRUNK_NAME, numbers=[], allowed_addresses=allowed)
        existing = [
            t for t in (await lk.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())).items if t.name == TRUNK_NAME
        ]
        if existing:
            trunk.sip_trunk_id = existing[0].sip_trunk_id
            await lk.sip.update_inbound_trunk(trunk.sip_trunk_id, trunk)
            print(f"updated trunk {TRUNK_NAME} ({trunk.sip_trunk_id})")
        else:
            trunk.sip_trunk_id = (
                await lk.sip.create_inbound_trunk(api.CreateSIPInboundTrunkRequest(trunk=trunk))
            ).sip_trunk_id
            print(f"created trunk {TRUNK_NAME} ({trunk.sip_trunk_id})")
        print(f"  accepting calls from {len(allowed)} address range(s)")

        for rule in (await lk.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())).items:
            if rule.name == RULE_NAME:
                await lk.sip.delete_dispatch_rule(
                    api.DeleteSIPDispatchRuleRequest(sip_dispatch_rule_id=rule.sip_dispatch_rule_id)
                )
        rule = await lk.sip.create_dispatch_rule(
            api.CreateSIPDispatchRuleRequest(
                name=RULE_NAME,
                trunk_ids=[trunk.sip_trunk_id],
                rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix="call-")),
                room_config=api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME)]),
            )
        )
        print(f"dispatch rule {RULE_NAME} ({rule.sip_dispatch_rule_id}) -> agent '{AGENT_NAME}'")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
