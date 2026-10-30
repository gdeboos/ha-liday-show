"""The public page: people passing by pick a show or playlist and queue it up.

It's served on its own port (18099 unless set otherwise) by a separate web app with nothing on it
but this page and its three API calls, so whatever route reaches it from the internet (a tunnel, a
proxy) can never reach the editor. The port opens once the Public page settings have been saved,
and stays open after visitors are switched off, so they see "no shows right now" rather than an error.

Settings, under "public": {"on", "items": [{"kind": "show" or "playlist", "id", "from", "to"}],
"per_phone", "queue"}. "from" and "to" ("MM-DD", or both empty for all year) come round every year,
like a playlist schedule's dates; an item outside them is listed for visitors as coming soon. "code" is
in every visitor's link and must come with every call; with "nearby", a phone that isn't on your own
network must be within "distance" metres of the house (settings' location, else Home Assistant's). Each
phone sends a random ticket it keeps, which is how "one request per phone" is counted: mobile
networks put many phones behind one internet address.
"""
import copy
import io
import ipaddress
import json
import logging
import math
import os
import re
import secrets
import time
from datetime import date, datetime
from pathlib import Path

from aiohttp import web

from . import ai, imagemeta, playlists, schedule
from .runner import Runner
from .storage import Storage, valid_id

log = logging.getLogger(__name__)

