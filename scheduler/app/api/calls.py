"""Post-call artifacts: recording, transcript and summary, attached to the jobs booked on that call."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..context import RequestContext
from ..core.audit import audit
from ..errors import ApiError
from ..models import Booking, CallArtifact
from ..schemas.agent import ArtifactsIn, ArtifactsOut, ErrorOut
from ..security.auth import agent_context
from ..storage import LocalStorage, get_storage, verify_signature
from .deps import run

router = APIRouter(tags=["agent"], responses={400: {"model": ErrorOut}, 401: {"model": ErrorOut}})

MAX_RECORDING_BYTES = 200 * 1024 * 1024
RECORDING_TYPES = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm"}


async def _parse(request: Request) -> tuple[ArtifactsIn, tuple[bytes, str] | None]:
    """JSON body, or multipart with a `recording` file plus transcript/summary fields."""
    content_type = request.headers.get("content-type", "")
    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form(max_part_size=MAX_RECORDING_BYTES)
            fields: dict[str, Any] = {}
            for name in ("recording_url", "transcript"):
                if isinstance(form.get(name), str) and form.get(name):
                    fields[name] = form.get(name)
            for name in ("transcript_segments", "summary"):
                if isinstance(form.get(name), str) and form.get(name):
                    fields[name] = json.loads(form.get(name))  # type: ignore[arg-type]
            upload = form.get("recording")
            recording = None
            if upload is not None and not isinstance(upload, str):
                data = await upload.read()
                if len(data) > MAX_RECORDING_BYTES:
                    raise ApiError("too_large", "Recordings can be at most 200 MB.", status=413)
                kind = RECORDING_TYPES.get((upload.content_type or "").split(";")[0])
                if kind is None:
                    raise ApiError("unsupported_media", "Recordings must be MP3, Ogg, WAV or WebM audio.", status=415)
                recording = (data, kind)
            return ArtifactsIn.model_validate(fields), recording
        return ArtifactsIn.model_validate(await request.json()), None
    except (ValidationError, ValueError) as e:
        raise ApiError("invalid_request", f"Invalid artifacts: {e}".splitlines()[0]) from e


@router.post(
    "/calls/{call_id}/artifacts",
    response_model=ArtifactsOut,
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {"schema": ArtifactsIn.model_json_schema()},
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "recording": {"type": "string", "format": "binary"},
                            "transcript": {"type": "string"},
                            "summary": {"type": "string", "description": "JSON object"},
                        },
                    }
                },
            }
        }
    },
)
async def attach_artifacts(call_id: str, request: Request, ctx: RequestContext = Depends(agent_context)) -> ArtifactsOut:
    """Attach a call's recording (URL or file), transcript and summary. Sent after the call ends; jobs
    booked with this call_id show them in the dashboard."""
    if not call_id or len(call_id) > 200:
        raise ApiError("invalid_call_id", "Invalid call id.")
    body, recording = await _parse(request)
    recording_key = None
    if recording is not None:
        data, ext = recording
        recording_key = f"{ctx.business_id}/calls/{uuid.uuid4().hex}.{ext}"
        await get_storage().put(recording_key, data, f"audio/{ext}")

    async def fn(session: AsyncSession) -> ArtifactsOut:
        values: dict[str, Any] = {k: v for k, v in body.model_dump(exclude_none=True).items()}
        if recording_key:
            values["recording_key"] = recording_key
        await session.execute(
            insert(CallArtifact)
            .values(business_id=ctx.business_id, call_id=call_id, **values)
            .on_conflict_do_update(
                index_elements=[CallArtifact.business_id, CallArtifact.call_id],
                set_={**values, "updated_at": func.now()},
            )
        )
        linked = await session.scalar(
            select(func.count()).select_from(Booking).where(Booking.business_id == ctx.business_id, Booking.call_id == call_id)
        )
        audit(session, ctx.business_id, ctx.actor, "call.artifacts", "call", call_id, fields=sorted(values))
        return ArtifactsOut(bookings_linked=linked or 0)

    return await run(ctx, fn)


@router.get("/files/{key:path}", include_in_schema=False)
async def signed_file(key: str, expires: int, sig: str) -> FileResponse:
    """Serves a locally stored recording behind an expiring signature (see storage.LocalStorage)."""
    storage = get_storage()
    if not isinstance(storage, LocalStorage) or not verify_signature(key, expires, sig) or expires > time.time() + 86400:
        raise ApiError("forbidden", "This link has expired.", status=403)
    path = storage.path(key)
    if not path.is_file():
        raise ApiError("not_found", "Not found.", status=404)
    return FileResponse(path, headers={"cache-control": "private, max-age=300"})
