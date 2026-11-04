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

With "listen" on, visitors can also hear whatever's playing on their own phone (Listen): the phone
asks for a short-lived pass (POST /api/listen, with the nearby check and, if "listen_pin" is set, the
PIN), then polls /api/listen/now for where the song is and plays a small copy of it (songcopy.py)
in step with the lights. Phones only follow; they never move the lights.

With "admin_pin" set, you can unlock your own phone (tap the page's title five times, type the PIN; POST
/api/admin). It keeps a pass and sends it as X-Admin on every call, which skips Nearby, the opening
hours, the listening PIN, the per-phone limit and a full queue, and works while visitors are off. The
code is still needed.
"""
import asyncio
import copy
import hashlib
import hmac
import io
import ipaddress
import json
import logging
import math
import os
import re
import secrets
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from aiohttp import web

from . import ai, appicon, imagemeta, playlists, schedule, songcopy, songtags
from . import runner as _runner
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

COPIES = web.AppKey("copies", songcopy.SongCopies)
PIN_TRIES = web.AppKey("pin_tries", dict)
LISTEN_FOR_S = 15 * 60  # how long a listening pass lasts before the phone asks again (and is checked again)
MAX_LISTEN_PER_CLIENT_MIN = 1500  # each listening phone asks where the song is about once a second
MAX_PIN_TRIES, PIN_WAIT_S = 5, 10 * 60  # wrong PINs from one address before it has to wait
_PIN = re.compile(r"^[0-9]{4,8}$")
_PASS = re.compile(r"^[0-9a-f]{32}$")
_TOKEN = re.compile(r"^[0-9]{10}\.[0-9a-f]{32}$")
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


def _count(value, default: int, top: int, low: int = 1) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(n, low), top)


# Changes each time HA-liday Show starts (an update, say), so pages left open on phones load again and
# get the new page rather than carrying on with the old one. Random, so it says nothing about the version.
BOOT = secrets.token_hex(4)


def _item(x) -> dict | None:
    """One show or playlist on the public page: {"kind", "id", "from", "to"} with optional dates, or a
    heading {"kind": "heading", "name"} that the shows after it, up to the next one, are grouped under."""
    if isinstance(x, dict) and x.get("kind") == "heading":
        name = " ".join(str(x.get("name") or "").split())[:60]
        return {"kind": "heading", "name": name} if name else None
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
        if (it := _item(x)) and (it["kind"] == "heading" or (it["kind"], it["id"]) not in seen):
            seen.add((it["kind"], it.get("id")))
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
            # Minutes before a show that played can be picked again, and before a phone whose pick
            # played can pick again (0: no wait).
            "repeat_minutes": _count(p.get("repeat_minutes"), 15, 120, low=0),
            "phone_wait": _count(p.get("phone_wait"), 5, 60, low=0),
            # With opening hours on: picks that wouldn't finish before closing time aren't taken.
            "finish_by_close": p.get("finish_by_close") is not False,
            # After this many minutes of visitors' picks back to back, the lights rest this long (0: never).
            "rest_after": _count(p.get("rest_after"), 30, 240, low=0),
            "rest_for": _count(p.get("rest_for"), 5, 30, low=0),
            # In every visitor's link (the QR code), so a guessed address alone doesn't let anyone in.
            "code": code if _CODE.match(code) else "",
            "nearby": p.get("nearby") is not False,
            "distance": min(max(distance, MIN_DISTANCE_M), MAX_DISTANCE_M),
            "address": address if len(address) <= 200 and _ADDRESS.match(address) else "",
            "look": clean_look(p.get("look")),
            "hours": clean_hours(p.get("hours")),
            "words": clean_words(p.get("words")),
            # Visitors can listen on their own phone, with a PIN as well (4 to 8 digits) if one is set.
            "listen": p.get("listen") is True,
            "listen_pin": pin if _PIN.match(pin := str(p.get("listen_pin") or "").strip()) else "",
            # Yours, to get past every check but the code (see the top of this file).
            "admin_pin": apin if _PIN.match(apin := str(p.get("admin_pin") or "").strip()) else ""}


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
            "covers": x.get("covers") is not False,
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


def _song_file(storage: Storage, show: dict | None) -> Path | None:
    audio = (show or {}).get("audio")
    return storage.audio_path(audio.get("source", ""), audio.get("path", "")) if isinstance(audio, dict) else None


def _cover_file(storage: Storage, show_ids: list[str]) -> Path | None:
    """What a show (or a playlist, its first show that has one) is pictured with: the show's own
    picture (a JPEG in the shows folder), else its song's cover art."""
    for sid in show_ids:
        if (own := storage.show_picture(sid)) is not None:
            return own
        song = _song_file(storage, storage.load_show(sid))
        if song is not None and songtags.cached_cover(song):
            return song
    return None