PAGE = Path(__file__).parent / "static" / "public"
DEFAULT_PORT = 18099
MAX_PER_PHONE = 5
MAX_QUEUE = 20
MAX_ITEMS = 200
MAX_POSTS_PER_MIN = 120  # for everyone together: a script can't flood the queue faster than people
# Each visitor's own share, counted by internet address: a phone sends one request now and then, and
# polls its state every 3 s, so these leave room for a few phones on one mobile network address.
MAX_POSTS_PER_CLIENT_MIN = 20
MAX_STATE_PER_CLIENT_MIN = 300  # a dozen or so phones sharing one address
MAX_CLIENTS = 5000  # addresses remembered at once, so a flood of them can't use up the memory
_TICKET = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_CODE = re.compile(r"^[A-Za-z0-9]{6,16}$")
CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o, 1/l/i, so it can be typed from a sign
MIN_DISTANCE_M, MAX_DISTANCE_M = 25, 2000
MAX_LEEWAY_M = 150  # a phone's own guess at how far out it might be, up to this much, counts in its favour
_LINK = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?(/[^\s]*)?$")
_ADDRESS = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?(/[^\s?#]*)?$")
WHERE = web.AppKey("where", object)  # () -> (lat, lon) of the house, or None

RUNNER = web.AppKey("runner", Runner)
STORAGE = web.AppKey("storage", Storage)
POSTS = web.AppKey("posts", list)
NEAR = web.AppKey("near", list)
CLIENTS = web.AppKey("clients", dict)
MAX_NEAR_PER_MIN = 3000  # each open page checks its location every 10 s or so while it's on screen


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


# Everything visitors read, with the wording it starts with (static/public/words.json, which the
# editor's Words tab and the tests read too).
WORDS_FILE = PAGE / "words.json"
WORD_GROUPS = json.loads(WORDS_FILE.read_text(encoding="utf-8"))["groups"]
DEFAULT_WORDS = {w["key"]: w["text"] for g in WORD_GROUPS for w in g["words"]}
MAX_WORD = 300
WARNINGS = ("off", "note", "accept")


def clean_words(x) -> dict:
    """Your own wording, by key: only words the page has, and only where it differs from the default."""
    x = x if isinstance(x, dict) else {}
    out = {}
    for key, default in DEFAULT_WORDS.items():
        text = " ".join(str(x.get(key) or "").split())[:MAX_WORD]
        if text and text != default:
            out[key] = text
    return out


def words(p: dict) -> dict:
    """Every word the page shows: yours where you've changed it, else the default."""
    return {**DEFAULT_WORDS, **p["words"]}


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
    code = str(p.get("code") or "")
    address = str(p.get("address") or "").strip().rstrip("/")
    try:
        distance = int(p.get("distance", 100))
    except (TypeError, ValueError):
        distance = 100
    return {"on": p.get("on") is True, "items": items,
            "per_phone": _count(p.get("per_phone"), 1, MAX_PER_PHONE),
            "queue": _count(p.get("queue"), 5, MAX_QUEUE),
            # In every visitor's link (the QR code), so a guessed address alone doesn't let anyone in.
            "code": code if _CODE.match(code) else "",
            "nearby": p.get("nearby") is not False,
            "distance": min(max(distance, MIN_DISTANCE_M), MAX_DISTANCE_M),
            "address": address if len(address) <= 200 and _ADDRESS.match(address) else "",
            "look": clean_look(p.get("look")),
            "hours": clean_hours(p.get("hours")),
            "words": clean_words(p.get("words"))}


DEFAULT_HOURS = {"on": False, "start": "17:00", "end": "22:00", "days": [0, 1, 2, 3, 4, 5, 6], "from": "", "to": ""}


def clean_hours(h) -> dict:
    """Opening hours: a playlist-style schedule with no dates (each show has its own). Off means always open."""
    if isinstance(h, dict):
        h = {**h, "from": "", "to": ""}
        if (out := playlists.clean_schedule(h)) is not None:
            return out
    return dict(DEFAULT_HOURS)


def hours_now(p: dict, where, now: datetime | None = None) -> dict:
    """Whether the page is open now, and if not, when it next opens (local time, no zone, or None)."""
    h = p["hours"]
    if not h["on"]:
        return {"open": True}
    now = now or datetime.now()
    if schedule.window_at(h, now, where):
        return {"open": True}
    nxt = schedule.next_start(h, now, where)
    return {"open": False, "next": nxt.isoformat(timespec="minutes") if nxt else None,
            "now": now.isoformat(timespec="minutes")}


THEMES = ("plain", "christmas", "frosty", "halloween", "custom")
SPACINGS = ("normal", "compact", "roomy")
CORNERS = ("soft", "square", "round")
SIZES = ("normal", "small", "large")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
# "Your own colours" to start from: the Classic Christmas dark look.
DEFAULT_COLOURS = {"bg": "#0f1a14", "panel": "#16241c", "text": "#eef4ef", "head": "#ffd36b", "accent": "#c62828"}
MODES = ("auto", "light", "dark")
PICTURES = ("none", "house", "upload")


def clean_look(x) -> dict:
    """How the visitors' page looks. Text is shown as typed (never as HTML)."""
    x = x if isinstance(x, dict) else {}
    text = lambda key, top: " ".join(str(x.get(key) or "").split())[:top] if key != "welcome" else \
        "\n".join(line.strip() for line in str(x.get(key) or "").strip().splitlines())[:top]
    link = str(x.get("link") or "").strip()
    pick = lambda key, allowed: x.get(key) if x.get(key) in allowed else allowed[0]
    return {"title": text("title", 60), "welcome": text("welcome", 300),
            "picture": pick("picture", PICTURES), "theme": pick("theme", THEMES), "mode": pick("mode", MODES),
            "snow": x.get("snow") is True,
            "link": link if len(link) <= 300 and _LINK.match(link) else "",
            "link_text": text("link_text", 80),
            "sign_text": text("sign_text", 120),
            "spacing": pick("spacing", SPACINGS), "corners": pick("corners", CORNERS), "size": pick("size", SIZES),
            "borders": x.get("borders") is not False,
            "show_length": x.get("show_length") is not False,
            "warning": pick("warning", WARNINGS),
            "colours": {k: (c[k].lower() if isinstance(c := x.get("colours"), dict) and isinstance(c.get(k), str)
                            and _HEX.match(c[k]) else v) for k, v in DEFAULT_COLOURS.items()}}


_VISITOR_LINK = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?(/[^\s?#]*)?/\?c=([A-Za-z0-9]{6,16})$")


def qr_svg(link: str, code: str) -> str | None:
    """The sign's QR code for a visitors' link with your current code in it, or None if it isn't one."""
    import segno  # only needed for the sign

    m = _VISITOR_LINK.match(link or "")
    if not m or len(link) > 300 or not code or m.group(3).lower() != code.lower():
        return None
    buf = io.BytesIO()
    segno.make(link, error="m", micro=False).save(buf, kind="svg", scale=10, border=4, xmldecl=False,
                                                  dark="#000000", light="#ffffff", title="QR code: " + link)
    return buf.getvalue().decode()


def new_code() -> str:
    return "".join(secrets.choice(CODE_CHARS) for _ in range(8))


def link(p: dict, fallback: str = "") -> str:
    """The address visitors open, with the code in it."""
    base = p["address"] or fallback
    return f"{base}/?c={p['code']}" if base else ""


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance over the ground between two (latitude, longitude) points."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(min(1.0, math.sqrt(h)))


# Home Assistant's own network for apps: a phone is never on it, only another app (a tunnel or proxy).
_APPS_NET = ipaddress.ip_network("172.30.32.0/23")
# Home networks: the private ranges routers hand out (not "private" in Python's wider sense, which
# includes documentation and other reserved ranges).
_HOME_NETS = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                                                "fc00::/7", "fe80::/10")]
LOOPBACK_IS_LOCAL = False  # tests turn this on, as their visitor is this machine


def is_local(request: web.Request) -> bool:
    """A phone on your home network, straight to the page. Tunnels and proxies don't count, so their
    visitors get the nearby check: some say so with headers, and others (Tailscale Funnel) don't, but
    they connect from this machine or from Home Assistant's apps network rather than another device."""
    if any(h in request.headers for h in ("CF-Connecting-IP", "X-Forwarded-For", "Forwarded", "X-Real-IP",
                                          "Tailscale-User-Login", "Tailscale-Funnel-Request")):
        return False
    try:
        ip = ipaddress.ip_address(request.remote or "")
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return LOOPBACK_IS_LOCAL
    return ip not in _APPS_NET and any(ip in net for net in _HOME_NETS if net.version == ip.version)


_LOADED: dict = {}  # config folder -> (the settings file's identity, cleaned settings)


def load(storage: Storage) -> dict | None:
    """The public settings, or None if they've never been saved (the port stays closed).

    Every phone asks every few seconds, so they're read again only when the settings file changes."""
    try:
        st = storage.settings_file.stat()
        key = (st.st_mtime_ns, st.st_size, st.st_ino)
    except OSError:
        key = None
    known = _LOADED.get(storage.config_dir)
    if key is not None and known and known[0] == key:
        return copy.deepcopy(known[1])
    p = storage.load_settings().get("public")
    out = clean(p) if isinstance(p, dict) else None
    if key is not None:
        _LOADED[storage.config_dir] = (key, out)
    return copy.deepcopy(out)


def _baked(storage: Storage, show_id: str) -> bool:
    return (storage.shows_dir / f"{show_id}.gshow").is_file()


def _offered(storage: Storage, show_id: str, show: dict | None = None) -> bool:
    """Visitors only get shows that are ready to play and not marked in progress."""
    show = show if show is not None else storage.load_show(show_id)
    return show is not None and show.get("in_progress") is not True and _baked(storage, show_id)


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
            if not _offered(storage, it["id"], show):
                continue
            pick = {"kind": "show", "id": it["id"], "name": show.get("name") or it["id"], "shows": [it["id"]]}
        else:
            pl = by_id.get(it["id"])
            shows = [s for s in pl["shows"] if _offered(storage, s)] if pl else []
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


def state(storage: Storage, runner: Runner, ticket: str | None, code: str | None = None,
          needs_location: bool = False, where=None, now: datetime | None = None) -> dict:
    p = load(storage) or clean(None)
    look = p["look"]
    said = words(p)
    if p["on"] and not _code_ok(p, code):
        # Only the colours without the code: the title, words and picture are for visitors.
        return {"open": True, "locked": True,
                "look": {k: look[k] for k in ("theme", "mode", "spacing", "corners", "size", "borders", "colours")},
                "words": {k: said[k] for k in ("locked", "locked_hint", "offline")}}
    picks = choices(storage) if p["on"] else []
    st = runner.status()
    waits = runner.queue_waits()
    mine = []
    if ticket:
        theirs = runner.public_now
        if theirs and theirs["ticket"] == ticket:
            mine.append({"id": theirs["id"], "name": theirs["name"], "playing": True})
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
        "needs_location": needs_location,
        "hours": hours_now(p, where, now),
        "look": {**{k: look[k] for k in ("title", "welcome", "theme", "mode", "snow", "link", "link_text", "spacing",
                                         "corners", "size", "borders", "colours", "show_length", "warning")},
                 "picture": picture_version(storage, look)},
        "words": said,
    }


def picture_version(storage: Storage, look: dict) -> int:
    """0 for no picture, else a number that changes with the picture, so open pages pick up a new one."""
    path = picture_path(storage, look)
    try:
        return int(path.stat().st_mtime) if path else 0
    except OSError:
        return 0


def picture_path(storage: Storage, look: dict) -> Path | None:
    if look["picture"] == "house":
        return storage.house_photo()
    if look["picture"] == "upload":
        return storage.public_picture()
    return None


def _code_ok(p: dict, code) -> bool:
    return (bool(p["code"]) and isinstance(code, str) and bool(_CODE.match(code))
            and secrets.compare_digest(code.lower().encode(), p["code"].lower().encode()))


class NotNear(Exception):
    """Why a phone can't start a show from where it is: "far", "location" or "closed"."""

    def __init__(self, why: str, word: str):
        super().__init__(why)
        self.why, self.word = why, word


def _check_near(request, p: dict, body: dict):
    """Raises NotNear for a phone that isn't by the lights, or can't say where it is."""
    if request.app[WHERE]() is None:
        raise NotNear("closed", "ask_house")
    try:
        here = (float(body["lat"]), float(body["lon"]))
        leeway = min(max(float(body.get("accuracy") or 0), 0), MAX_LEEWAY_M)
    except (KeyError, TypeError, ValueError):
        raise NotNear("location", "location_needed")
    if not all(map(math.isfinite, (*here, leeway))) or metres(here, request.app[WHERE]()) - leeway > p["distance"]:
        raise NotNear("far", "too_far")


def _said(storage: Storage, key: str) -> str:
    return words(load(storage) or clean(None))[key]


def _needs_location(request, p: dict) -> bool:
    """Through the internet with Nearby only on. With no home location to measure from, such a
    request is refused rather than let through."""
    return p["nearby"] and not is_local(request)


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
    if name not in ("index.html", "public.js", "public.css", "colours.js"):
        raise web.HTTPNotFound()
    resp = web.FileResponse(PAGE / name)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _state(request, ticket, code):
    p = load(request.app[STORAGE]) or clean(None)
    return state(request.app[STORAGE], request.app[RUNNER], ticket, code, _needs_location(request, p),
                 request.app[WHERE]())


PICTURE_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
_STRIPPED: dict = {}  # picture's path -> (its identity, the copy without its hidden details)


def stripped_picture(path: Path) -> bytes | None:
    """The picture without its GPS location and other hidden details, worked out once per picture;
    None if it can't be read well enough to be sure, so it isn't shown rather than shown with them."""
    st = path.stat()
    key = (st.st_mtime_ns, st.st_size)
    known = _STRIPPED.get(path)
    if known and known[0] == key:
        return known[1]
    data = imagemeta.clean(path.read_bytes(), path.suffix.lower())
    if data is None:
        log.warning("public page: %s couldn't be read to take its hidden details out, so it isn't shown", path.name)
    _STRIPPED.clear()  # one picture at a time is all the page shows
    _STRIPPED[path] = (key, data)
    return data


async def get_picture(request):
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    p = load(request.app[STORAGE]) or clean(None)
    path = picture_path(request.app[STORAGE], p["look"]) if p["on"] and _code_ok(p, request.query.get("code")) else None
    if path is None or path.suffix.lower() not in PICTURE_TYPES:
        raise web.HTTPNotFound()
    try:
        data = stripped_picture(path)
    except OSError:
        data = None
    if data is None:
        raise web.HTTPNotFound()
    # The page asks with ?v=, which changes with the picture.
    return web.Response(body=data, content_type=PICTURE_TYPES[path.suffix.lower()],
                        headers={"Cache-Control": "private, max-age=86400"})


async def get_state(request):
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    ticket = request.query.get("ticket")
    if ticket is not None:
        ticket = _ticket(ticket)
    return _no_store(web.json_response(_state(request, ticket, request.query.get("code"))))


def client(request) -> str:
    """Who's asking, by internet address. Behind your tunnel or proxy (which reaches the app from your
    own network) that's the address it passes on; otherwise the connection's own, as a visitor could
    write any address into those headers themselves."""
    remote = request.remote or ""
    try:
        proxied = ipaddress.ip_address(remote).is_private or ipaddress.ip_address(remote).is_loopback
    except ValueError:
        proxied = False
    if proxied:
        # Only what the proxy itself writes: the last X-Forwarded-For entry (Cloudflare Tunnel and Nginx
        # Proxy Manager both add it), else X-Real-IP. Other headers, CF-Connecting-IP among them, pass
        # through most proxies just as the visitor wrote them.
        for value in (request.headers.get("X-Forwarded-For", "").split(",")[-1], request.headers.get("X-Real-IP", "")):
            if value.strip():
                return _network(value.strip()[:64])
    return _network(remote)


def _network(address: str) -> str:
    """IPv6 addresses by their /64, the block one phone or home gets, so changing the rest doesn't
    make a new visitor."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address
    if ip.version == 6 and ip.ipv4_mapped:  # how a dual-stack proxy writes an IPv4 visitor
        return str(ip.ipv4_mapped)
    return str(ipaddress.ip_network(f"{ip}/64", strict=False)) if ip.version == 6 else str(ip)


def _limit_client(request, kind: str, limit: int):
    """Each visitor's own share of requests a minute, so one can't crowd out everyone else."""
    now, seen = time.monotonic(), request.app[CLIENTS]
    key = (kind, client(request))
    times = [t for t in seen.get(key, ()) if now - t < 60]
    if len(times) >= limit:
        seen[key] = times
        raise web.HTTPTooManyRequests(text=_said(request.app[STORAGE], "busy"))
    if key not in seen and len(seen) >= MAX_CLIENTS:
        # Forget the half not heard from for longest, rather than everyone's counts at once.
        for k in sorted(seen, key=lambda k: seen[k][-1] if seen[k] else 0)[:len(seen) // 2]:
            del seen[k]
    times.append(now)
    seen[key] = times


def _throttle(app, key=POSTS, limit=MAX_POSTS_PER_MIN):
    now, posts = time.monotonic(), app[key]
    posts[:] = [t for t in posts if now - t < 60]
    if len(posts) >= limit:
        raise web.HTTPTooManyRequests(text=_said(app[STORAGE], "busy"))
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
    _limit_client(request, "post", MAX_POSTS_PER_CLIENT_MIN)
    body = await _body(request)
    ticket = _ticket(body.get("ticket"))
    storage, runner = request.app[STORAGE], request.app[RUNNER]
    p = load(storage) or clean(None)
    said = words(p)
    if not p["on"]:
        raise web.HTTPConflict(text=said["closed"])
    if not _code_ok(p, body.get("code")):
        raise web.HTTPForbidden(text=said["locked"])
    # Only requests with the code count towards everyone's limit, so guessing can't lock visitors out.
    _throttle(request.app)
    if not hours_now(p, request.app[WHERE]())["open"]:
        raise web.HTTPConflict(text=said["not_open_now"])
    if _needs_location(request, p):
        try:
            _check_near(request, p, body)
        except NotNear as e:
            raise web.HTTPForbidden(text=said[e.word])
    pick = next((c for c in choices(storage) if c["available"] and c["kind"] == body.get("kind")
                 and c["id"] == body.get("id")), None)
    if pick is None:
        raise web.HTTPNotFound(text=said["gone"])
    yours = sum(r["ticket"] == ticket for r in runner.requests)
    if yours >= p["per_phone"]:
        raise web.HTTPConflict(text=said["one_waiting"] if p["per_phone"] == 1 else
                               said["many_waiting"].replace("{count}", str(yours)))
    if len(runner.requests) >= p["queue"]:
        raise web.HTTPConflict(text=said["full"])
    runner.add_request({"id": secrets.token_hex(6), "ticket": ticket, "kind": pick["kind"], "ref": pick["id"],
                        "name": pick["name"], "shows": pick["shows"], "gap": pick.get("gap", 0)})
    log.info("public page: %s %s requested (%d waiting)", pick["kind"], pick["id"], len(runner.requests))
    return _no_store(web.json_response(_state(request, ticket, body.get("code"))))


async def post_near(request):
    """Whether this phone is by the lights, asked when the page opens so the Start buttons only show
    for people who could use them. Requests are checked again when they're made."""
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    body = await _body(request)
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, body.get("code")):
        raise web.HTTPForbidden(text=words(p)["locked"])
    _throttle(request.app, NEAR, MAX_NEAR_PER_MIN)
    if _needs_location(request, p):
        try:
            _check_near(request, p, body)
        except NotNear as e:
            # "far" can change as they walk; "closed" (nothing to measure from) and "location" can't by themselves.
            return _no_store(web.json_response({"near": False, "why": e.why, "text": words(p)[e.word]}))
    return _no_store(web.json_response({"near": True}))


