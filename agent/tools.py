"""The tools an agent can use on a call: built-ins, the client's custom HTTP functions and MCP servers.

Which tools exist is decided per agent in the dashboard; the web app sends them in the agent config.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import logging
import os
import re
import socket
from typing import Any, Callable
from urllib.parse import urlparse

import httpx
from livekit import api, rtc
from livekit.agents import RunContext, ToolError, function_tool, get_job_context, mcp

logger = logging.getLogger("voice-agent.tools")

WEB_API_URL = os.environ.get("WEB_API_URL", "http://localhost:3000").rstrip("/")
SCHEDULER_URL = os.environ.get("SCHEDULER_URL", "http://127.0.0.1:8100").rstrip("/")
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
MAX_RESULT_CHARS = 2000

# Called with (tool name, arguments, result) so each tool use lands in the call transcript.
ToolLogger = Callable[[str, dict, str], None]


class UnsafeURL(Exception):
    pass


def assert_public_url(url: str) -> None:
    """Custom functions and MCP servers are entered by clients, so they must not reach this server or
    its private network (databases, LiveKit, cloud metadata). Only public https addresses pass."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise UnsafeURL("only https:// URLs are allowed")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeURL(f"cannot resolve {parsed.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeURL(f"{parsed.hostname} resolves to a private address")


async def _internal(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{WEB_API_URL}{path}", json=payload, headers={"authorization": f"Bearer {INTERNAL_API_TOKEN}"}
        )
    try:
        return res.json()
    except ValueError:
        return {"ok": False, "message": "The booking service didn't respond properly."}


