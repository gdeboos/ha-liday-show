"""The public page: people passing by pick a show or playlist and queue it up.

It's served on its own port (18099 unless set otherwise) by a separate web app with nothing on it
but this page and its three API calls, so whatever route reaches it from the internet (a tunnel, a
proxy) can never reach the editor. The port opens once the Public page settings have been saved,
and stays open after visitors are switched off, so they see "no shows right now" rather than an error.

Settings, under "public": {"on", "items": [{"kind": "show" or "playlist", "id", "from", "to"}],
"per_phone", "queue"}. "from" and "to" ("MM-DD", or both empty for all year) come round every year,
like a playlist schedule's dates; an item outside them is listed for visitors as coming soon. Each
phone sends a random ticket it keeps, which is how "one request per phone" is counted: mobile
networks put many phones behind one internet address.
"""
import logging
import os
import re
import secrets
import time
from datetime import date
from pathlib import Path

from aiohttp import web

from . import ai, playlists, schedule
from .runner import Runner
from .storage import Storage, valid_id

log = logging.getLogger(__name__)

PAGE = Path(__file__).parent / "static" / "public"
DEFAULT_PORT = 18099
MAX_PER_PHONE = 5
MAX_QUEUE = 20
MAX_ITEMS = 200
MAX_POSTS_PER_MIN = 120  # for everyone together: a script can't flood the queue faster than people
_TICKET = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

RUNNER = web.AppKey("runner", Runner)
STORAGE = web.AppKey("storage", Storage)
POSTS = web.AppKey("posts", list)


def port() -> int:
    raw = ai.options().get("public_port") or os.environ.get("HALIDAY_SHOW_PUBLIC_PORT") or DEFAULT_PORT
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_PORT
    return value if 1024 <= value <= 65535 else DEFAULT_PORT


def _count(value, default: int, top: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(n, 1), top)


def _item(x) -> dict | None:
    """One show or playlist on the public page: {"kind", "id", "from", "to"} with optional dates."""
    if not isinstance(x, dict) or x.get("kind") not in ("show", "playlist"):
        return None
    iid, frm, to = str(x.get("id", "")), str(x.get("from") or ""), str(x.get("to") or "")
    if not valid_id(iid):
        return None
    if bool(frm) != bool(to) or (frm and not (playlists.valid_day(frm) and playlists.valid_day(to))):
        frm = to = ""  # a broken date range means always available, rather than losing the item
    return {"kind": x["kind"], "id": iid, "from": frm, "to": to}


def clean(p) -> dict:
    """The public settings as stored; anything missing or wrong falls back to the defaults.

    Before 0.2.156 the picks were two lists of ids, "shows" and "playlists", with no dates; they read as
    items available all year.
    """
    p = p if isinstance(p, dict) else {}
    if isinstance(p.get("items"), list):
        raw = p["items"]
    else:
        old = lambda key: p.get(key) if isinstance(p.get(key), list) else []
        raw = [{"kind": "show", "id": x} for x in old("shows")] + [{"kind": "playlist", "id": x} for x in old("playlists")]
    items, seen = [], set()
    for x in raw[:MAX_ITEMS]:
        if (it := _item(x)) and (it["kind"], it["id"]) not in seen:
            seen.add((it["kind"], it["id"]))
            items.append(it)
    return {"on": p.get("on") is True, "items": items,
            "per_phone": _count(p.get("per_phone"), 1, MAX_PER_PHONE),
            "queue": _count(p.get("queue"), 5, MAX_QUEUE)}


def load(storage: Storage) -> dict | None:
    """The public settings, or None if they've never been saved (the port stays closed)."""
    p = storage.load_settings().get("public")
    return clean(p) if isinstance(p, dict) else None


def _baked(storage: Storage, show_id: str) -> bool:
    return (storage.shows_dir / f"{show_id}.gshow").is_file()


def available(item: dict, today: date) -> bool:
    return not item["from"] or schedule.in_dates(item, today)


