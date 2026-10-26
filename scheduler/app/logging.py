import logging
import sys

import structlog

from .config import get_settings

# Never log these, whatever a log call is handed.
_REDACT = {"access_token", "refresh_token", "authorization", "api_key", "token", "password", "secret"}


def _redact(_logger, _name, event_dict):  # noqa: ANN001
    for key in list(event_dict):
        if key.lower() in _REDACT:
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(stream=sys.stdout, level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact,
            structlog.processors.JSONRenderer() if settings.log_json else structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )
