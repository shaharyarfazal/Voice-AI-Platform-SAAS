"""Enqueue background jobs from the API. Calendar sync is best-effort from the request's point of
view: if Redis is down the booking still stands, and the reconciliation job (Phase 2) catches up."""

from __future__ import annotations

from typing import Any

import structlog
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from ..config import get_settings

log = structlog.get_logger("scheduler.queue")
_pool: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)


async def enqueue(function: str, *args: Any, job_id: str | None = None) -> None:
    global _pool
    settings = get_settings()
    if settings.inline_jobs:
        from .tasks import TASKS

        try:
            await TASKS[function]({"job_try": 1, "inline": True}, *args)
        except Exception as e:  # noqa: BLE001 - same as a failed queued job: logged, not raised
            log.warning("inline_job.failed", function=function, error=str(e))
        return
    if not settings.redis_url:
        log.debug("enqueue.skipped_no_redis", function=function)
        return
    try:
        if _pool is None:
            _pool = await create_pool(redis_settings())
        await _pool.enqueue_job(function, *args, _job_id=job_id)
    except Exception as e:  # noqa: BLE001 - never fail a booking because the queue is unavailable
        log.warning("enqueue.failed", function=function, error=str(e))


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