def _tile_colours(show: dict | None) -> list[str]:
    """A show's palette colours, for the tile visitors see when it has no picture or cover art."""
    pal = (show or {}).get("palette")
    cols = pal.get("colors") if isinstance(pal, dict) else None
    return [c.lower() for c in cols if isinstance(c, str) and _HEX.match(c)][:4] if isinstance(cols, list) else []


_COVER_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def cover_of(storage: Storage, pick: dict) -> tuple[str, bytes] | None:
    """A show's or playlist's cover art as visitors get it: with any hidden details taken out
    (imagemeta), and only in a kind of picture that can be checked for them."""
    song = _cover_file(storage, pick["shows"])
    if song is not None and song.parent == storage.shows_dir:
        try:
            return "image/jpeg", song.read_bytes()  # a show's own picture, cleaned when it was added
        except OSError:
            return None
    pic = songtags.cached_cover(song) if song else None
    if not pic or pic[0] not in _COVER_TYPES:
        return None
    data = imagemeta.clean(pic[1], _COVER_TYPES[pic[0]])
    return (pic[0], data) if data else None


def _choices(storage: Storage, today: date) -> list[dict]:
    p = load(storage) or clean(None)
    by_id = {pl["id"]: pl for pl in playlists.load(storage)}
    default_speaker = storage.load_settings().get("show_speaker") or ""
    out, group = [], ""
    for it in p["items"]:
        if it["kind"] == "heading":
            group = it["name"]
            continue
        if it["kind"] == "show":
            show = storage.load_show(it["id"])
            if not _offered(storage, it["id"], show):
                continue
            pick = {"kind": "show", "id": it["id"], "name": show.get("name") or it["id"], "shows": [it["id"]]}
            pick["colours"] = _tile_colours(show)
        else:
            pl = by_id.get(it["id"])
            shows = [s for s in pl["shows"] if _offered(storage, s)] if pl else []
            if not shows:
                continue
            pick = {"kind": "playlist", "id": it["id"], "name": pl["name"], "shows": shows, "gap": pl["gap"]}
            pick["colours"] = _tile_colours(storage.load_show(shows[0]))
        pick["group"] = group  # the heading it's under ("" before any)
        # Whether its music plays on a speaker (its first show's own, or your default show speaker). With
        # none, a visitor's press on it also starts listening on their phone.
        first = storage.load_show(pick["shows"][0]) or {}
        pick["speaker"] = bool(first.get("media_player") or default_speaker)
        # A number that changes with the cover, so pages fetch a new one (0: none).
        song = _cover_file(storage, pick["shows"])
        try:
            pick["cover"] = 1 + (song.stat().st_mtime_ns // 1_000_000) % 2_000_000_000 if song else 0
        except OSError:
            pick["cover"] = 0
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


def _mins(seconds: float) -> str:
    m = max(1, math.ceil(seconds / 60))
    return f"{m} minute{'' if m == 1 else 's'}"


LISTENING_FRESH_S = 15  # a listening phone asks about once a second; quiet this long, it's gone


def tonight(runner: Runner, now: datetime | None = None) -> dict:
    """Tonight's visitors so far, since midday: how many picks, the most picked, and phones listening now."""
    now = now or datetime.now()
    since = now.replace(hour=12, minute=0, second=0, microsecond=0)
    if now < since:
        since -= timedelta(days=1)
    names = [x["name"] for x in runner.public_log if x["at"] >= since]
    counts: dict[str, int] = {}
    for n in names:
        counts[n] = counts.get(n, 0) + 1
    top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
    t = _runner.clock()
    return {"picks": len(names), "top": [{"name": n, "count": c} for n, c in top],
            "listening": sum(1 for at in runner.public_listeners.values() if t - at < LISTENING_FRESH_S)}


def closes_at(p: dict, where, now: datetime | None = None) -> datetime | None:
    """When tonight's opening hours end, if picks must finish by then (else None)."""
    if not (p["finish_by_close"] and p["hours"]["on"]):
        return None
    w = schedule.window_at(p["hours"], now or datetime.now(), where)
    return w[1] if w else None


def too_late(runner: Runner, pick: dict, close: datetime | None, now: datetime | None = None) -> bool:
    """Whether a pick added now would still be playing at closing time."""
    if close is None:
        return False
    now = now or datetime.now()
    finish = now + timedelta(seconds=runner.wait_for_new() + runner.request_seconds(pick))
    return finish > close


def clock(t: datetime) -> str:
    """5pm, 9:30pm: as the opening hours are written on the page."""
    h = t.hour % 12 or 12
    return f"{h}{'' if t.minute == 0 else f':{t.minute:02d}'}{'am' if t.hour < 12 else 'pm'}"


def taken(runner: Runner, kind: str, ref: str, repeat_minutes: int = 0) -> str:
    """Why a show or playlist can't be picked again right now: "queued" (someone's pick is waiting),
    "playing" (on now), "recent" (a visitor's pick of it played less than repeat_minutes ago), or "" if
    it's free. Stops the same song being queued over and over."""
    if any(r["kind"] == kind and r["ref"] == ref for r in runner.requests):
        return "queued"
    now = runner.public_now
    if now and now["kind"] == kind and now["ref"] == ref:
        return "playing"
    if kind == "show" and runner.player.playing and runner.player.show_id == ref and not runner.scene_playing:
        return "playing"
    if repeat_minutes and repeat_left(runner, kind, ref, repeat_minutes) > 0:
        return "recent"
    return ""


def repeat_left(runner: Runner, kind: str, ref: str, minutes: int) -> float:
    """Seconds until a show (or playlist) a visitor picked can be picked again."""
    ends = [p["at"] for p in runner.public_played if p["kind"] == kind and p["ref"] == ref]
    return max(0.0, max(ends) + minutes * 60 - _runner.clock()) if ends else 0.0


def phone_wait_left(runner: Runner, ticket: str | None, minutes: int) -> float:
    """Seconds until a phone whose own pick played can pick again."""
    if not ticket or not minutes:
        return 0.0
    ends = [p["at"] for p in runner.public_played if p["ticket"] == ticket]
    return max(0.0, max(ends) + minutes * 60 - _runner.clock()) if ends else 0.0


def state(storage: Storage, runner: Runner, ticket: str | None, code: str | None = None,
          needs_location: bool = False, where=None, now: datetime | None = None, admin: bool = False) -> dict:
    p = load(storage) or clean(None)
    look = p["look"]
    said = words(p)
    if p["on"] and not _code_ok(p, code):
        # Only the colours without the code: the title, words and picture are for visitors.
        return {"open": True, "locked": True, "boot": BOOT,
                "look": {k: look[k] for k in ("theme", "mode", "spacing", "corners", "size", "borders", "colours")},
                "words": {k: said[k] for k in ("locked", "locked_hint", "offline")}}
    admin = admin and _code_ok(p, code)
    picks = choices(storage) if p["on"] or admin else []
    close = closes_at(p, where, now)
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
        "open": p["on"] or admin,
        "admin": admin,
        "boot": BOOT,
        "choices": [{"kind": c["kind"], "id": c["id"], "name": c["name"], "group": c["group"],
                     "cover": c["cover"] if look["covers"] else 0,
                     "colours": c["colours"] if look["covers"] else [],
                     "minutes": max(1, round(runner.request_seconds(c) / 60)),
                     "speaker": c.get("speaker", True),
                     # Your admin phone isn't held to the cool-down, only to what's waiting or playing.
                     "taken": taken(runner, c["kind"], c["id"], 0 if admin else p["repeat_minutes"])
                     or ("late" if not admin and too_late(runner, c, close) else ""),
                     "again_in": round(repeat_left(runner, c["kind"], c["id"], p["repeat_minutes"]))} for c in picks if c["available"]],
        # Later ones, soonest first, so visitors know to come back.
        "soon": sorted(({"kind": c["kind"], "id": c["id"], "name": c["name"], "starts": c["starts"], "group": c["group"],
                         # Your admin phone can queue these early, to try them out.
                         **({"taken": taken(runner, c["kind"], c["id"])} if admin else {})}
                        for c in picks if not c["available"]), key=lambda c: (c["starts"], c["name"])),
        "now": {"name": st["name"], "visitor": runner.public_now is not None,
                # How far through, for the bar under its name (a scene goes round with no end: none).
                **({"position": round(st["position"], 1), "duration": round(st["duration"], 1)}
                   if st["duration"] and not (st.get("scene") or {}).get("playing") else {})}
        if st["playing"] else None,
        "waiting": len(runner.requests),
        # Seconds left of a rest break, while the lights rest between visitors' picks.
        "resting": round(max(runner.resting_until - _runner.clock(), 0)),
        # Everyone's waiting picks, by show name only; a phone's own carry their id so it can cancel them.
        "queue": [{"name": r["name"], "kind": r["kind"], "ref": r["ref"], "wait": wait,
                   "yours": bool(ticket) and r["ticket"] == ticket,
                   # Your admin phone can remove anyone's pick, so it gets every id (never tickets).
                   **({"id": r["id"]} if admin or (ticket and r["ticket"] == ticket) else {})}
                  for r, wait in zip(runner.requests, waits)],
        "full": not admin and len(runner.requests) >= p["queue"],
        "per_phone": MAX_QUEUE if admin else p["per_phone"],
        # Seconds before this phone can pick again, after its own pick played.
        "wait_left": 0 if admin else round(phone_wait_left(runner, ticket, p["phone_wait"])),
        "mine": mine,
        "needs_location": needs_location and not admin,
        "listen": {"pin": bool(p["listen_pin"]) and not admin} if p["listen"] else None,
        "hours": {"open": True} if admin else hours_now(p, where, now),
        "look": {**{k: look[k] for k in ("title", "welcome", "theme", "mode", "snow", "link", "link_text", "spacing",
                                         "corners", "size", "borders", "colours", "show_length", "warning",
                                         "covers")},
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


PAGE_FILES = {"index.html": "text/html", "public.js": "text/javascript", "public.css": "text/css",
              "colours.js": "text/javascript", "listensync.js": "text/javascript"}
# The page's own files ask for each other with ?v= and a stamp of what's in them, so a phone (or a
# tunnel's cache, such as Cloudflare's) never mixes an old script with a new page after an update.
_STAMP = hashlib.sha1(b"".join((PAGE / n).read_bytes() for n in sorted(PAGE_FILES))).hexdigest()[:10]
_STAMPED = {"index.html": (('href="public.css"', f'href="public.css?v={_STAMP}"'),
                           ('src="public.js"', f'src="public.js?v={_STAMP}"')),
            "public.js": (('"./colours.js"', f'"./colours.js?v={_STAMP}"'),
                          ('"./listensync.js"', f'"./listensync.js?v={_STAMP}"'))}


def page_file(name: str) -> web.Response:
    """One of the visitors' page's files, with the others it asks for stamped."""
    if name not in PAGE_FILES:
        raise web.HTTPNotFound()
    text = (PAGE / name).read_text(encoding="utf-8")
    for old, new in _STAMPED.get(name, ()):
        text = text.replace(old, new)
    # The page itself is always asked again; stamped files can be kept, as a new stamp is a new address.
    cache = "no-cache" if name == "index.html" else "public, max-age=86400"
    return web.Response(text=text, content_type=PAGE_FILES[name], charset="utf-8",
                        headers={"Cache-Control": cache})


async def page(request):
    return page_file(request.match_info.get("name") or "index.html")


def _state(request, ticket, code):
    p = load(request.app[STORAGE]) or clean(None)
    return state(request.app[STORAGE], request.app[RUNNER], ticket, code, _needs_location(request, p),
                 request.app[WHERE](), admin=is_admin(request, p))


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


async def get_cover(request):
    """A show's or playlist's cover art, only for one visitors can pick now and with your code."""
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    st = request.app[STORAGE]
    p = load(st) or clean(None)
    if not (p["on"] and p["look"]["covers"] and _code_ok(p, request.query.get("code"))):
        raise web.HTTPNotFound()
    q = request.query
    pick = next((c for c in choices(st) if c["available"] and c["kind"] == q.get("kind") and c["id"] == q.get("id")), None)
    pic = cover_of(st, pick) if pick else None
    if pic is None:
        raise web.HTTPNotFound()
    return web.Response(body=pic[1], content_type=pic[0], headers={"Cache-Control": "private, max-age=86400"})


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
    admin = is_admin(request, p)
    if not (p["on"] or admin):
        raise web.HTTPConflict(text=said["closed"])
    if not _code_ok(p, body.get("code")):
        raise web.HTTPForbidden(text=said["locked"])
    # Only requests with the code count towards everyone's limit, so guessing can't lock visitors out.
    _throttle(request.app)
    if not admin and not hours_now(p, request.app[WHERE]())["open"]:
        raise web.HTTPConflict(text=said["not_open_now"])
    if not admin and _needs_location(request, p):
        try:
            _check_near(request, p, body)
        except NotNear as e:
            raise web.HTTPForbidden(text=said[e.word])
    pick = next((c for c in choices(storage) if (c["available"] or admin) and c["kind"] == body.get("kind")
                 and c["id"] == body.get("id")), None)
    if pick is None:
        raise web.HTTPNotFound(text=said["gone"])
    if why := taken(runner, pick["kind"], pick["id"], 0 if admin else p["repeat_minutes"]):
        left = repeat_left(runner, pick["kind"], pick["id"], p["repeat_minutes"])
        raise web.HTTPConflict(text=said["played_recently"].replace("{minutes}", _mins(left)) if why == "recent"
                               else said["already_queued" if why == "queued" else "already_playing"])
    if not admin and (left := phone_wait_left(runner, ticket, p["phone_wait"])):
        raise web.HTTPConflict(text=said["phone_wait"].replace("{minutes}", _mins(left)))
    if not admin and too_late(runner, pick, close := closes_at(p, request.app[WHERE]())):
        raise web.HTTPConflict(text=said["too_late"].replace("{time}", clock(close)))
    yours = sum(r["ticket"] == ticket for r in runner.requests)
    if admin:
        if len(runner.requests) >= MAX_QUEUE:  # still a ceiling, however many you add
            raise web.HTTPConflict(text=said["full"])
    elif yours >= p["per_phone"]:
        raise web.HTTPConflict(text=said["one_waiting"] if p["per_phone"] == 1 else
                               said["many_waiting"].replace("{count}", str(yours)))
    elif len(runner.requests) >= p["queue"]:
        raise web.HTTPConflict(text=said["full"])
    now = datetime.now()
    runner.public_log = [x for x in runner.public_log if (now - x["at"]).total_seconds() < 86400]
    runner.public_log.append({"at": now, "name": pick["name"]})
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
    if _needs_location(request, p) and not is_admin(request, p):
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


# Listening on visitors' phones ----------------------------------------------------------------------
_SECRETS: dict = {}


def _secret(storage: Storage) -> bytes:
    """Signs listening passes. Kept in a hidden file, which backups leave out, so passes survive a restart."""
    if storage.config_dir in _SECRETS:
        return _SECRETS[storage.config_dir]
    f = storage.config_dir / ".listen-secret"
    try:
        value = bytes.fromhex(f.read_text().strip())
        if len(value) < 16:
            raise ValueError
    except (OSError, ValueError):
        value = secrets.token_bytes(32)
        try:
            storage.config_dir.mkdir(parents=True, exist_ok=True)
            f.write_text(value.hex())
        except OSError:
            log.warning("listening: couldn't keep the passes' key, so phones are asked again after a restart")
    _SECRETS[storage.config_dir] = value
    return value


def _sign(storage: Storage, text: str) -> str:
    return hmac.new(_secret(storage), text.encode(), hashlib.sha256).hexdigest()[:32]


def pin_pass(storage: Storage, p: dict) -> str:
    """What a phone keeps once its PIN was right: good until the PIN (or the code) changes."""
    return _sign(storage, f"pin|{p['code']}|{p['listen_pin']}")


def admin_pass(storage: Storage, p: dict) -> str:
    """Your phone's pass once the admin PIN was right: good until that PIN (or the code) changes."""
    return _sign(storage, f"admin|{p['code']}|{p['admin_pin']}")


def is_admin(request, p: dict) -> bool:
    if not (p["admin_pin"] and p["code"]):
        return False
    sent = request.headers.get("X-Admin", "")
    return bool(_PASS.match(sent)) and hmac.compare_digest(sent, admin_pass(request.app[STORAGE], p))


async def _admin_only(request) -> dict:
    """The settings, for your unlocked admin phone only (with the code)."""
    _limit_client(request, "post", MAX_POSTS_PER_CLIENT_MIN)
    body = await _body(request)
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, body.get("code")) or not is_admin(request, p):
        raise web.HTTPForbidden(text=words(p)["locked"])
    return body


async def post_admin_skip(request):
    """Skip the visitor's pick playing now."""
    body = await _admin_only(request)
    await request.app[RUNNER].skip_request()
    log.info("public page: admin skipped the pick playing")
    return _no_store(web.json_response(_state(request, body.get("ticket") and _ticket(body["ticket"]), body.get("code"))))


async def post_admin_stop(request):
    """Stop whatever is on, and clear the queue."""
    body = await _admin_only(request)
    await request.app[RUNNER].stop()
    log.info("public page: admin stopped the lights")
    return _no_store(web.json_response(_state(request, body.get("ticket") and _ticket(body["ticket"]), body.get("code"))))


async def post_admin_remove(request):
    """Take anyone's pick out of the queue."""
    body = await _admin_only(request)
    request.app[RUNNER].remove_request(str(body.get("id", "")))
    return _no_store(web.json_response(_state(request, body.get("ticket") and _ticket(body["ticket"]), body.get("code"))))


async def post_admin(request):
    """Unlocks your own phone with the admin PIN. Without one set, there's nothing to unlock."""
    _limit_client(request, "post", MAX_POSTS_PER_CLIENT_MIN)
    body = await _body(request)
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, body.get("code")):
        raise web.HTTPForbidden(text=words(p)["locked"])
    if not p["admin_pin"]:
        raise web.HTTPForbidden(text=words(p)["pin_wrong"])
    _pin_ok(request, p, body, "admin_pin")
    return _no_store(web.json_response({"pass": admin_pass(request.app[STORAGE], p)}))


