"""FakeGoogle as an HTTP server, for browser end-to-end runs (not used by pytest).

    GOOGLE_TEST_BASE_URL=http://fake-google:9000 on the scheduler, then
    uvicorn tests.fake_google_server:app --host 0.0.0.0 --port 9000

/o/oauth2/v2/auth consents immediately as FAKE_EMAIL and redirects back with a code.
/_control/* lets the test act as the technician in their calendar.
"""

import os
from datetime import datetime
from urllib.parse import urlencode

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from tests.fake_google import FakeGoogle

fake = FakeGoogle()
EMAIL = os.environ.get("FAKE_EMAIL", "tech@acme.test")
fake.account(EMAIL)


async def consent(request: Request) -> Response:
    q = request.query_params
    return RedirectResponse(f"{q['redirect_uri']}?{urlencode({'code': fake.code_for(EMAIL), 'state': q['state']})}")


async def control(request: Request) -> Response:
    action = request.path_params["action"]
    body = await request.json() if request.method == "POST" else {}
    if action == "add":
        event_id = fake.add_event(EMAIL, datetime.fromisoformat(body["start"]), datetime.fromisoformat(body["end"]))
        return JSONResponse({"id": event_id})
    if action == "move":
        fake.move_event(EMAIL, body["id"], datetime.fromisoformat(body["start"]), datetime.fromisoformat(body["end"]))
        return JSONResponse({"ok": True})
    if action == "events":
        return JSONResponse([{**e.body, "status": e.status} for e in fake.live(EMAIL)])
    if action == "channel":
        channel_id, ch = next(iter(fake.channels.items()))
        return JSONResponse({"id": channel_id, **ch})
    return JSONResponse({"error": "unknown"}, status_code=404)


async def proxy(request: Request) -> Response:
    req = httpx.Request(request.method, str(request.url).replace(str(request.base_url), "https://www.googleapis.com/"),
                        headers=dict(request.headers), content=await request.body())
    res = fake.handler(req)
    return Response(res.content, status_code=res.status_code, headers={"content-type": res.headers.get("content-type", "application/json")})


app = Starlette(routes=[
    Route("/o/oauth2/v2/auth", consent),
    Route("/_control/{action}", control, methods=["GET", "POST"]),
    Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "DELETE", "PATCH"]),
])
