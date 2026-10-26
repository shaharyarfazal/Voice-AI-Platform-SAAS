"""ARQ worker: `arq app.worker.settings.WorkerSettings`."""

import logging

from arq import cron

from ..db import dispose_engines
from ..logging import configure_logging
from .queue import redis_settings
from .tasks import TASKS, expire_holds_job, reconcile, refresh_tokens, renew_channels


async def _startup(_ctx: dict) -> None:
    configure_logging()
    # arq logs through its own handler; don't print every line twice via the root logger.
    logging.getLogger("arq").propagate = False


async def _shutdown(_ctx: dict) -> None:
    await dispose_engines()


class WorkerSettings:
    functions = list(TASKS.values())
    cron_jobs = [
        cron(expire_holds_job, second={0, 30}, run_at_startup=True),
        # Missed-notification safety net.
        cron(reconcile, minute=set(range(0, 60, 10)), second=15, unique=True, timeout=600),
        cron(refresh_tokens, minute=set(range(5, 60, 10)), second=0, unique=True),
        cron(renew_channels, minute=20, second=0, unique=True, run_at_startup=True),
    ]
    on_startup = _startup
    on_shutdown = _shutdown
    redis_settings = redis_settings()
    max_tries = 6
    job_timeout = 120
    keep_result = 60