def listen_token(storage: Storage, p: dict, until: int) -> str:
    code, pin = p["code"], p["listen_pin"]
    return f"{until:010d}." + _sign(storage, f"listen|{code}|{pin}|{until}")


def song_sig(storage: Storage, p: dict, key: str, admin: bool = False) -> str:
    """The song's link: yours carries its own, which still works while visitors are off."""
    code, pin = p["code"], p["listen_pin"]
    if admin:
        return _sign(storage, f"song-admin|{code}|{p['admin_pin']}|{key}")
    return _sign(storage, f"song|{code}|{pin}|{key}")


# A fifth of a second of silence: pressing Listen plays it, which lets the page play the song later
# (phones only play sound started from a press).
SILENCE = (b"RIFF" + (36 + 3200).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little")
           + (1).to_bytes(2, "little") + (1).to_bytes(2, "little") + (8000).to_bytes(4, "little")
           + (16000).to_bytes(4, "little") + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
           + b"data" + (3200).to_bytes(4, "little") + bytes(3200))


async def get_silence(request):
    return web.Response(body=SILENCE, content_type="audio/wav", headers={"Cache-Control": "max-age=86400"})


def token_ok(storage: Storage, p: dict, token, now: float | None = None) -> bool:
    if not isinstance(token, str) or not _TOKEN.match(token):
        return False
    until = int(token.split(".")[0])
    return until >= (now or time.time()) and hmac.compare_digest(token, listen_token(storage, p, until))


