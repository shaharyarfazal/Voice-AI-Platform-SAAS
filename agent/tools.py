"""The tools an agent can use on a call: built-ins, the client's custom HTTP functions and MCP servers.

Which tools exist is decided per agent in the dashboard; the web app sends them in the agent config.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import socket
from typing import Any, Callable
from urllib.parse import urlparse

import httpx
from livekit import api, rtc
from livekit.agents import RunContext, ToolError, function_tool, get_job_context, mcp

logger = logging.getLogger("voice-agent.tools")

WEB_API_URL = os.environ.get("WEB_API_URL", "http://localhost:3000").rstrip("/")
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
        async def end_call(context: RunContext) -> None:
            """End the call. Use after saying goodbye, when the caller is done."""
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

    for fn in tools_cfg.get("custom") or []:
        tools.append(_custom_function(fn, agent_id=agent_id, room_name=room_name, caller_number=caller_number, log_tool=log_tool))

    return tools


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

