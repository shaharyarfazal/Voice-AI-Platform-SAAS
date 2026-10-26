"""Write the voice agent tool API's OpenAPI spec to openapi/agent.yaml.

    python -m scripts.export_openapi          # write
    python -m scripts.export_openapi --check  # fail if the committed file is out of date
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml
from fastapi import FastAPI

from app.api import agent, calls

OUT = Path(__file__).resolve().parent.parent / "openapi" / "agent.yaml"


def build() -> str:
    api = FastAPI(
        title="Voice agent scheduling tools",
        version="1.0.0",
        description=(
            "Tools a voice agent calls on a live call. Authenticate with `Authorization: Bearer <workspace API key>` "
            "(vk_…), or for the platform's own agent `Bearer <INTERNAL_API_TOKEN>` plus `X-Agent-Id`. Times are the "
            "business's local wall time (`slot_id`: YYYY-MM-DDTHH:MM). Every response has `ok`; errors add a stable "
            "`code`, a `message` that can be read to the caller and, where useful, `alternatives`."
        ),
    )
    api.include_router(agent.router)
    api.include_router(calls.router)
    spec = api.openapi()
    spec["components"]["securitySchemes"] = {"bearer": {"type": "http", "scheme": "bearer"}}
    spec["security"] = [{"bearer": []}]
    return yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=120)


def main() -> int:
    text = build()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT} is out of date: run python -m scripts.export_openapi", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