def _pin_ok(request, p: dict, body: dict, which: str = "listen_pin"):
    """Raises unless the PIN (or a pass from an earlier right PIN) is good; wrong ones are counted."""
    said = words(p)
    st = request.app[STORAGE]
    good = pin_pass(st, p) if which == "listen_pin" else admin_pass(st, p)
    sent_pass = body.get("pass")
    if isinstance(sent_pass, str) and _PASS.match(sent_pass) and hmac.compare_digest(sent_pass, good):
        return
    pin = str(body.get("pin") or "").strip()
    now, tries = time.monotonic(), request.app[PIN_TRIES]
    who = f"{which}|{client(request)}"
    wrong = [t for t in tries.get(who, ()) if now - t < PIN_WAIT_S]
    if len(wrong) >= MAX_PIN_TRIES:
        raise web.HTTPTooManyRequests(text=said["pin_wait"])
    if not pin:
        raise web.HTTPForbidden(text=said["pin_needed"], headers={"X-Listen": "pin"})
    if not hmac.compare_digest(pin.encode(), p[which].encode()):
        if who not in tries and len(tries) >= MAX_CLIENTS:
            tries.clear()
        tries[who] = [*wrong, now]
        raise web.HTTPForbidden(text=said["pin_wrong"], headers={"X-Listen": "pin"})
    tries.pop(who, None)