async def _scheduler(path: str, payload: dict, agent_id: str) -> dict:
    """POST to the scheduling engine as this agent. Always returns a dict with `ok` and `message`."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{SCHEDULER_URL}{path}",
                json=payload,
                headers={"authorization": f"Bearer {INTERNAL_API_TOKEN}", "x-agent-id": agent_id},
            )
        return res.json()
    except (httpx.HTTPError, ValueError):
        logger.exception("scheduler call failed: %s", path)
        return {"ok": False, "message": "The booking system didn't respond. Apologise and offer to take a message."}


def _idempotency_key(room_name: str, tool: str, args: dict) -> str:
    """The same tool call with the same arguments in the same call gets the same key, so a model
    retrying a call can't book twice; changed arguments make a new request."""
    raw = json.dumps({"room": room_name, "tool": tool, "args": args}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


def _with_alternatives(result: dict) -> str:
    message = str(result.get("message", ""))
    alternatives = result.get("alternatives") or []
    if alternatives:
        message += " Alternatives (label → slot_id): " + "; ".join(f"{a['label']} → {a['slot_id']}" for a in alternatives)
    if result.get("appointments"):
        message += " Appointments: " + "; ".join(
            f"{a['service']} {a['label']} (date {a['start'][:10]})" for a in result["appointments"]
        )
    return message


_CLOSING = re.compile(
    r"\b(bye|goodbye|good night|that'?s (all|it)|nothing else|no,? thanks|no thank you|hang up|end the call|"
    r"i'?m (good|done|all set)|have a (good|great|nice))\b",
    re.IGNORECASE,
)


def _caller_is_done(context: RunContext) -> bool:
    """True when the last thing the caller said, or the agent's last reply, sounds like the end of the call.
    Models sometimes call end_call in the middle of a conversation; this stops them."""
    try:
        items = [i for i in context.session.history.items if getattr(i, "type", None) == "message"]
    except Exception:
        return True  # can't tell: don't block hanging up
    last_user = next((i.text_content or "" for i in reversed(items) if i.role == "user"), "")
    last_agent = next((i.text_content or "" for i in reversed(items) if i.role == "assistant"), "")
    return bool(_CLOSING.search(last_user) or _CLOSING.search(last_agent))


def build_tools(
    config: dict,
    *,
    caller: rtc.RemoteParticipant,
    room_name: str,
    caller_number: str | None,
    session_userdata: dict,
    log_tool: ToolLogger,
) -> list:
    tools_cfg = config.get("tools") or {}
    agent_id = config["id"]
    tools: list = []

    if tools_cfg.get("endCall", True):

        @function_tool(name="end_call")
        async def end_call(context: RunContext) -> str | None:
            """Hang up. ONLY use this when the caller has clearly finished: they said goodbye, said they
            need nothing else, or asked to end the call, AND you have already said goodbye to them.
            Never use it while you are asking a question, collecting details (name, email, time zone,
            date) or booking something: in that case keep the conversation going."""
            if not _caller_is_done(context):
                log_tool("end_call", {}, "refused: the caller hadn't finished")
                return (
                    "Not ending the call: the caller hasn't said goodbye or asked to hang up. "
                    "Carry on with the conversation and respond to what they just said."
                )
            await context.wait_for_playout()
            session_userdata["outcome"] = "completed"
            log_tool("end_call", {}, "call ended")
            job = get_job_context()
            try:
                await asyncio.wait_for(job.room.local_participant.set_attributes({"end_reason": "completed"}), timeout=1.5)
            except Exception:
                pass
            job.delete_room()

        tools.append(end_call)

    transfer_number = tools_cfg.get("transferNumber")
    if tools_cfg.get("transferCall") and transfer_number:

        @function_tool(name="transfer_call")
        async def transfer_call(context: RunContext) -> str:
            """Transfer the caller to a person. Use when they ask for a human or you can't help.
            Tell the caller you're transferring them before calling this."""
            if caller.kind != rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
                return "This is a browser call, so it can't be transferred. Offer to take a message instead."
            await context.wait_for_playout()
            job = get_job_context()
            try:
                await job.api.sip.transfer_sip_participant(
                    api.TransferSIPParticipantRequest(
                        room_name=job.room.name,
                        participant_identity=caller.identity,
                        transfer_to=f"tel:{transfer_number}",
                    )
                )
            except Exception as e:
                logger.exception("transfer failed")
                log_tool("transfer_call", {}, f"failed: {e}")
                return "The transfer didn't go through. Apologise and offer to take a message."
            session_userdata["outcome"] = "transferred"
            log_tool("transfer_call", {}, f"transferred to {transfer_number}")
            return "The caller has been transferred."

        tools.append(transfer_call)

    if tools_cfg.get("knowledge"):

        @function_tool(name="search_knowledge_base")
        async def search_knowledge_base(context: RunContext, query: str) -> str:
            """Look up information about the business: services, prices, opening hours, location, policies,
            products, FAQs. Use it before answering any question about the business.

            Args:
                query: What to look up, as a short question or keywords, e.g. "parking at the clinic".
            """
            # One lookup per question is enough; models otherwise rephrase and search again and again,
            # leaving the caller in silence.
            if session_userdata.get("kb_searches", 0) >= 2:
                return "You've already searched for this. Answer from what you found, or say you'll find out and offer to take a message. Don't search again."
            session_userdata["kb_searches"] = session_userdata.get("kb_searches", 0) + 1
            # Only spoken if the lookup is slow.
            async with context.with_filler("Let me check that for you.", delay=1.5):
                result = await _internal("/api/internal/tools/knowledge", {"agentId": agent_id, "query": query})
            log_tool("search_knowledge_base", {"query": query}, f"{result.get('hits', 0)} passages found")
            if not result.get("hits"):
                return "Nothing in the knowledge base about that. Don't search again: say you're not sure and offer to take a message so someone can get back to them."
            return str(result.get("result"))[:6000] + "\n\nAnswer the caller now from these passages. If they don't cover it, say so; don't search again."

        tools.append(search_knowledge_base)

    if tools_cfg.get("booking"):

        @function_tool(name="check_availability")
        async def check_availability(context: RunContext, date: str) -> str:
            """Find open appointment times on a day.

            Args:
                date: The day to check, as YYYY-MM-DD.
            """
            result = await _internal("/api/internal/tools/availability", {"agentId": agent_id, "date": date})
            message = result.get("message", "No answer from the calendar.")
            if result.get("slots"):
                message += " Exact times to use when booking: " + ", ".join(s["start"] for s in result["slots"])
            log_tool("check_availability", {"date": date}, message)
            return message

        @function_tool(name="book_appointment")
        async def book_appointment(
            context: RunContext,
            start_time: str,
            caller_name: str,
            email: str = "",
            notes: str = "",
        ) -> str:
            """Book an appointment at a time returned by check_availability. Only call this after the caller
            has confirmed the day, time and their name.

            Args:
                start_time: The exact start time from check_availability, as YYYY-MM-DDTHH:MM.
                caller_name: The caller's full name.
                email: The caller's email, only if they want a calendar invitation.
                notes: Anything the business should know, such as the reason for the visit.
            """
            payload = {
                "agentId": agent_id,
                "start": start_time,
                "name": caller_name,
                "phone": caller_number,
                "email": email or None,
                "notes": notes,
                "roomName": room_name,
            }
            result = await _internal("/api/internal/tools/book", payload)
            message = result.get("message", "No answer from the calendar.")
            if result.get("ok"):
                session_userdata["booked"] = True
            log_tool("book_appointment", {"start_time": start_time, "caller_name": caller_name, "email": email}, message)
            return message

        tools += [check_availability, book_appointment]

    if tools_cfg.get("scheduling"):
        tools += _scheduling_tools(
            agent_id=agent_id, room_name=room_name, caller_number=caller_number,
            session_userdata=session_userdata, log_tool=log_tool,
        )

    for fn in tools_cfg.get("custom") or []:
        tools.append(_custom_function(fn, agent_id=agent_id, room_name=room_name, caller_number=caller_number, log_tool=log_tool))

    return tools


def _scheduling_tools(
    *, agent_id: str, room_name: str, caller_number: str | None, session_userdata: dict, log_tool: ToolLogger
) -> list:
    """Booking through the scheduling engine: find a slot, hold it while details are collected, book.
    Ids that are awkward for a model to repeat (hold, caller's phone) are kept in the session."""

    async def call(tool: str, path: str, payload: dict, logged: dict) -> dict:
        result = await _scheduler(path, payload, agent_id)
        log_tool(tool, logged, str(result.get("message", "")))
        return result

    @function_tool(name="check_availability")
    async def check_availability(
        context: RunContext,
        service: str,
        date: str = "",
        time_window: str = "any",
        address: str = "",
        technician: str = "",
        emergency: bool = False,
    ) -> str:
        """Find open times for a job.

        Args:
            service: What the caller needs, e.g. "AC repair" or "furnace tune-up".
            date: The day they asked for, as YYYY-MM-DD. Leave empty for the next openings.
            time_window: "morning", "afternoon", "evening" or "any".
            address: The service address including the ZIP code, if you have it.
            technician: Only if the caller asked for a specific technician by name.
            emergency: True if the system isn't working at all or there's a safety risk.
        """
        payload = {
            "service": service,
            "date": date or None,
            "time_window": time_window if time_window in ("morning", "afternoon", "evening", "any") else "any",
            "address": address or None,
            "technician": technician or None,
            "urgency": "emergency" if emergency else "standard",
        }
        async with context.with_filler("Let me check the schedule.", delay=1.5):
            result = await call("check_availability", "/agent/check_availability", payload, payload)
        message = _with_alternatives(result)
        if result.get("slots"):
            message += " slot_ids to use with hold_slot: " + "; ".join(f"{s['label']} → {s['slot_id']}" for s in result["slots"])
        return message

    @function_tool(name="hold_slot")
    async def hold_slot(context: RunContext, slot_id: str, service: str, address: str = "", technician: str = "", emergency: bool = False) -> str:
        """Hold the time the caller chose for a few minutes while you collect their details. Call it as soon
        as they pick a time.

        Args:
            slot_id: The slot_id from check_availability, as YYYY-MM-DDTHH:MM.
            service: The same service you checked availability for.
            address: The service address including the ZIP code.
            technician: Only if the caller asked for a specific technician.
            emergency: True for an emergency job.
        """
        payload = {
            "slot_id": slot_id, "service": service, "address": address or None, "technician": technician or None,
            "urgency": "emergency" if emergency else "standard", "call_id": room_name,
        }
        payload["idempotency_key"] = _idempotency_key(room_name, "hold_slot", payload)
        result = await call("hold_slot", "/agent/hold_slot", payload, {"slot_id": slot_id, "service": service})
        if result.get("ok"):
            session_userdata["hold_id"] = result["hold_id"]
            session_userdata["hold_emergency"] = emergency
        return _with_alternatives(result)

    @function_tool(name="book_appointment")
    async def book_appointment(
        context: RunContext,
        customer_name: str,
        address: str,
        issue_description: str,
        phone: str = "",
        email: str = "",
    ) -> str:
        """Book the held time. Only call this after hold_slot succeeded and the caller confirmed the day,
        time, address and their name.

        Args:
            customer_name: The caller's full name.
            address: The full service address including the ZIP code.
            issue_description: A short description of the problem in the caller's words.
            phone: The best number to reach them, only if different from the number they're calling from.
            email: Only if the caller wants an email confirmation.
        """
        hold_id = session_userdata.get("hold_id")
        if not hold_id:
            return "Nothing is held yet. Call hold_slot with the time the caller chose first."
        number = phone or caller_number
        if not number:
            return "Ask the caller for a phone number to reach them, then try again."
        payload = {
            "hold_id": hold_id, "customer_name": customer_name, "phone": number, "address": address,
            "issue_description": issue_description, "email": email or None, "call_id": room_name,
            "urgency": "emergency" if session_userdata.get("hold_emergency") else "standard",
        }
        payload["idempotency_key"] = _idempotency_key(room_name, "book_appointment", payload)
        result = await call("book_appointment", "/agent/book_appointment", payload, {"customer_name": customer_name, "address": address})
        if result.get("ok"):
            session_userdata["booked"] = True
            session_userdata.pop("hold_id", None)
        return _with_alternatives(result)

    @function_tool(name="find_appointments")
    async def find_appointments(context: RunContext, phone: str = "") -> str:
        """Look up the caller's upcoming bookings.

        Args:
            phone: Only if the booking was made with a different number than the one they're calling from.
        """
        number = phone or caller_number
        if not number:
            return "Ask the caller which phone number the booking was made with."
        session_userdata["lookup_phone"] = number
        result = await call("find_appointments", "/agent/find_appointments", {"phone": number}, {"phone": "caller" if not phone else phone})
        return _with_alternatives(result)

    @function_tool(name="reschedule_appointment")
    async def reschedule_appointment(context: RunContext, new_slot_id: str, current_date: str = "") -> str:
        """Move the caller's booking to a new time from check_availability. Use find_appointments first.

        Args:
            new_slot_id: The new slot_id from check_availability, as YYYY-MM-DDTHH:MM.
            current_date: The date of the booking being moved (YYYY-MM-DD), if they have more than one.
        """
        number = session_userdata.get("lookup_phone") or caller_number
        payload = {"phone": number, "date": current_date or None, "new_slot_id": new_slot_id}
        payload["idempotency_key"] = _idempotency_key(room_name, "reschedule_appointment", payload)
        result = await call("reschedule_appointment", "/agent/reschedule_appointment", payload, {"new_slot_id": new_slot_id})
        return _with_alternatives(result)

    @function_tool(name="cancel_appointment")
    async def cancel_appointment(context: RunContext, current_date: str = "", reason: str = "") -> str:
        """Cancel the caller's booking after they clearly confirmed. Use find_appointments first.

        Args:
            current_date: The date of the booking (YYYY-MM-DD), if they have more than one.
            reason: Why they're cancelling, if they said.
        """
        number = session_userdata.get("lookup_phone") or caller_number
        payload = {"phone": number, "date": current_date or None, "reason": reason or None}
        payload["idempotency_key"] = _idempotency_key(room_name, "cancel_appointment", payload)
        result = await call("cancel_appointment", "/agent/cancel_appointment", payload, {"date": current_date})
        return _with_alternatives(result)

    return [check_availability, hold_slot, book_appointment, find_appointments, reschedule_appointment, cancel_appointment]


def _custom_function(fn: dict, *, agent_id: str, room_name: str, caller_number: str | None, log_tool: ToolLogger):
    name, url = fn["name"], fn["url"]
    parameters = fn.get("parameters") or {"type": "object", "properties": {}}
    headers = {"content-type": "application/json", "user-agent": "voice-agent/1.0"}
    if fn.get("authorization"):
        headers["authorization"] = fn["authorization"]

    async def handler(raw_arguments: dict[str, object], context: RunContext) -> str:
        if fn.get("speakBefore"):
            # Said once if the request takes a moment, so the caller isn't left in silence.
            async with context.with_filler(fn["speakBefore"], delay=0.8):
                return await _call(raw_arguments)
        return await _call(raw_arguments)

    async def _call(raw_arguments: dict[str, object]) -> str:
        try:
            await asyncio.to_thread(assert_public_url, url)
            body = {"function": name, "arguments": raw_arguments, "call": {"agentId": agent_id, "room": room_name, "from": caller_number}}
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                async with client.stream("POST", url, headers=headers, json=body) as res:
                    # Read only what the agent can use, however large the response is.
                    raw = b""
                    async for part in res.aiter_bytes():
                        raw += part
                        if len(raw) >= MAX_RESULT_CHARS * 4:
                            break
            text = raw.decode("utf-8", errors="replace")[:MAX_RESULT_CHARS]
            if res.status_code >= 400:
                log_tool(name, raw_arguments, f"HTTP {res.status_code}")
                raise ToolError(f"The {name} service returned an error. Tell the caller you couldn't complete that.")
            log_tool(name, raw_arguments, text)
            return text or "Done."
        except UnsafeURL as e:
            log_tool(name, raw_arguments, f"blocked: {e}")
            raise ToolError("That service isn't available. Tell the caller you couldn't complete that.") from e
        except httpx.HTTPError as e:
            log_tool(name, raw_arguments, f"failed: {e}")
            raise ToolError(f"The {name} service didn't respond. Tell the caller you couldn't complete that.") from e

    return function_tool(
        handler,
        raw_schema={"name": name, "description": fn["description"], "parameters": parameters},
    )


def build_mcp_servers(config: dict) -> list:
    """MCP servers the client connected. Unsafe or unreachable addresses are skipped."""
    servers = []
    for server in (config.get("tools") or {}).get("mcp") or []:
        try:
            assert_public_url(server["url"])
        except UnsafeURL as e:
            logger.warning("skipping MCP server %s: %s", server.get("name"), e)
            continue
        headers: dict[str, Any] = {}
        if server.get("authorization"):
            headers["authorization"] = server["authorization"]
        servers.append(
            mcp.MCPServerHTTP(
                url=server["url"],
                headers=headers or None,
                allowed_tools=server.get("allowedTools") or None,
                timeout=10,
            )
        )
    return servers


def describe_args(args: Any) -> str:
    try:
        return json.dumps(args, ensure_ascii=False)[:300]
    except (TypeError, ValueError):
        return str(args)[:300]