async def post_cancel(request):
    _limit_client(request, "post", MAX_POSTS_PER_CLIENT_MIN)
    body = await _body(request)
    ticket = _ticket(body.get("ticket"))
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, body.get("code")):
        raise web.HTTPForbidden(text=words(p)["locked"])
    _throttle(request.app)
    request.app[RUNNER].cancel_request(str(body.get("id", "")), ticket)
    return _no_store(web.json_response(_state(request, ticket, body.get("code"))))


def make_public_app(storage: Storage, runner: Runner, where=lambda: None) -> web.Application:
    app = web.Application(middlewares=[safe_headers], client_max_size=4096)
    app[STORAGE] = storage
    app[RUNNER] = runner
    app[WHERE] = where
    app[POSTS] = []
    app[NEAR] = []
    app[CLIENTS] = {}
    r = app.router
    r.add_get("/", page)
    r.add_get("/{name:(public\\.js|public\\.css|colours\\.js)}", page)
    r.add_get("/api/state", get_state)
    r.add_get("/picture", get_picture)
    r.add_post("/api/request", post_request)
    r.add_post("/api/cancel", post_cancel)
    r.add_post("/api/near", post_near)
    return app


class PublicSite:
    """Opens the public page's port once the public settings exist."""

    def __init__(self, storage: Storage, runner: Runner, where=lambda: None):
        self.storage, self.runner, self.where = storage, runner, where
        self.port = port()
        self.error: str | None = None
        self._runner: web.AppRunner | None = None

    @property
    def listening(self) -> bool:
        return self._runner is not None

    async def apply(self):
        p = load(self.storage)
        if p is not None and not p["code"]:  # settings from before codes, or a fresh setup
            settings = self.storage.load_settings()
            settings["public"] = {**p, "code": new_code()}
            self.storage.save_settings(settings)
            p = load(self.storage)
        if p is None or not p["on"]:
            self.runner.clear_requests()
        if p is None or self._runner is not None:
            return
        app_runner = web.AppRunner(make_public_app(self.storage, self.runner, self.where), access_log=None)
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