def next_from(item: dict, today: date) -> date:
    """The next day an item's dates begin, today or later (29 February falls on 1 March in other years)."""
    m, d = int(item["from"][:2]), int(item["from"][3:])
    for year in (today.year, today.year + 1):
        try:
            day = date(year, m, d)
        except ValueError:
            day = date(year, 3, 1)
        if day >= today:
            return day
    return day


_CHOICES: dict = {}  # config folder -> (when, settings file's mtime, today, choices): every phone polls
CHOICES_FOR_S = 2.0


def choices(storage: Storage, today: date | None = None) -> list[dict]:
    """Every show and playlist on the public page that can play, each marked "available" today or with
    the day it "starts". Worked out at most every couple of seconds, or when the settings change."""
    today = today or date.today()
    try:
        changed = storage.settings_file.stat().st_mtime_ns
    except OSError:
        changed = 0
    now = time.monotonic()
    known = _CHOICES.get(storage.config_dir)
    if known and known[1] == changed and known[2] == today and now - known[0] < CHOICES_FOR_S:
        return known[3]
    out = _choices(storage, today)
    _CHOICES[storage.config_dir] = (now, changed, today, out)
    return out


def _choices(storage: Storage, today: date) -> list[dict]:
    p = load(storage) or clean(None)
    by_id = {pl["id"]: pl for pl in playlists.load(storage)}
    out = []
    for it in p["items"]:
        if it["kind"] == "show":
            show = storage.load_show(it["id"])
            if show is None or not _baked(storage, it["id"]):
                continue
            pick = {"kind": "show", "id": it["id"], "name": show.get("name") or it["id"], "shows": [it["id"]]}
        else:
            pl = by_id.get(it["id"])
            shows = [s for s in pl["shows"] if _baked(storage, s)] if pl else []
            if not shows:
                continue
            pick = {"kind": "playlist", "id": it["id"], "name": pl["name"], "shows": shows, "gap": pl["gap"]}
        if available(it, today):
            pick["available"] = True
        else:
            pick["available"], pick["starts"] = False, next_from(it, today).isoformat()
        out.append(pick)
    return out


def _ticket(value) -> str:
    ticket = str(value or "")
    if not _TICKET.match(ticket):
        raise web.HTTPBadRequest(text="bad ticket")
    return ticket


def state(storage: Storage, runner: Runner, ticket: str | None) -> dict:
    p = load(storage) or clean(None)
    picks = choices(storage) if p["on"] else []
    st = runner.status()
    waits = runner.queue_waits()
    mine = []
    if ticket:
        now = runner.public_now
        if now and now["ticket"] == ticket:
            mine.append({"id": now["id"], "name": now["name"], "playing": True})
        for place, (r, wait) in enumerate(zip(runner.requests, waits), start=1):
            if r["ticket"] == ticket:
                mine.append({"id": r["id"], "name": r["name"], "place": place, "wait": wait})
    return {
        "open": p["on"],
        "choices": [{"kind": c["kind"], "id": c["id"], "name": c["name"],
                     "minutes": max(1, round(runner.request_seconds(c) / 60))} for c in picks if c["available"]],
        # Later ones, soonest first, so visitors know to come back.
        "soon": sorted(({"kind": c["kind"], "id": c["id"], "name": c["name"], "starts": c["starts"]}
                        for c in picks if not c["available"]), key=lambda c: (c["starts"], c["name"])),
        "now": {"name": st["name"], "visitor": runner.public_now is not None} if st["playing"] else None,
        "waiting": len(runner.requests),
        "full": len(runner.requests) >= p["queue"],
        "per_phone": p["per_phone"],
        "mine": mine,
    }


def _no_store(resp: web.StreamResponse) -> web.StreamResponse:
    resp.headers["Cache-Control"] = "no-store"
    return resp


