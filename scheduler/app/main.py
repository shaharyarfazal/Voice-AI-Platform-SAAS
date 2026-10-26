from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from .api import agent, calls, connections, dashboard
from .db import dispose_engines, sessionmaker
from .errors import ApiError
from .logging import configure_logging
from .worker import queue

log = structlog.get_logger("scheduler")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    yield
    await queue.close()
    await dispose_engines()


app = FastAPI(
    title="Scheduling engine",
    version="1.0.0",
    description=(
        "Availability, race-safe bookings and job records. `/agent/*` and `/calls/*` are the voice agent's tools "
        "(Bearer INTERNAL_API_TOKEN + X-Agent-Id, or a workspace API key `vk_…`); `/v1/*` is the dashboard API "
        "(short-lived JWT from the web app)."
    ),
    lifespan=lifespan,
)


@app.exception_handler(ApiError)
async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {"loc": (), "msg": "invalid request"}
    where = ".".join(str(p) for p in first["loc"] if p != "body") or "request"
    return JSONResponse(
        {"ok": False, "code": "invalid_request", "message": f"Missing or invalid {where}: {first['msg']}."},
        status_code=400,
    )


@app.exception_handler(Exception)
async def _unexpected(_request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled", error=str(exc))
    return JSONResponse(
        {"ok": False, "code": "internal_error", "message": "The booking system had a problem. Offer to take a message."},
        status_code=500,
    )


app.include_router(agent.router)
app.include_router(calls.router)
app.include_router(dashboard.router)
app.include_router(connections.dashboard)
app.include_router(connections.internal)


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    async with sessionmaker("app")() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)