def _listening(request, code, admin_sig: bool = False) -> dict:
    """The settings, for a phone allowed to ask about listening at all (code right, listening on; the
    page on too, unless it's yours)."""
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, code):
        raise web.HTTPForbidden(text=words(p)["locked"])
    if not ((p["on"] or admin_sig or is_admin(request, p)) and p["listen"]):
        raise web.HTTPConflict(text=words(p)["listen_off"])
    return p


async def post_listen(request):
    """A listening pass for this phone: by the lights (as for Start) and, if set, with the PIN."""
    _limit_client(request, "post", MAX_POSTS_PER_CLIENT_MIN)
    body = await _body(request)
    p = _listening(request, body.get("code"))
    admin = is_admin(request, p)
    if _needs_location(request, p) and not admin:
        try:
            _check_near(request, p, body)
        except NotNear as e:
            raise web.HTTPForbidden(text=words(p)[e.word])
    st = request.app[STORAGE]
    out = {}
    if p["listen_pin"] and not admin:
        _pin_ok(request, p, body)
        out["pass"] = pin_pass(st, p)
    until = int(time.time()) + LISTEN_FOR_S
    return _no_store(web.json_response({**out, "token": listen_token(st, p, until), "seconds": LISTEN_FOR_S}))


_SONG_NOW: dict = {}  # config folder -> ((show id, start count), (name, song file or None, duration))