@web.middleware
async def safe_headers(request, handler):
    resp = await handler(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; "
                                               "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    return resp


async def page(request):
    name = request.match_info.get("name") or "index.html"
    if name not in ("index.html", "public.js", "public.css"):
        raise web.HTTPNotFound()
    resp = web.FileResponse(PAGE / name)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def get_state(request):
    ticket = request.query.get("ticket")
    if ticket is not None:
        ticket = _ticket(ticket)
    return _no_store(web.json_response(state(request.app[STORAGE], request.app[RUNNER], ticket)))


def _throttle(app):
    now, posts = time.monotonic(), app[POSTS]
    posts[:] = [t for t in posts if now - t < 60]
    if len(posts) >= MAX_POSTS_PER_MIN:
        raise web.HTTPTooManyRequests(text="Lots of people are asking right now. Try again in a minute.")
    posts.append(now)


async def _body(request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected JSON")
    return body


async def post_request(request):
    _throttle(request.app)
    body = await _body(request)
    ticket = _ticket(body.get("ticket"))
    storage, runner = request.app[STORAGE], request.app[RUNNER]
    p = load(storage) or clean(None)
    if not p["on"]:
        raise web.HTTPConflict(text="There are no shows right now.")
    pick = next((c for c in choices(storage) if c["available"] and c["kind"] == body.get("kind")
                 and c["id"] == body.get("id")), None)
    if pick is None:
        raise web.HTTPNotFound(text="That show isn't available any more.")
    yours = sum(r["ticket"] == ticket for r in runner.requests)
    if yours >= p["per_phone"]:
        raise web.HTTPConflict(text="You've already got a show waiting. You can pick another once it starts."
                               if p["per_phone"] == 1 else
                               f"You've already got {yours} shows waiting, the most for one phone.")
    if len(runner.requests) >= p["queue"]:
        raise web.HTTPConflict(text="The queue is full. Try again in a few minutes.")
    runner.add_request({"id": secrets.token_hex(6), "ticket": ticket, "kind": pick["kind"], "ref": pick["id"],
                        "name": pick["name"], "shows": pick["shows"], "gap": pick.get("gap", 0)})
    log.info("public page: %s %s requested (%d waiting)", pick["kind"], pick["id"], len(runner.requests))
    return _no_store(web.json_response(state(storage, runner, ticket)))


async def post_cancel(request):
    _throttle(request.app)
    body = await _body(request)
    ticket = _ticket(body.get("ticket"))
    request.app[RUNNER].cancel_request(str(body.get("id", "")), ticket)
    return _no_store(web.json_response(state(request.app[STORAGE], request.app[RUNNER], ticket)))


def make_public_app(storage: Storage, runner: Runner) -> web.Application:
    app = web.Application(middlewares=[safe_headers], client_max_size=4096)
    app[STORAGE] = storage
    app[RUNNER] = runner
    app[POSTS] = []
    r = app.router
    r.add_get("/", page)
    r.add_get("/{name:(public\\.js|public\\.css)}", page)
    r.add_get("/api/state", get_state)
    r.add_post("/api/request", post_request)
    r.add_post("/api/cancel", post_cancel)
    return app


class PublicSite:
    """Opens the public page's port once the public settings exist."""

    def __init__(self, storage: Storage, runner: Runner):
        self.storage, self.runner = storage, runner
        self.port = port()
        self.error: str | None = None
        self._runner: web.AppRunner | None = None

    @property
    def listening(self) -> bool:
        return self._runner is not None

    async def apply(self):
        p = load(self.storage)
        if p is None or not p["on"]:
            self.runner.clear_requests()
        if p is None or self._runner is not None:
            return
        app_runner = web.AppRunner(make_public_app(self.storage, self.runner), access_log=None)
        await app_runner.setup()
        try:
            await web.TCPSite(app_runner, port=self.port).start()
        except OSError as e:
            await app_runner.cleanup()
            self.error = f"couldn't open port {self.port}: {e.strerror or e}"
            log.error("public page: %s", self.error)
            return
        self._runner, self.error = app_runner, None
        log.info("public page on port %d", self.port)

    async def close(self):
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