def playing_song(storage: Storage, runner: Runner) -> tuple[dict, Path | None]:
    """The show playing now ({name, duration}) and its song file, whether its song is on a speaker,
    in the Show player or nowhere; None for the song with no show on (a scene or a building block
    has no song). Every listening phone asks once a second, so each show is read once per start."""
    pl = runner.player
    if not pl.playing or not pl.show_id:
        return {}, None
    which = (pl.show_id, runner.started)
    known = _SONG_NOW.get(storage.config_dir)
    if not known or known[0] != which:
        show = storage.load_show(pl.show_id)
        known = (which, ((show or {}).get("name") or pl.show_id, _song_file(storage, show)))
        _SONG_NOW[storage.config_dir] = known
    name, path = known[1]
    if path is not None and not path.is_file():
        path = None
    return {"name": name, "duration": pl.status()["duration"]}, path


def _now_playing(request) -> tuple[dict, Path | None]:
    return playing_song(request.app[STORAGE], request.app[RUNNER])


def _pass_ok(request, p: dict, token):
    if not token_ok(request.app[STORAGE], p, token):
        raise web.HTTPForbidden(text=words(p)["listen_again"], headers={"X-Listen": "renew"})


async def get_listen_now(request):
    """Where the song playing now is: the phone sets its own song to match. Asked about once a second."""
    _limit_client(request, "listen", MAX_LISTEN_PER_CLIENT_MIN)
    p = _listening(request, request.query.get("code"))
    _pass_ok(request, p, request.query.get("token"))
    seen = request.app[RUNNER].public_listeners
    if len(seen) > MAX_CLIENTS:
        seen.clear()
    seen[request.query.get("token", "")] = _runner.clock()
    st, path = _now_playing(request)
    if path is None:
        return _no_store(web.json_response({"playing": False}))
    copies = request.app[COPIES]
    copies.want(path)
    try:
        key = songcopy.key_of(path)
    except OSError:
        return _no_store(web.json_response({"playing": False}))
    ready = copies.ready(path) is not None
    out = {"playing": True, "key": key, "ready": ready, "name": st.get("name"), "duration": st.get("duration")}
    if ready:
        # Its own signature rather than the pass, so a phone still loading the song when its pass is
        # renewed carries on.
        admin = is_admin(request, p)
        out["src"] = "listen/song?" + urlencode({"code": p["code"], "key": key,
                                                 "sig": song_sig(request.app[STORAGE], p, key, admin),
                                                 **({"a": "1"} if admin else {})})
    # Read last, so it's as close as can be to the moment the answer leaves.
    out["position"] = round(request.app[RUNNER].player.position(), 4)
    return _no_store(web.json_response(out))


async def get_listen_song(request):
    """The song playing now (its small copy), only for a phone with a listening pass."""
    _limit_client(request, "listen", MAX_LISTEN_PER_CLIENT_MIN)
    yours = request.query.get("a") == "1"
    p = _listening(request, request.query.get("code"), admin_sig=yours)
    key, sig = request.query.get("key"), request.query.get("sig")
    if not (isinstance(key, str) and isinstance(sig, str) and _PASS.match(sig) and (not yours or p["admin_pin"])
            and hmac.compare_digest(sig, song_sig(request.app[STORAGE], p, key, yours))):
        raise web.HTTPForbidden(text=words(p)["listen_again"])
    _, path = _now_playing(request)
    try:
        if path is None or songcopy.key_of(path) != key:
            raise web.HTTPNotFound()
    except OSError:
        raise web.HTTPNotFound()
    found = request.app[COPIES].ready(path)
    if found is None:
        request.app[COPIES].want(path)
        raise web.HTTPServiceUnavailable(text="still getting it ready", headers={"Retry-After": "2"})
    resp = web.FileResponse(found[0], headers={"Content-Type": found[1], "Cache-Control": "private, max-age=3600"})
    return resp


# Installing the page as an app ------------------------------------------------------------------------
# Each theme's background and heading colours (public.css), light then dark; the app's colours follow
# the page's. "Follow the phone" picks dark: the page is mostly used after dark, by the lights.
APP_COLOURS = {"plain": (("#f5f6f8", "#0277bd"), ("#111418", "#4fc3f7")),
               "christmas": (("#fbf6f1", "#1b6b3a"), ("#0e1913", "#7fd39b")),
               "frosty": (("#f0f6fb", "#0d47a1"), ("#0a1520", "#90caf9")),
               "halloween": (("#fbf5ee", "#6a1b9a"), ("#130e16", "#f0a35e"))}
ICON_SIZES = (192, 512)
_ICONS: dict = {}  # (size, background, wire) -> PNG


def app_colours(look: dict) -> tuple[str, str]:
    """(background, heading colour) for the app's splash screen, title bar and icon."""
    if look["theme"] == "custom":
        c = look["colours"]
        return c["bg"], c["head"]
    light, dark = APP_COLOURS.get(look["theme"], APP_COLOURS["plain"])
    return light if look["mode"] == "light" else dark


def manifest(p: dict) -> dict:
    bg, head = app_colours(p["look"])
    v = hashlib.sha1(f"{bg}{head}".encode()).hexdigest()[:8]
    name = p["look"]["title"] or "Light show"
    icons = [{"src": f"icon.png?{urlencode({'s': n, 'v': v})}", "sizes": f"{n}x{n}", "type": "image/png",
              "purpose": purpose} for n in ICON_SIZES for purpose in ("any", "maskable")]
    # The code goes in the address the app opens, so it works however long ago it was installed.
    return {"name": name, "short_name": name if len(name) <= 24 else name[:23] + "…",
            "id": "./", "start_url": "./?" + urlencode({"c": p["code"]}), "scope": "./",
            "display": "standalone", "background_color": bg, "theme_color": bg, "icons": icons}


async def get_manifest(request):
    """What a phone needs to install the page as an app: only with the code, like the title."""
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    p = load(request.app[STORAGE]) or clean(None)
    if not _code_ok(p, request.query.get("c")):
        raise web.HTTPNotFound()
    return web.json_response(manifest(p), content_type="application/manifest+json",
                             headers={"Cache-Control": "no-cache"})


async def get_icon(request):
    _limit_client(request, "state", MAX_STATE_PER_CLIENT_MIN)
    try:
        size = int(request.query.get("s", "192"))
    except ValueError:
        size = 0
    if size not in ICON_SIZES:
        raise web.HTTPNotFound()
    p = load(request.app[STORAGE]) or clean(None)
    bg, head = app_colours(p["look"])
    key = (size, bg, head)
    if key not in _ICONS:
        if len(_ICONS) > 8:
            _ICONS.clear()
        _ICONS[key] = await asyncio.to_thread(appicon.png, size, bg, head)
    return web.Response(body=_ICONS[key], content_type="image/png",
                        headers={"Cache-Control": "public, max-age=86400"})


def make_public_app(storage: Storage, runner: Runner, where=lambda: None,
                    copies: songcopy.SongCopies | None = None) -> web.Application:
    app = web.Application(middlewares=[safe_headers], client_max_size=4096)
    app[STORAGE] = storage
    app[RUNNER] = runner
    app[WHERE] = where
    app[POSTS] = []
    app[NEAR] = []
    app[CLIENTS] = {}
    app[PIN_TRIES] = {}
    app[COPIES] = copies or songcopy.SongCopies()
    r = app.router
    r.add_get("/", page)
    r.add_get("/{name:(public\\.js|public\\.css|colours\\.js|listensync\\.js)}", page)
    r.add_get("/api/state", get_state)
    r.add_get("/manifest.webmanifest", get_manifest)
    r.add_get("/icon.png", get_icon)
    r.add_get("/picture", get_picture)
    r.add_get("/cover", get_cover)
    r.add_post("/api/request", post_request)
    r.add_post("/api/cancel", post_cancel)
    r.add_post("/api/near", post_near)
    r.add_post("/api/listen", post_listen)
    r.add_post("/api/admin", post_admin)
    r.add_post("/api/admin/skip", post_admin_skip)
    r.add_post("/api/admin/stop", post_admin_stop)
    r.add_post("/api/admin/remove", post_admin_remove)
    r.add_get("/api/listen/now", get_listen_now)
    r.add_get("/listen/song", get_listen_song)
    r.add_get("/listen/silence.wav", get_silence)
    return app


class PublicSite:
    """Opens the public page's port once the public settings exist."""

    def __init__(self, storage: Storage, runner: Runner, where=lambda: None):
        self.storage, self.runner, self.where = storage, runner, where
        self.port = port()
        self.error: str | None = None
        self._runner: web.AppRunner | None = None
        self.copies = songcopy.SongCopies()
        self._watch: asyncio.Task | None = None

    async def _get_songs_ready(self):
        """With listening on, makes the playing song's copy as soon as it starts, so the first phone
        rarely waits, and the public page's own shows' copies ahead of time."""
        ahead_done = None
        while True:
            try:
                p = load(self.storage)
                if p and p["on"] and p["listen"] and songcopy.converter():
                    if (path := playing_song(self.storage, self.runner)[1]) is not None:
                        self.copies.want(path)
                    if ahead_done != p["items"]:
                        ahead_done = p["items"]
                        for c in choices(self.storage):
                            for sid in c["shows"]:
                                if (path := _song_file(self.storage, self.storage.load_show(sid))) is not None:
                                    self.copies.want(path)
            except Exception:  # never let a hiccup stop the watching
                log.exception("listening: getting songs ready")
            await asyncio.sleep(2)

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
        if self._watch is None:
            self._watch = asyncio.get_running_loop().create_task(self._get_songs_ready())
        app_runner = web.AppRunner(make_public_app(self.storage, self.runner, self.where, self.copies),
                                   access_log=None)
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
        if self._watch:
            self._watch.cancel()
            self._watch = None
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
