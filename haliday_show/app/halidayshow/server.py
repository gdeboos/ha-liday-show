"""HTTP API and editor for the Home Assistant ingress panel.

All URLs the editor uses are relative, because ingress serves the panel from
/api/hassio_ingress/<token>/.
"""
import asyncio
import base64
import binascii
import contextlib
import hashlib
import datetime
import hmac
import ipaddress
import json
import logging
import math
import os
import urllib.parse
import re
import secrets
import shutil
import tempfile
import time
import zlib
from pathlib import Path

import aiohttp
from aiohttp import web

from . import __version__, ai, archive, backup, commands, discovery, e131, imagemeta, latespeaker, liveeffects, livemusic, migrate, playlists, preshow, public, report, scenelib, schedule, seasons, songcopy, songtags, timingtest, twinkly, video, wled
from .baked import BakedError, decode
from .ha import HAError, HomeAssistant
from .lab import (KINDS as LAB_KINDS, MAX_REPEAT as LAB_MAX_REPEAT, MAX_STEPS as LAB_MAX_STEPS, Lab, LabError,
                  Step as LabStep, build as lab_build)
from .listen import Listener
from .livemusic import LiveMusic
from .mqtt import MqttBridge
from . import integration
from .output import PROBE_MAX, LivePreview, Output, address, blink_frame, chase_frame, linked, run_frames, run_hold, run_probe, run_test_pattern
from .player import Player
from .protocol import LONG_PROTOCOLS, PROTOCOLS
from .runner import Runner, RunnerError
from .storage import PART_NAMES, Storage, slugify, valid_id

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PEER = "172.30.32.2"  # the Supervisor's ingress proxy
MAX_UPLOAD = 200 * 1024 * 1024
MAX_BULBS = 2000  # bulbs on one light
MAX_SEGMENTS = 1000  # per light; the Christmas String Lights 2 have 300 bulbs
MAX_MATRIX = 4096  # LEDs on a matrix (64 x 64), which bakes to about 90 MB for 3 minutes
MATRIX_KINDS = ("wled", "ddp", "e131")
MATRIX_STARTS = ("top left", "top right", "bottom left", "bottom right")
# WLED numbers its segments from 0; builds allow up to 32 (more on some), so leave room.
MAX_WLED_SEGMENT = 63
MAX_FIRST_LED = 100000  # where a light starts on a pixel controller; DDP offsets go far beyond this
KINDS = ("govee", "wled", "ddp", "e131", "ha", "twinkly")
_HA_ENTITY = re.compile(r"^(light|switch)\.[a-z0-9_]{1,200}$")

OUTPUT = web.AppKey("output", Output)
PLAYER = web.AppKey("player", Player)
STORAGE = web.AppKey("storage", Storage)
TESTS = web.AppKey("tests", dict)
VIDEOS = web.AppKey("videos", video.Exports)
PREVIEWS = web.AppKey("previews", dict)
HA = web.AppKey("ha", HomeAssistant)
RUNNER = web.AppKey("runner", Runner)
SCHEDULER = web.AppKey("scheduler", schedule.Scheduler)
MQTT = web.AppKey("mqtt", MqttBridge)
BACKGROUND = web.AppKey("background", list)
LIVE = web.AppKey("live", LiveMusic)
ALLOW_ALL = web.AppKey("allow_all", bool)
PASSWORD = web.AppKey("password", str)
# {"listener": the latest Listener or None, "options": Listener options (tests use spare ports)}
LISTENING = web.AppKey("listening", dict)
LAB = web.AppKey("lab", Lab)
PUBLIC = web.AppKey("public", public.PublicSite)
HUB = web.AppKey("hub", integration.Hub)


@web.middleware
async def ingress_only(request: web.Request, handler):
    """host_network exposes our port on the LAN; only answer the ingress proxy.

    Outside Home Assistant there is no ingress, so a password (HALIDAY_SHOW_PASSWORD) lets the
    browser in with HTTP Basic auth instead.
    """
    if not request.app[ALLOW_ALL]:
        peer = request.remote or ""
        try:
            ok = peer == INGRESS_PEER or ipaddress.ip_address(peer).is_loopback
        except ValueError:
            ok = False
        password = request.app[PASSWORD]
        if not ok and password:
            if not _password_ok(request.headers.get("Authorization", ""), password):
                raise web.HTTPUnauthorized(text="Enter the HA-liday Show password.",
                                           headers={"WWW-Authenticate": 'Basic realm="HA-liday Show"'})
        elif not ok:
            raise web.HTTPForbidden(text="Open HA-liday Show from the Home Assistant sidebar."
                                    if os.environ.get("SUPERVISOR_TOKEN") else
                                    "Set HALIDAY_SHOW_PASSWORD to open HA-liday Show from another device.")
    return await handler(request)


def _password_ok(header: str, password: str) -> bool:
    """Any user name; only the password counts."""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        _, _, given = base64.b64decode(value, validate=True).decode().partition(":")
    except (binascii.Error, UnicodeDecodeError):
        return False
    return hmac.compare_digest(given.encode(), password.encode())


def _show_id(request) -> str:
    show_id = request.match_info["id"]
    if not valid_id(show_id):
        raise web.HTTPBadRequest(text="bad show id")
    return show_id


# pages -------------------------------------------------------------------
async def index(request):
    resp = web.FileResponse(STATIC / "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def show_player_page(request):
    """A page to leave open on a computer with speakers: it plays the songs of shows started without
    a speaker (by a playlist, the schedule or an automation), and the lights follow it."""
    resp = web.FileResponse(STATIC / "player.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def no_cache_static(request, response):
    """Make browsers check for a newer app.js and effects.js after each update.

    Without this they may keep running the previous version's scripts for days. Unchanged files
    still come back as a quick 304.
    """
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"


async def info(request):
    return web.json_response({"version": __version__, "ha": request.app[HA].available,
                              "mqtt": request.app[MQTT].client is not None,
                              # what 0.2.207's Govee clear-out changed, for the editor to say once
                              "retired": migrate.retired(request.app[STORAGE].config_dir)})


# The Home Assistant integration (integration.py) ------------------------------------------------
async def integration_state(request):
    return web.json_response(request.app[HUB].snapshot())


async def integration_library(request):
    """Your shows and playlists with their folders, for the Browse card. Read only when a card asks."""
    storage = request.app[STORAGE]
    shows, settings, plays = await asyncio.to_thread(lambda: (storage.list_shows(), storage.load_settings(),
                                                              playlists.load(storage)))
    saved = settings.get("library_folders")
    saved = saved if isinstance(saved, dict) else {}
    season_names = {x["id"]: x["name"] for x in seasons.load(settings)}
    folders = lambda kind: [{k: f[k] for k in ("id", "name", "items", "parent") if k in f}
                            for f in saved.get(kind, []) if isinstance(f, dict)]
    return web.json_response({
        # picture: its version number (0 for none), so a card fetches a new one when it changes
        "shows": [{"id": s["id"], "name": s["name"], "duration": s["duration"], "picture": s["picture"],
                   "cover": s["cover"], "colours": s["colours"][:4] if isinstance(s.get("colours"), list) else [],
                   "season": s["season"], "season_name": season_names.get(s["season"])}
                  for s in shows if not s["in_progress"]],
        "playlists": [{"id": p["id"], "name": p["name"], "items": len(p.get("items") or [])} for p in plays],
        "folders": {"shows": folders("shows"), "playlists": folders("playlists")},
    })


async def integration_image(request):
    """A show's picture, else its song's cover art, for the Browse and Player cards."""
    storage = request.app[STORAGE]
    show_id = _show_id(request)
    pic, show = await asyncio.to_thread(lambda: (storage.show_picture(show_id), storage.load_show(show_id) or {}))
    if pic is not None:
        return web.FileResponse(pic, headers={"Cache-Control": "private, max-age=300"})
    audio = show.get("audio") if isinstance(show.get("audio"), dict) else {}
    p = storage.audio_path(audio.get("source", ""), audio.get("path", "")) if audio else None
    found = await asyncio.to_thread(songtags.cached_cover, p) if p is not None else None
    if found is None:
        raise web.HTTPNotFound(text="no picture for that show")
    return web.Response(body=found[1], content_type=found[0], headers={"Cache-Control": "private, max-age=300"})


async def integration_ws(request):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    hub = request.app[HUB]
    await ws.send_str(json.dumps({"type": "state", "state": hub.snapshot()}))
    hub.clients.add(ws)
    try:
        async for _ in ws:  # nothing is expected from the integration over this; commands are POSTs
            pass
    finally:
        hub.clients.discard(ws)
    return ws


def _clean_integration_command(body) -> dict:
    if not isinstance(body, dict) or not isinstance(body.get("action"), str):
        raise web.HTTPBadRequest(text="expected {action: ...}")
    out = {"action": body["action"][:40]}
    for key in ("show", "playlist", "scene", "season", "media_player"):
        if isinstance(body.get(key), str) and body[key].strip():
            out[key] = body[key][:200]
    for key in ("on", "out"):
        if isinstance(body.get(key), bool):
            out[key] = body[key]
    pos = body.get("position")
    if isinstance(pos, (int, float)) and not isinstance(pos, bool) and math.isfinite(pos):
        out["position"] = max(0.0, min(float(pos), 24 * 3600.0))
    if "media_player" in out and not re.fullmatch(r"media_player\.[a-z0-9_]+", out["media_player"]):
        raise web.HTTPBadRequest(text="media_player must be a speaker's entity id, like media_player.garden")
    level = body.get("brightness")
    if isinstance(level, (int, float)) and not isinstance(level, bool) and math.isfinite(level):
        out["brightness"] = max(1, min(100, round(level)))
    return out


async def integration_command(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    cmd = _clean_integration_command(body)
    try:
        done = await integration.command(request.app[RUNNER], cmd, request.app[MQTT].refresh)
    except (ValueError, RunnerError) as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[HUB].refresh()
    return web.json_response({"ok": True, "done": done})


async def integration_claim(request):
    """The integration takes over Home Assistant's entities (on: true) or hands them back."""
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("on"), bool):
        raise web.HTTPBadRequest(text="expected {on: true|false}")
    integration.set_claimed(request.app[STORAGE], body["on"])
    request.app[MQTT].refresh()
    return web.json_response({"ok": True, "claimed": body["on"]})


def _integration_extras(app, now=None) -> dict:
    """What the integration's sensors show beyond the basics; cheap enough for once a second, except
    the schedule's next start, which is worked out at most every 30 seconds."""
    storage, runner = app[STORAGE], app[RUNNER]
    settings = storage.load_settings()
    p = public.load(storage) or public.clean(None)
    cache = app[HUB].__dict__.setdefault("_next_cache", {"at": 0.0, "value": None})
    if time.monotonic() - cache["at"] > 30:
        cache["at"] = time.monotonic()  # first, so a failure isn't retried (and logged) every second
        cache["value"] = _next_on_schedule(app)
    voting = p.get("pick") == "vote"
    last = settings.get("preshow") if isinstance(settings.get("preshow"), dict) else None
    return {
        "next": cache["value"],
        "queue": {"mode": "vote" if voting else "queue",
                  "waiting": len(runner.votes) if voting else len(runner.requests),
                  "names": [r["name"] for r in runner.requests][:20] if not voting else
                  [f"{c['name']} ({c['count']})" for c in runner.vote_counts()][:20]},
        "listening": public.tonight(runner)["listening"],
        "preshow": {**last, "at": _with_zone(last.get("at"))} if last else None,
        "page": {"on": bool(p["on"]), "open": bool(p["on"] and public.hours_now(p, app[SCHEDULER].where()[0], now)["open"])},
    }


def _with_zone(text):
    """Local times are saved without a zone; say which, for Home Assistant on another computer."""
    try:
        return datetime.datetime.fromisoformat(text).astimezone().isoformat(timespec="minutes")
    except (TypeError, ValueError):
        return None


def _next_on_schedule(app) -> dict | None:
    """The schedule's next start: {at, name, kind}, or None. Names come from the hub's lists, so no
    show is read from disk."""
    storage, hub = app[STORAGE], app[HUB]
    listed = hub.snapshot_lists()
    names = {"playlist": {x["id"]: x["name"] for x in listed["playlists"]},
             "scene": {x["id"]: x["name"] for x in listed["scenes"]},
             "show": {x["id"]: x["name"] for x in listed["shows"]}}
    state = app[SCHEDULER].state()
    entries = {e["id"]: e for e in schedule.load_entries(storage)}
    for at, i in sorted((at, i) for i, at in state["next"].items() if i in entries):
        kind, ref = entries[i]["play"]["type"], entries[i]["play"]["id"]
        if name := names.get(kind, {}).get(ref):
            return {"at": _with_zone(at), "name": name, "kind": kind}
    return None


# Export video (video.py) ------------------------------------------------------------------------
_VIDEO_ID = re.compile(r"^[a-z0-9]{12}$")


def _video(request) -> video.Export:
    job_id = request.match_info["id"]
    job = request.app[VIDEOS].get(job_id) if _VIDEO_ID.match(job_id) else None
    if job is None:
        raise web.HTTPNotFound(text="that video has gone: export it again")
    return job


def _clean_video(body) -> dict:
    """What the editor will send: {show, name, codec, fps, start, duration, tail}."""
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected the video's details")
    num = lambda k, lo, hi: (lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool)
                             and math.isfinite(v) and lo <= v <= hi else None)(body.get(k))
    fps, start = num("fps", 10, 60), num("start", 0, 3 * 3600)
    duration, tail = num("duration", 0.5, video.MAX_SECONDS), num("tail", 0, 10)
    if body.get("codec") not in video.CODECS or None in (fps, start, duration, tail) or int(fps) != fps:
        raise web.HTTPBadRequest(text="expected codec, fps, start, duration and tail")
    show = body.get("show")
    if not isinstance(show, str) or not valid_id(show):
        raise web.HTTPBadRequest(text="bad show id")
    name = " ".join(str(body.get("name") or show).split())[:80]
    return {"show": show, "name": name, "codec": body["codec"], "fps": int(fps), "start": float(start),
            "duration": float(duration), "tail": float(tail)}


async def video_start(request):
    try:
        want = _clean_video(await request.json())
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    storage = request.app[STORAGE]
    show = storage.load_show(want["show"])
    if show is None:
        raise web.HTTPNotFound(text="that show has gone")
    song = public._song_file(storage, show)
    try:
        job = request.app[VIDEOS].start(secrets.token_hex(6), codec=want["codec"], fps=want["fps"], start=want["start"],
                                        duration=want["duration"], tail=want["tail"], song=song, name=want["name"])
    except video.VideoError as e:
        raise web.HTTPConflict(text=str(e)[:1].upper() + str(e)[1:])
    return web.json_response({**job.view(), "song": song is not None})


async def video_part(request):
    job = _video(request)
    try:
        request.app[VIDEOS].add(job, await request.read())
    except video.VideoError as e:
        raise web.HTTPConflict(text=str(e)[:1].upper() + str(e)[1:])
    return web.json_response(job.view())


async def video_finish(request):
    job = _video(request)
    try:
        request.app[VIDEOS].finish(job)
    except video.VideoError as e:
        raise web.HTTPConflict(text=str(e)[:1].upper() + str(e)[1:])
    return web.json_response(job.view())


async def video_status(request):
    return web.json_response(_video(request).view())


async def video_file(request):
    job = _video(request)
    if job.state != "done":
        raise web.HTTPConflict(text="the video isn't ready yet")
    # A plain name for every browser, and the real one (any language) for those that read filename*.
    name = re.sub(r'[\\/:*?"<>|;\x00-\x1f]+', " ", job.name)
    name = " ".join(name.split())[:80] or "show"
    plain = name.encode("ascii", "replace").decode().replace("?", "_")
    return web.FileResponse(job.out, headers={
        "Content-Disposition": f'attachment; filename="{plain}.mp4"; filename*=UTF-8\'\'{urllib.parse.quote(name)}.mp4',
        "Cache-Control": "no-store"})


async def video_cancel(request):
    request.app[VIDEOS].drop(_video(request).id)
    return web.json_response({"ok": True})


# Report a problem (report.py) ------------------------------------------------------------------
async def get_report(request):
    """What a bug report needs: version, install, light kinds and recent warnings, all scrubbed."""
    storage = request.app[STORAGE]
    p = public.load(storage) or public.clean(None)
    hosts = [urllib.parse.urlsplit(u).hostname or "" for u in (p["address"], os.environ.get("HA_URL", ""))]
    hidden = [p["code"], p["listen_pin"], p["admin_pin"], *hosts]
    names = await asyncio.to_thread(report.names_in, storage)
    clean = lambda text: report.scrub(text, hidden, names)
    # The message it's reported from (the editor's own words, which often name a light or show).
    error = clean(str(request.query.get("error", ""))[:500])
    return web.json_response({
        "version": __version__, "install": report.install(), "ha": request.app[HA].available,
        "lights": clean(report.lights(storage.load_devices())), "error": error,
        "log": [clean(line) for line in report.recent()]})


# diagnostics -------------------------------------------------------------
async def start_listening(request):
    """Record other Govee traffic for a while, e.g. a Scene Stage sync centre driving lights."""
    body = await request.json()
    try:
        seconds = float(body.get("seconds", 60))
    except (TypeError, ValueError, AttributeError):
        raise web.HTTPBadRequest(text="seconds must be a number")
    if not 1 <= seconds <= 180:
        raise web.HTTPBadRequest(text="seconds must be 1-180")
    app = request.app
    listening = app[LISTENING]
    if (old := listening["listener"]) and old.running:
        old.stop()
    await app[RUNNER].stop(keep_scene=True)  # so the add-on's own frames aren't in the recording
    lights = {d["ip"]: d["name"] for d in app[STORAGE].load_devices() if d.get("ip")}
    listener = listening["listener"] = Listener(lights, **listening["options"])
    listener.start(seconds)
    return web.json_response({"ok": True, "seconds": seconds})


async def listening_status(request):
    listener = request.app[LISTENING]["listener"]
    if listener is None:
        return web.json_response({"running": False, "count": 0, "summary": []})
    if request.query.get("download"):
        body = json.dumps({"raw": listener.raw, "lights": listener.lights, "packets": listener.records}, indent=1)
        return web.Response(text=body, content_type="application/json",
                            headers={"Content-Disposition": 'attachment; filename="govee-traffic.json"'})
    left = max(0.0, listener.until - time.monotonic()) if listener.running else 0.0
    return web.json_response({"running": listener.running, "left": round(left), "raw": listener.raw,
                              "count": len(listener.records), "summary": listener.summary()[:30]})


def _lab_step(body: dict) -> LabStep:
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="each step must be an object")
    kind = body.get("kind")
    if kind not in LAB_KINDS:
        raise web.HTTPBadRequest(text=f"kind must be one of {', '.join(LAB_KINDS)}")
    try:
        repeat = int(body.get("repeat", 1))
        interval = float(body.get("interval_ms", 100)) / 1000
        length = None if body.get("length") in (None, "") else int(body["length"])
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="repeat, interval and length must be numbers")
    if not 1 <= repeat <= LAB_MAX_REPEAT:
        raise web.HTTPBadRequest(text=f"repeat must be 1-{LAB_MAX_REPEAT}")
    if not 0.02 <= interval <= 5:
        raise web.HTTPBadRequest(text="interval must be 20-5000 ms")
    if length is not None and not 0 <= length <= 0xFFFF:
        raise web.HTTPBadRequest(text="length must be 0-65535")
    extra = {}
    for key in ("before", "after"):
        msgs = body.get(key, [])
        if not isinstance(msgs, list) or len(msgs) > 4 or not all(
                isinstance(b, dict) and b.get("kind") in LAB_KINDS for b in msgs):
            raise web.HTTPBadRequest(text=f"{key} must be a list of up to 4 messages, each with a kind and text")
        extra[key] = msgs
    try:
        payload = lab_build(kind, str(body.get("text", "")), length)
        setup = [lab_build(b["kind"], str(b.get("text", ""))) for b in extra["before"]]
        after = [lab_build(b["kind"], str(b.get("text", ""))) for b in extra["after"]]
    except LabError as e:
        raise web.HTTPBadRequest(text=str(e))
    return LabStep(payload, repeat, interval, bool(body.get("realtime_on")), str(body.get("label", ""))[:120],
                   before=setup, after=after)


async def lab_send(request):
    """Packet lab: send a hand-made message to one of your lights, or a sweep of several in turn."""
    body = await request.json()
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected an object")
    app = request.app
    ip = str(body.get("ip", ""))
    if not ip or ip not in _govee_ips(app):
        raise web.HTTPBadRequest(text="pick one of your lights")
    raw_steps = body["steps"] if "steps" in body else [body]
    if not isinstance(raw_steps, list) or not 1 <= len(raw_steps) <= LAB_MAX_STEPS:
        raise web.HTTPBadRequest(text=f"steps must be a list of 1-{LAB_MAX_STEPS}")
    steps = [_lab_step(s) for s in raw_steps]
    # Nothing else may talk to the light meanwhile, or the results mean nothing.
    await app[RUNNER].stop(keep_scene=True)
    if (old := app[TESTS].pop(ip, None)):
        old.cancel()
    app[OUTPUT].release(ip)
    app[LAB].start(ip, steps)
    return web.json_response({"ok": True, "steps": len(steps)})


async def lab_stop(request):
    request.app[LAB].stop()
    return web.json_response({"ok": True})


async def lab_status(request):
    return web.json_response(request.app[LAB].status())


# devices -----------------------------------------------------------------
async def get_devices(request):
    return web.json_response(request.app[STORAGE].load_devices())


_PART_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_PARTS = 32


def _govee_ips(app) -> set:
    """The lab and Listen speak Govee's LAN protocol, so they only reach Govee lights."""
    return {d["ip"] for d in app[STORAGE].load_devices() if d.get("ip") and (d.get("kind") or "govee") == "govee"}


def _clean_parts(parts, segments: int, matrix: dict | None = None) -> list:
    """A light split into parts: each a named run of its segments (1-based, inclusive). Parts can't
    overlap; segments outside every part stay off in shows. On a matrix, each part is a rectangle of
    the grid instead: x, y (0-based from the top left), w and h."""
    if not parts:
        return []
    if not isinstance(parts, list) or len(parts) > MAX_PARTS:
        raise web.HTTPBadRequest(text=f"parts must be a list of up to {MAX_PARTS}")
    if matrix:
        return _clean_rect_parts(parts, matrix)
    clean, used = [], set()
    for p in parts:
        try:
            pid, start, end = str(p["id"]), int(p["from"]), int(p["to"])
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="each part needs an id, from and to")
        if not _PART_ID.match(pid) or any(c["id"] == pid for c in clean):
            raise web.HTTPBadRequest(text="part ids must be short and unique")
        if not 1 <= start <= end <= segments:
            raise web.HTTPBadRequest(text=f"a part must run within segments 1-{segments}")
        span = set(range(start, end + 1))
        if span & used:
            raise web.HTTPBadRequest(text="parts can't overlap")
        used |= span
        clean.append({"id": pid, "name": str(p.get("name") or f"Part {len(clean) + 1}")[:64], "from": start, "to": end})
    return sorted(clean, key=lambda c: c["from"])


def _clean_rect_parts(parts: list, matrix: dict) -> list:
    clean = []
    for p in parts:
        try:
            pid = str(p["id"])
            x, y, w, h = (int(p[k]) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="each part of a matrix needs an id, x, y, w and h")
        if not _PART_ID.match(pid) or any(c["id"] == pid for c in clean):
            raise web.HTTPBadRequest(text="part ids must be short and unique")
        if not (0 <= x and 0 <= y and w >= 1 and h >= 1 and x + w <= matrix["w"] and y + h <= matrix["h"]):
            raise web.HTTPBadRequest(text=f"a part must fit within the {matrix['w']} × {matrix['h']} grid")
        if any(x < c["x"] + c["w"] and c["x"] < x + w and y < c["y"] + c["h"] and c["y"] < y + h for c in clean):
            raise web.HTTPBadRequest(text="parts can't overlap")
        clean.append({"id": pid, "name": str(p.get("name") or f"Part {len(clean) + 1}")[:64], "x": x, "y": y, "w": w, "h": h})
    return sorted(clean, key=lambda c: (c["y"], c["x"]))


def _clean_matrix(m) -> dict:
    """A light laid out as a grid: its size, and how its wiring runs from the first LED. A WLED set
    up as 2D sorts out its own wiring, so it's plain rows from the top left here."""
    if not isinstance(m, dict):
        raise web.HTTPBadRequest(text="matrix must have a width and height")
    try:
        w, h = int(m.get("w")), int(m.get("h"))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="a matrix's width and height must be numbers")
    if w < 1 or h < 1 or w * h > MAX_MATRIX:
        raise web.HTTPBadRequest(text=f"a matrix has 1 to {MAX_MATRIX} LEDs (width times height)")
    start, order = m.get("start", "top left"), m.get("order", "rows")
    if start not in MATRIX_STARTS:
        raise web.HTTPBadRequest(text=f"a matrix starts at one of: {', '.join(MATRIX_STARTS)}")
    if order not in ("rows", "columns"):
        raise web.HTTPBadRequest(text="a matrix is wired in rows or columns")
    return {"w": w, "h": h, "start": start, "order": order, "zigzag": bool(m.get("zigzag"))}


def _clean_device(d: dict) -> dict:
    """A device with no IP is planned: it has tracks in shows but nothing to send to yet."""
    ip = str(d.get("ip") or "").strip()
    try:
        if ip:
            ipaddress.IPv4Address(ip)
        segments = int(d.get("segments", 15))
    except (TypeError, ValueError) as e:
        raise web.HTTPBadRequest(text=f"bad device: {e}")
    # Saved before WLED existed (say, restored from an old backup), a device has no kind: it's a Govee
    # light. Start-up fills these in (migrate.fill_device_kinds).
    kind = d.get("kind") if d.get("kind") in KINDS else "govee"
    entity = ""
    if kind == "ha":
        # A Home Assistant light or switch: no IP, one segment. No entity yet is a planned one.
        entity = str(d.get("entity") or "").strip()
        if entity and not _HA_ENTITY.match(entity):
            raise web.HTTPBadRequest(text="entity must be a light or switch, like light.porch")
        ip, segments = "", 1
    protocol = {"wled": "ddp", "ddp": "ddp", "e131": "e131", "twinkly": "twinkly"}.get(kind) \
        or str(d.get("protocol") or "standard")
    if kind == "ha":
        protocol = "ha_switch" if entity.startswith("switch.") else "ha_light"
    if kind == "govee" and protocol not in PROTOCOLS:
        raise web.HTTPBadRequest(text=f"protocol must be one of {', '.join(PROTOCOLS)}")
    matrix = None
    if d.get("matrix") is not None:
        if kind not in MATRIX_KINDS:
            raise web.HTTPBadRequest(text="only WLED lights and pixel controllers can be a matrix")
        matrix = _clean_matrix(d["matrix"])
        segments = matrix["w"] * matrix["h"]
    # Realtime messages hold the segment count in one byte; the other protocols can go further.
    most = MAX_SEGMENTS if protocol in LONG_PROTOCOLS or kind != "govee" else 255
    if matrix:
        most = MAX_MATRIX
    if not 1 <= segments <= most:
        raise web.HTTPBadRequest(text=f"segments must be 1-{most} with this protocol")
    try:
        brightness = int(d.get("brightness", 100))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="brightness must be a number")
    if not 1 <= brightness <= 100:
        raise web.HTTPBadRequest(text="brightness must be 1-100")
    try:
        bulbs = int(d["bulbs"]) if d.get("bulbs") else None
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="bulbs must be a number")
    if bulbs is not None and not 1 <= bulbs <= MAX_BULBS:
        raise web.HTTPBadRequest(text=f"bulbs must be 1-{MAX_BULBS}")
    dev_id = str(d.get("id") or ip or (f"ha-{entity}" if entity else ""))
    if not dev_id:
        raise web.HTTPBadRequest(text="a planned device needs an id")
    extra = {"entity": entity} if kind == "ha" else {}
    if matrix:
        extra["matrix"] = matrix
    try:
        tags = seasons.clean_tags(d.get("seasons"))
    except ValueError as e:
        raise web.HTTPBadRequest(text=str(e))
    if tags:
        extra["seasons"] = tags
    if kind in ("ddp", "wled"):
        # A controller can drive several lights from one IP, each from its own first LED. A WLED light
        # can also be one of the WLED's segments, so WLED's own effects in scenes go to that segment.
        try:
            first = int(d["first"]) if d.get("first") is not None else 1
            segment = int(d["segment"]) if kind == "wled" and d.get("segment") is not None else None
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="first and segment must be numbers")
        if not 1 <= first <= MAX_FIRST_LED:
            raise web.HTTPBadRequest(text=f"first must be 1-{MAX_FIRST_LED}")
        if segment is not None and not 0 <= segment <= MAX_WLED_SEGMENT:
            raise web.HTTPBadRequest(text=f"segment must be 0-{MAX_WLED_SEGMENT}")
        if matrix and (first > 1 or segment is not None):
            raise web.HTTPBadRequest(text="a matrix must be a whole WLED light")
        # Old WLED lights stay as they were saved: first only when it isn't the start.
        if kind == "ddp" or first > 1 or segment is not None:
            extra["first"] = first
        if segment is not None:
            extra["segment"] = segment
    if kind == "e131":
        try:
            universe = int(d["universe"]) if d.get("universe") is not None else 1
            channel = int(d["channel"]) if d.get("channel") is not None else 1
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="universe and channel must be numbers")
        if not 1 <= universe <= e131.MAX_UNIVERSE:
            raise web.HTTPBadRequest(text=f"universe must be 1-{e131.MAX_UNIVERSE}")
        if not 1 <= channel <= e131.UNIVERSE_SIZE:
            raise web.HTTPBadRequest(text=f"channel must be 1-{e131.UNIVERSE_SIZE}")
        if e131.channel_of(universe, channel) + segments * 3 > e131.channel_of(e131.MAX_UNIVERSE + 1, 1):
            raise web.HTTPBadRequest(text="the light runs past the last universe")
        extra.update(universe=universe, channel=channel)
    return {"id": dev_id, "name": str(d.get("name") or ip or dev_id)[:64], "kind": kind,
            "ip": ip, "sku": "" if kind == "wled" else str(d.get("sku", "")), "segments": segments,
            "reverse": bool(d.get("reverse")) and not matrix, "gradient": kind == "govee" and bool(d.get("gradient")),
            "protocol": protocol, "brightness": brightness, "bulbs": bulbs,
            "parts": _clean_parts(d.get("parts"), segments, matrix),
            # A split light's own track plays across all its parts unless this is off.
            "whole": d.get("whole", True) is not False, **extra}


async def put_devices(request):
    body = await request.json()
    if not isinstance(body, list):
        raise web.HTTPBadRequest(text="expected a list")
    devices = []
    for d in body:
        try:
            devices.append(_clean_device(d))
        except web.HTTPBadRequest as e:
            # The whole list is saved at once, so say which light is wrong.
            name = str(d.get("name") or d.get("id") or "") if isinstance(d, dict) else ""
            raise web.HTTPBadRequest(text=f"{name}: {e.text}" if name else e.text) from None
    if len({d["id"] for d in devices}) != len(devices):
        raise web.HTTPBadRequest(text="duplicate device id")
    storage = request.app[STORAGE]
    storage.save_devices(devices)
    # A light just ticked into a packed-away season goes dark straight away, as packing away does.
    request.app[RUNNER].player.drop(seasons.away(devices, seasons.load(storage.load_settings())))
    return web.json_response(devices)


async def scan_devices(request):
    found = await discovery.scan()
    return web.json_response([{"id": d.get("device") or d["ip"], "ip": d["ip"],
                               "sku": d.get("sku", "")} for d in found])


async def wled_info(request):
    """Ask a WLED light for its name, LED count and segments, to fill in a new light or its parts."""
    body = await request.json()
    ip = str(body.get("ip") or "").strip() if isinstance(body, dict) else ""
    try:
        ipaddress.IPv4Address(ip)
    except ValueError:
        raise web.HTTPBadRequest(text="ip must be an IP address")
    try:
        found = await wled.fetch(ip)
    except wled.WledError as e:
        raise web.HTTPBadGateway(text=str(e))
    return web.json_response({**found, "max": MAX_SEGMENTS, "maxMatrix": MAX_MATRIX})


async def wled_scan(request):
    """WLED lights that answer on the network, with their names and LEDs."""
    return web.json_response({"found": await wled.scan(), "max": MAX_SEGMENTS})


async def twinkly_info(request):
    """Ask a Twinkly light (experimental) for its name and LED count, to fill in a new light."""
    body = await request.json()
    ip = str(body.get("ip") or "").strip() if isinstance(body, dict) else ""
    try:
        ipaddress.IPv4Address(ip)
    except ValueError:
        raise web.HTTPBadRequest(text="ip must be an IP address")
    try:
        found = await twinkly.fetch(ip)
    except twinkly.TwinklyError as e:
        raise web.HTTPBadGateway(text=str(e))
    return web.json_response({**found, "max": MAX_SEGMENTS})


async def ha_entities(request):
    """Home Assistant's lights and switches, to pick from when adding one as a light in shows."""
    ha = request.app[HA]
    if not ha.available:
        raise web.HTTPServiceUnavailable(text="Home Assistant isn't reachable from here")
    try:
        states = await ha.states()
    except HAError as e:
        raise web.HTTPBadGateway(text=str(e))
    found = []
    for s in states:
        entity = s.get("entity_id", "")
        if not _HA_ENTITY.match(entity):
            continue
        attrs = s.get("attributes") or {}
        modes = set(attrs.get("supported_color_modes") or [])
        found.append({"entity": entity, "name": str(attrs.get("friendly_name") or entity)[:64],
                      "colour": entity.startswith("light.") and bool(modes & {"hs", "xy", "rgb", "rgbw", "rgbww"})})
    return web.json_response(sorted(found, key=lambda f: f["name"].lower()))


async def test_device(request):
    body = await request.json()
    d = _clean_device(body)
    if not linked(d):
        raise web.HTTPBadRequest(text="link this device to a real light before testing it")
    target = address(d)
    seconds = min(max(float(body.get("seconds", 15)), 1), 60)
    pattern = body.get("pattern")
    if pattern not in (None, "blink", "chase"):
        raise web.HTTPBadRequest(text="pattern must be blink or chase")
    if pattern == "chase" and d["kind"] == "ha":
        raise web.HTTPBadRequest(text="a Home Assistant light shows one colour, so it has no segments to check")
    rgb = None
    if body.get("rgb") is not None:
        # A still frame instead of the rainbow, e.g. the light's parts in their colours.
        try:
            rgb = bytes.fromhex(str(body["rgb"]))
        except ValueError:
            raise web.HTTPBadRequest(text="rgb must be hex")
        if len(rgb) != d["segments"] * 3:
            raise web.HTTPBadRequest(text="rgb must have 3 bytes per segment")
    app = request.app
    tests = app[TESTS]
    if (old := tests.pop(target, None)):
        old.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await old
    if body.get("stop"):
        app[OUTPUT].release(target)
        return web.json_response({"ok": True})
    if app[RUNNER].player.playing or app[RUNNER].playlist:  # stopping lets go of every light, which makes a lit test blink
        await app[RUNNER].stop(keep_scene=True)
    settings = dict(reverse=d["reverse"], gradient=d["gradient"], protocol=d["protocol"], brightness=d["brightness"])
    # The pre-show check's patterns: the whole light blinking white, or a white bar going from the
    # first segment to the last (Check segments). A Home Assistant light holds still white instead of
    # blinking, as switching a plug on and off every second isn't good for it.
    if pattern == "blink" and d["kind"] == "ha":
        rgb = b"\xff\xff\xff" * d["segments"]
    if pattern in ("blink", "chase") and rgb is None:
        task = run_frames(app[OUTPUT], target, d["segments"], blink_frame if pattern == "blink" else chase_frame,
                          seconds, **settings)
    elif rgb is None:
        task = run_test_pattern(app[OUTPUT], target, d["segments"], seconds, **settings)
    else:
        task = run_hold(app[OUTPUT], target, rgb, d["segments"], seconds, **settings)
    tests[target] = asyncio.create_task(task)
    return web.json_response({"ok": True, "seconds": seconds})


async def probe_device(request):
    """Find segments: light one segment so the user can say whether it exists. Segment 0 stops."""
    body = await request.json()
    d = _clean_device(body)
    if not linked(d):
        raise web.HTTPBadRequest(text="link this device to a real light first")
    target = address(d)
    try:
        segment = int(body.get("segment", 0))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="segment must be a number")
    if not 0 <= segment <= PROBE_MAX:
        raise web.HTTPBadRequest(text=f"segment must be 0-{PROBE_MAX}")
    app = request.app
    tests = app[TESTS]
    if (old := tests.pop(target, None)):
        old.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await old
    if segment == 0:
        app[OUTPUT].release(target)
        return web.json_response({"ok": True})
    await app[RUNNER].stop(keep_scene=True)
    tests[target] = asyncio.create_task(run_probe(
        app[OUTPUT], target, segment, gradient=d["gradient"], protocol=d["protocol"]))
    return web.json_response({"ok": True, "max": PROBE_MAX})


async def preview_device(request):
    """One frame of the clip being edited, shown on the light until frames stop or `stop` is sent."""
    body = await request.json()
    d = _clean_device(body)
    if not linked(d):
        raise web.HTTPBadRequest(text="link this device to a real light first")
    target = address(d)
    app = request.app
    previews, tests = app[PREVIEWS], app[TESTS]
    live = previews.get(target)
    if body.get("stop"):
        if live and not live.task.done():
            live.stop()
        return web.json_response({"ok": True})
    try:
        rgb = bytes.fromhex(str(body.get("rgb", "")))
    except ValueError:
        raise web.HTTPBadRequest(text="rgb must be hex")
    if len(rgb) != d["segments"] * 3:
        raise web.HTTPBadRequest(text="rgb must have 3 bytes per segment")
    if live is None or live.task.done():
        # Previewing takes the light over from a running show or a test, like Test does.
        await app[RUNNER].stop(keep_scene=True)
        if (old := tests.pop(target, None)):
            old.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await old
        live = previews[target] = LivePreview(app[OUTPUT], target)
        tests[target] = live.task
    live.show(rgb, d["segments"], reverse=d["reverse"], gradient=d["gradient"], protocol=d["protocol"],
              brightness=d["brightness"])
    return web.json_response({"ok": True})


async def stop_tests(app):
    for task in app[TESTS].values():
        task.cancel()
    app[TESTS].clear()


# shows -------------------------------------------------------------------
async def list_shows(request):
    return web.json_response(request.app[STORAGE].list_shows())


async def get_show(request):
    show = request.app[STORAGE].load_show(_show_id(request))
    if show is None:
        raise web.HTTPNotFound()
    return web.json_response(show)


async def create_show(request):
    body = await request.json()
    return web.json_response({"id": request.app[STORAGE].new_show_id(str(body.get("name", "show")))})


def _clean_show_name(body) -> str:
    name = body.get("name") if isinstance(body, dict) else None
    if not isinstance(name, str) or not name.strip():
        raise web.HTTPBadRequest(text="give the show a name")
    return " ".join(name.split())[:80]


def _name_taken(storage, name: str, but: str | None = None) -> bool:
    return any(s["name"].lower() == name.lower() and s["id"] != but for s in storage.list_shows())


async def duplicate_show(request):
    name = _clean_show_name(await request.json())
    if _name_taken(request.app[STORAGE], name):
        raise web.HTTPConflict(text=f"there's already a show called {name}")
    new_id = request.app[STORAGE].duplicate_show(_show_id(request), name)
    if new_id is None:
        raise web.HTTPNotFound()
    request.app[MQTT].refresh()
    return web.json_response({"id": new_id})


async def rename_show(request):
    name = _clean_show_name(await request.json())
    # Automations can start a show by its name, so two shows mustn't share one.
    if _name_taken(request.app[STORAGE], name, but=_show_id(request)):
        raise web.HTTPConflict(text=f"there's already a show called {name}")
    if not request.app[STORAGE].rename_show(_show_id(request), name):
        raise web.HTTPNotFound()
    request.app[MQTT].refresh()
    return web.json_response({"ok": True, "name": name})


MAX_SHOW_PICTURE = 4 * 1024 * 1024


async def put_show_picture(request):
    """A show's own picture (a JPEG; the editor sends it squared and shrunk), shown instead of its
    song's cover art here and on the public page. Hidden details (where it was taken) are taken out."""
    show_id = _show_id(request)
    st = request.app[STORAGE]
    if st.load_show(show_id) is None:
        raise web.HTTPNotFound(text="save the show first")
    data = await request.read()
    if len(data) > MAX_SHOW_PICTURE:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_SHOW_PICTURE, actual_size=len(data))
    clean = imagemeta.clean(data, ".jpg") if data.startswith(b"\xff\xd8") else None
    if clean is None:
        raise web.HTTPBadRequest(text="send the picture as a JPEG")
    st.save_show_picture(show_id, clean)
    return web.json_response({"picture": st.show_picture_version(show_id)})


async def delete_show_picture(request):
    request.app[STORAGE].delete_show_picture(_show_id(request))
    return web.json_response({"picture": 0})


async def get_show_picture(request):
    p = request.app[STORAGE].show_picture(_show_id(request))
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "private, max-age=300"})


async def mark_show(request):
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("in_progress"), bool):
        raise web.HTTPBadRequest(text="say whether the show is in progress")
    _not_archived(request, _show_id(request))
    if not request.app[STORAGE].mark_show(_show_id(request), body["in_progress"]):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True, "in_progress": body["in_progress"]})


def _not_archived(request, show_id: str):
    # A second browser still editing a show that's been archived mustn't bring a copy back to life.
    if archive.show_exists(request.app[STORAGE], show_id, archived=True):
        raise web.HTTPConflict(text="that show has been archived; restore it under Library → Shows to edit it")


# Light roles (static/js/roles.js): which part of the music each light reacts to when Generate makes a
# show, as you've picked them for your house. Kept in the settings, {light or part id: role}.
LIGHT_ROLES = ("kick", "snare", "crash", "bass", "vocals", "melody", "background", "none")


def _clean_light_roles(body) -> dict:
    if not isinstance(body, dict) or len(body) > 2000 or not all(
            isinstance(k, str) and 0 < len(k) <= 200 and v in LIGHT_ROLES for k, v in body.items()):
        raise web.HTTPBadRequest(text=f"expected {{light id: role}}, each role one of {', '.join(LIGHT_ROLES)}")
    return body


async def get_light_roles(request):
    roles = request.app[STORAGE].load_settings().get("light_roles")
    return web.json_response(roles if isinstance(roles, dict) else {})


async def put_light_roles(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    roles = _clean_light_roles(body)
    st = request.app[STORAGE]
    settings = st.load_settings()
    settings["light_roles"] = roles
    st.save_settings(settings)
    return web.json_response({"ok": True})


async def put_show(request):
    _not_archived(request, _show_id(request))
    show = await request.json()
    if not isinstance(show, dict) or not isinstance(show.get("tracks", []), list):
        raise web.HTTPBadRequest(text="bad show")
    # In progress or finished is changed only by its own route, so an editor that loaded the show
    # earlier can't undo a mark made since. A new show keeps the mark it's first saved with.
    st = request.app[STORAGE]
    before = st.load_show(_show_id(request))
    mark = before.get("in_progress") is True if before is not None else show.get("in_progress") is True
    show.pop("in_progress", None)
    if mark:
        show["in_progress"] = True
    st.save_show(_show_id(request), show)
    if before is None or before.get("name") != show.get("name"):
        request.app[HUB].refresh()  # Home Assistant's show list (MQTT follows once it's baked)
    return web.json_response({"ok": True})


_BAKE_KEY = re.compile(r"[A-Za-z0-9_-]{1,64}")


def _clean_bake_key(request) -> str | None:
    """?key= on a bake upload: what the editor baked it for (see Storage.save_baked)."""
    key = request.query.get("key")
    if key is None or key == "":
        return None
    if not _BAKE_KEY.fullmatch(key):
        raise web.HTTPBadRequest(text="bad bake key")
    return key


async def get_baked_key(request):
    # It reads the whole bake to check it's the same one, so off the loop that streams the lights.
    key = await asyncio.to_thread(request.app[STORAGE].baked_key, _show_id(request), __version__)
    return web.json_response({"key": key})


def _unpacked(request, blob: bytes) -> bytes:
    """A show's frames arrive gzipped (?gz=1) from editors that can: mostly the same colours frame
    after frame, they shrink many times over, so Play starts sooner. Older pages send them as they are."""
    if request.query.get("gz") != "1":
        return blob
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        out = d.decompress(blob, MAX_UPLOAD)
    except zlib.error:
        raise web.HTTPBadRequest(text="the show's frames arrived damaged; try again")
    if d.unconsumed_tail:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=MAX_UPLOAD + 1)
    return out


async def put_baked(request):
    show_id = _show_id(request)
    _not_archived(request, show_id)
    key = _clean_bake_key(request)
    blob = _unpacked(request, await request.read())
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_baked(show_id, blob, key, __version__)
    request.app[MQTT].refresh()
    return web.json_response({"ok": True, "bytes": len(blob)})


async def delete_show(request):
    """Deletes a show (or, with ?archived=1, an archived one) for good, keeping a copy of the config
    folder first, and takes it out of every playlist."""
    show_id = _show_id(request)
    st = request.app[STORAGE]
    archived = request.query.get("archived") == "1"
    if not archive.show_exists(st, show_id, archived):
        raise web.HTTPNotFound(text="that show isn't there")
    try:
        # The copy zips the whole config folder, so it's made off the event loop that streams the lights.
        await asyncio.to_thread(backup.keep_copy, st.config_dir, __version__, "delete")
        archive.delete_show(st, show_id, archived=archived)
    except archive.ArchiveError as e:
        raise web.HTTPNotFound(text=str(e))
    request.app[MQTT].refresh()
    return web.json_response({"ok": True})


async def list_archived_shows(request):
    return web.json_response(archive.list_archived_shows(request.app[STORAGE]))


async def archive_show(request):
    try:
        archive.archive_show(request.app[STORAGE], _show_id(request))
    except archive.ArchiveError as e:
        raise web.HTTPNotFound(text=str(e))
    request.app[MQTT].refresh()
    return web.json_response({"ok": True})


async def restore_show(request):
    try:
        restored = archive.restore_show(request.app[STORAGE], _show_id(request))
    except archive.ArchiveError as e:
        raise web.HTTPNotFound(text=str(e))
    request.app[MQTT].refresh()
    return web.json_response(restored)


def _song_body(body) -> tuple[str, object]:
    if not isinstance(body, dict) or not isinstance(body.get("path"), str) or not body["path"]:
        raise web.HTTPBadRequest(text="expected {path}")
    return body["path"], body.get("replacement")


async def list_archived_songs(request):
    st = request.app[STORAGE]
    return web.json_response(await asyncio.to_thread(archive.list_archived_songs, st))


async def song_users(request):
    path = request.query.get("path", "")
    st = request.app[STORAGE]
    return web.json_response({"shows": archive.users_of(st, path), "own": archive.own_song(st, path)})


async def archive_song(request):
    path, replacement = _song_body(await request.json())
    try:
        return web.json_response(archive.archive_song(request.app[STORAGE], path, replacement))
    except archive.ArchiveError as e:
        raise web.HTTPBadRequest(text=str(e))


async def rename_song(request):
    body = await request.json()
    path, _ = _song_body(body)
    if not isinstance(body.get("name"), str):
        raise web.HTTPBadRequest(text="give the song a name")
    try:
        out = archive.rename_song(request.app[STORAGE], path, body["name"], sample=body.get("sample") is True)
    except archive.ArchiveError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[MQTT].refresh()
    return web.json_response(out)


async def duplicate_song(request):
    body = await request.json()
    path, _ = _song_body(body)
    try:
        out = archive.copy_song(request.app[STORAGE], path, sample=body.get("sample") is True)
    except archive.ArchiveError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[MQTT].refresh()
    return web.json_response(out)


async def restore_song(request):
    path, _ = _song_body(await request.json())
    try:
        return web.json_response(archive.restore_song(request.app[STORAGE], path))
    except archive.ArchiveError as e:
        raise web.HTTPBadRequest(text=str(e))


async def delete_song(request):
    body = await request.json()
    path, replacement = _song_body(body)
    st = request.app[STORAGE]
    archived = body.get("archived") is True
    try:
        if not archive.song_deletable(st, path, archived):
            raise archive.ArchiveError("only songs in HA-liday Show's own folder can be deleted")
        archive.check_replacement(st, path, replacement)
        await asyncio.to_thread(backup.keep_copy, st.config_dir, __version__, "delete")
        return web.json_response(archive.delete_song(st, path, archived=archived, replacement=replacement))
    except archive.ArchiveError as e:
        raise web.HTTPBadRequest(text=str(e))


# audio -------------------------------------------------------------------
async def list_audio(request):
    return web.json_response(request.app[STORAGE].list_audio())


async def list_songs(request):
    # The media folder can be big (it's all of Home Assistant's media), so walk it off the event loop,
    # which also streams the lights.
    st = request.app[STORAGE]

    def songs():
        out = st.list_songs()
        for s in out["songs"]:
            s["own"] = archive.own_song(st, s["path"])  # only these can be archived or deleted here
        return out
    return web.json_response(await asyncio.to_thread(songs))


async def get_audio(request):
    p = request.app[STORAGE].audio_path(request.query.get("source", ""),
                                        request.query.get("path", ""))
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p)


async def upload_audio(request):
    reader = await request.multipart()
    field = await reader.next()
    if field is None or not field.filename:
        raise web.HTTPBadRequest(text="no file")
    # ?kind=sample: a short sound for the Music editor's layers, into the Samples folder.
    dest = request.app[STORAGE].upload_path(field.filename, sample=request.query.get("kind") == "sample")
    if dest is None:
        raise web.HTTPBadRequest(text="not an audio file")
    tmp = dest.with_name(dest.name + ".part")
    size = 0
    with tmp.open("wb") as f:
        while chunk := await field.read_chunk(1 << 16):
            size += len(chunk)
            if size > MAX_UPLOAD:
                f.close()
                tmp.unlink()
                raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=size)
            f.write(chunk)
    os.replace(tmp, dest)
    storage = request.app[STORAGE]
    await _carry_cover(request, dest)
    return web.json_response({"source": "media", "path": str(dest.relative_to(storage.media_dir))})


# Split vocals (static/js/stems.js): the AI model and the runtime that runs it in the browser. HA-liday
# Show downloads each once from where it's published, checks its size and SHA-256, and keeps it in the
# temporary folder (never in backups; gone after a restart), then hands it to the browser from there,
# so the browser needs no other site. The browser takes the big model in pieces (Range requests): one
# long download through Home Assistant's ingress can be cut off part way. HALIDAY_SHOW_STEMS_FROM points
# at a mirror of them instead, for an install with no internet.
_ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/"
_ORT_NOTES = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/"  # transformers.js 4.3.1's
_NOTES = "https://github.com/gdeboos/ha-liday-show/releases/download/models-notes-1/notes-"
STEM_FILES = {
    "model.onnx": ("https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx",
                   "application/octet-stream", 66762490, "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111"),
    # The drums and bass parts: KUIELab's MDX-Net models (MIT licence), as UVR publishes them.
    "drums.onnx": ("https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/kuielab_a_drums.onnx",
                   "application/octet-stream", 29703204, "40f586b7091934dd6f5563f0cba8f14bad57ce88440da1098bf388ea716c2901"),
    "bass.onnx": ("https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/kuielab_a_bass.onnx",
                  "application/octet-stream", 29703204, "0c3e77b9963185b1ea6bb46a4b8924137d9370fc1ccdefec7b1b416ef550dcaa"),
    # What can be heard in a song (static/js/sounds.js): Google's YAMNet (Apache 2.0), as converted to ONNX
    # with its sound-wave input by Katsuya Iida (MIT), at a fixed commit.
    "yamnet.onnx": ("https://media.githubusercontent.com/media/kaiidams/TransferLearningAudio/"
                    "3f2608d414305099f2be8482911469c0d10af276/assets/yamnet.onnx",
                    "application/octet-stream", 16093547, "6b5aa2a0398bf99bad26f7fad98be8a6e0c074df4d6c51265500a2d787001457"),
    # Line up with the singing (static/js/align.js): an English wav2vec 2.0 speech model (MIT licence), made
    # smaller and published in this repo by .github/workflows/models.yml.
    "align.onnx": ("https://github.com/gdeboos/ha-liday-show/releases/download/models-align-1/align-en-int8.onnx",
                   "application/octet-stream", 95288193, "e57bd381bb19a790e6a998142d7ab3e1b1362734381c06e1e1fb628089d1240d"),
    # Section notes on your own device (static/js/notesworker.js): Qwen2.5-1.5B-Instruct (Apache 2.0) as
    # 4-bit ONNX, published in this repo by .github/workflows/models.yml, run by transformers.js (Apache 2.0)
    # on its own copy of the ONNX runtime. Only downloaded when asked for by name (see NAMED_ONLY).
    **{f"notes-{n}": (_NOTES + n, kind, size, sha) for n, kind, size, sha in (
        ("model.onnx", "application/octet-stream", 1221878940, "19dec9f63488016185ba997d5e4492b5ac5b4f7ef1abb45243a91de958838dcd"),
        ("tokenizer.json", "application/json", 7031673, "a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf"),
        ("tokenizer_config.json", "application/json", 7849, "6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430"),
        ("config.json", "application/json", 809, "215eb99c4955b0c42ea9f6e0980d922c228950c5dbc09bde6dc451fbba4d21f3"),
        ("generation_config.json", "application/json", 242, "f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3"),
    )},
    "transformers.min.js": ("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js",
                            "text/javascript", 586230, "8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743"),
    "ort-wasm-simd-threaded.asyncify.mjs": (_ORT_NOTES + "ort-wasm-simd-threaded.asyncify.mjs", "text/javascript", 53057,
                                            "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611"),
    "ort-wasm-simd-threaded.asyncify.wasm": (_ORT_NOTES + "ort-wasm-simd-threaded.asyncify.wasm", "application/wasm", 26861777,
                                             "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082"),
    "ort.webgpu.min.mjs": (_ORT + "ort.webgpu.min.mjs", "text/javascript", 333468,
                           "e1a0817ac08d5a6ade7f229754c2aecd444bff0bd22c259ca148a04b9f9e9f65"),
    "ort-wasm-simd-threaded.jsep.mjs": (_ORT + "ort-wasm-simd-threaded.jsep.mjs", "text/javascript", 46839,
                                        "2fb14505d39926e4c544de8c57fe59a2f2bc74caba6f71890be9afecc5046758"),
    "ort-wasm-simd-threaded.jsep.wasm": (_ORT + "ort-wasm-simd-threaded.jsep.wasm", "application/wasm", 21663894,
                                         "185b0861a6cd6cbdfb057289338090436483cc59e10a7bc83bd167b15531a51b"),
}


class StemsUnavailable(Exception):
    pass


async def _stream_from(url: str):
    try:
        # No overall limit (the section notes model is over a gigabyte): a download that stalls for a minute stops.
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=60),
                                         trust_env=True) as s:
            async with s.get(url) as r:
                if r.status != 200:
                    raise StemsUnavailable(f"HTTP {r.status}")
                async for chunk in r.content.iter_chunked(1 << 16):
                    yield chunk
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        raise StemsUnavailable(str(e) or type(e).__name__) from e


class StemFiles:
    """Split vocals' files, each downloaded once (on first ask) into `folder` and checked."""

    def __init__(self, folder: Path):
        # Started afresh each time HA-liday Show starts: only files this run downloaded and checked are
        # handed out, whatever was left in the temporary folder before.
        shutil.rmtree(folder, ignore_errors=True)
        self.folder = folder
        self.tasks: dict[str, asyncio.Task] = {}
        self.got: dict[str, int] = {}
        self.errors: dict[str, str] = {}

    def path(self, name: str) -> Path | None:
        p = self.folder / name
        return p if p.is_file() else None

    def start(self, name: str, again: bool = True):
        """Downloads it if it isn't here or on its way; one that failed only if `again`."""
        if self.path(name) or (name in self.tasks and not self.tasks[name].done()) or (name in self.errors and not again):
            return
        self.errors.pop(name, None)
        self.tasks[name] = asyncio.get_running_loop().create_task(self._fetch(name))

    async def ready(self, name: str) -> Path:
        """The file, downloading it first if need be; StemsUnavailable if it can't be had."""
        self.start(name)
        if name in self.tasks:
            await asyncio.shield(self.tasks[name])
        p = self.path(name)
        if p is None:
            raise StemsUnavailable(self.errors.get(name, "it couldn't be downloaded"))
        return p

    def status(self, names=None, retry: bool = False) -> dict:
        """How far along each file (of `names`, else all) is, starting any that aren't there yet (and with
        `retry`, any that failed before)."""
        out = {}
        for name, (_, _, size, _) in STEM_FILES.items():
            if (names is not None and name not in names) or (names is None and name in NAMED_ONLY):
                continue
            self.start(name, retry)
            done = self.path(name) is not None
            out[name] = {"size": size, "got": size if done else self.got.get(name, 0), "ready": done,
                         **({"error": self.errors[name]} if name in self.errors and not done else {})}
        return out

    async def _fetch(self, name: str):
        url, _, size, sha = STEM_FILES[name]
        mirror = os.environ.get("HALIDAY_SHOW_STEMS_FROM", "").strip()
        if mirror:
            url = mirror.rstrip("/") + "/" + name
        part = self.folder / f".{name}.part"
        digest, got, problem = hashlib.sha256(), 0, None
        self.got[name] = 0
        try:
            self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            with part.open("wb") as f:
                async for chunk in _stream_from(url):
                    got += len(chunk)
                    if got > size:
                        problem = "bigger than it should be"
                        break
                    digest.update(chunk)
                    f.write(chunk)
                    self.got[name] = got
        except StemsUnavailable as e:
            problem = f"couldn't download it ({e})"
        except OSError as e:
            problem = f"couldn't keep it ({e.strerror or e})"
        except Exception as e:  # never left looking as if it's still on its way
            problem = f"something went wrong ({e})"
        if not problem and (got != size or digest.hexdigest() != sha):
            problem = "it wasn't the file it should be" if got == size else "its download was cut off"
        if problem:
            log.warning("Split vocals: %s from %s: %s", name, url, problem)
            self.errors[name] = problem
            part.unlink(missing_ok=True)
            return
        os.replace(part, self.folder / name)
        log.info("Split vocals: %s downloaded and checked", name)


STEMS = web.AppKey("stems", StemFiles)
# Big downloads that only start when asked for by name: never part of "all of them".
NAMED_ONLY = {n for n in STEM_FILES if n.startswith("notes-")} | {"transformers.min.js", "ort-wasm-simd-threaded.asyncify.mjs",
                                                                  "ort-wasm-simd-threaded.asyncify.wasm"}


async def post_stems_prepare(request):
    """Gets Split vocals' files ready (?names=a,b, else all): how far along each is (the browser asks
    again until all are)."""
    names = request.query.get("names")
    return web.json_response(request.app[STEMS].status(set(names.split(",")) if names else None,
                                                       retry=request.query.get("retry") == "1"))


async def get_stem_file(request):
    name = request.match_info["name"]
    if name not in STEM_FILES:
        raise web.HTTPNotFound(text="not one of Split vocals' files")
    _, kind, _, _ = STEM_FILES[name]
    try:
        path = await request.app[STEMS].ready(name)
    except StemsUnavailable as e:
        raise web.HTTPBadGateway(text=f"Couldn't download the AI files for Split vocals: {e}. Is HA-liday Show "
                                      "online? Without internet, see HALIDAY_SHOW_STEMS_FROM in the guide")
    # A Range (part of the file) is answered with just that part: the browser takes the model in pieces.
    return web.FileResponse(path, headers={"Content-Type": kind, "Cache-Control": "public, max-age=31536000, immutable"})


async def _carry_cover(request, dest: Path):
    """A WAV the Music editor made from a song (?cover_source=&cover_path=) keeps that song's cover,
    and its colours (a song file made again keeps the colours it has)."""
    q = request.query
    if dest.suffix.lower() != ".wav" or not q.get("cover_path"):
        return
    storage = request.app[STORAGE]
    source, path = q.get("cover_source", ""), q.get("cover_path", "")
    src = storage.audio_path(source, path)
    if src is None:
        return
    await asyncio.to_thread(lambda: songtags.add_cover(dest, songtags.cached_cover(src)))
    if q.get("kind") == "sample":
        return
    rel = dest.relative_to(storage.media_dir).as_posix()
    palette = storage.load_song_palette(source, path)
    if palette and not storage.load_song_palette("media", rel):
        storage.save_song_palette("media", rel, palette)


async def get_audio_cover(request):
    """A song's cover art, from its own tags (songtags.py)."""
    p = request.app[STORAGE].audio_path(request.query.get("source", ""), request.query.get("path", ""))
    pic = await asyncio.to_thread(songtags.cached_cover, p) if p is not None else None
    if pic is None:
        raise web.HTTPNotFound(text="no cover art in that song")
    return web.Response(body=pic[1], content_type=pic[0], headers={"Cache-Control": "private, max-age=300"})


# Big uploads in pieces: Home Assistant's ingress proxy refuses any request over 16 MB, so the editor
# sends a big song, or a long show's baked frames, in parts. Each part says where it goes (offset), so
# a lost or repeated part is caught, and one upload is written by one request at a time. Nothing
# appears until the last part arrives.
MAX_PART = 12 * 1024 * 1024
MAX_OPEN_UPLOADS = 8  # unfinished uploads at once, so they can't fill the disk
PART_IDLE_S = 120  # an unfinished upload nothing has been added to for this long has stopped
_UPLOAD_ID = re.compile(r"[0-9a-f]{16,64}")
UPLOADING = web.AppKey("uploading", set)


async def _receive_part(request, folder: Path) -> tuple[Path, int, bool]:
    """Appends this part to its upload in `folder`: (the file so far, its size, whether it's whole)."""
    q = request.query
    upload_id = q.get("upload", "")
    if not _UPLOAD_ID.fullmatch(upload_id):
        raise web.HTTPBadRequest(text="bad upload id")
    try:
        offset = int(q.get("offset", ""))
    except ValueError:
        raise web.HTTPBadRequest(text="offset must be a number")
    busy = request.app[UPLOADING]
    if upload_id in busy:
        raise web.HTTPConflict(text="that upload is already sending a part; start it again")
    folder.mkdir(parents=True, exist_ok=True)
    part = folder / f".upload-{upload_id}.part"
    busy.add(upload_id)
    try:
        if offset == 0:
            _clear_old_parts(folder)
            if len(list(folder.glob(".upload-*.part"))) >= MAX_OPEN_UPLOADS:
                # Full: let go of any that have stopped arriving (a save that failed part-way, say).
                # One still going grows every few seconds.
                _clear_old_parts(folder, PART_IDLE_S)
            if len(list(folder.glob(".upload-*.part"))) >= MAX_OPEN_UPLOADS:
                raise web.HTTPServiceUnavailable(text="too many uploads at once; try again in a minute")
            part.write_bytes(b"")
        elif not part.exists() or part.stat().st_size != offset:
            raise web.HTTPConflict(text="that part doesn't follow on from the last one; start the upload again")
        size = offset
        with part.open("ab") as f:
            got = 0
            while chunk := await request.content.read(1 << 16):
                got += len(chunk)
                size += len(chunk)
                if got > MAX_PART or size > MAX_UPLOAD:
                    f.close()
                    part.unlink(missing_ok=True)
                    raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=size)
                f.write(chunk)
    finally:
        busy.discard(upload_id)
    return part, size, q.get("done") == "1"


async def upload_audio_part(request):
    storage = request.app[STORAGE]
    part, size, done = await _receive_part(request, storage.upload_dir)
    if not done:
        return web.json_response({"received": size})
    dest = storage.upload_path(request.query.get("name", ""), sample=request.query.get("kind") == "sample")
    if dest is None:
        part.unlink(missing_ok=True)
        raise web.HTTPBadRequest(text="not an audio file")
    os.replace(part, dest)
    await _carry_cover(request, dest)
    return web.json_response({"source": "media", "path": str(dest.relative_to(storage.media_dir))})


async def get_song_parts(request):
    """A song's parts (stems): {part: its path}, each playable at /api/audio/file like any song."""
    q = request.query
    return web.json_response(request.app[STORAGE].song_parts(q.get("source", ""), q.get("path", "")))


async def put_song_part(request):
    """One of a song's parts (?part=vocals, drums, bass, rest or music), a WAV sent in pieces like a big
    song (_receive_part). The song's parts of an older file of it go."""
    storage, q = request.app[STORAGE], request.query
    name = q.get("part", "")
    if name not in PART_NAMES or storage.audio_path(q.get("source", ""), q.get("path", "")) is None:
        raise web.HTTPNotFound()
    part, size, done = await _receive_part(request, storage.upload_dir)
    if not done:
        return web.json_response({"received": size})
    with part.open("rb") as f:
        head = f.read(12)
    if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        part.unlink(missing_ok=True)
        raise web.HTTPBadRequest(text="a part is a WAV file")
    path = storage.save_part(q["source"], q["path"], name, part)
    if path is None:
        part.unlink(missing_ok=True)
        raise web.HTTPNotFound()
    return web.json_response({"source": "media", "path": path})


async def put_baked_part(request):
    """A show's baked frames in parts, for long shows (see _receive_part)."""
    show_id = _show_id(request)
    _not_archived(request, show_id)
    storage = request.app[STORAGE]
    key = _clean_bake_key(request)
    part, size, done = await _receive_part(request, storage.shows_dir)
    if not done:
        return web.json_response({"received": size})
    blob = part.read_bytes()
    part.unlink(missing_ok=True)
    blob = _unpacked(request, blob)
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    storage.save_baked(show_id, blob, key, __version__)
    request.app[MQTT].refresh()
    return web.json_response({"ok": True, "bytes": len(blob)})


def _clear_old_parts(folder: Path, older_than_s: float = 3600):
    """Pieces of uploads that never finished (the page closed part-way), after an hour."""
    for p in folder.glob(".upload-*.part"):
        try:
            if time.time() - p.stat().st_mtime > older_than_s:
                p.unlink()
        except OSError:
            pass


MAX_MARKS = 50000
MAX_SECTIONS = 500
MAX_NOTES = 300  # a section's notes, for the AI
MAX_SONG_MARKS = 200  # named moments you flag in a song (the Music editor's marks)


def _times(v) -> list[float] | None:
    if not isinstance(v, list) or len(v) > MAX_MARKS:
        return None
    out = []
    for t in v:
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0:
            return None
        out.append(round(float(t), 4))
    return out


def _clean_marks(marks) -> list[dict] | None:
    """Marks you put on a song: [{t, label, color}], sorted by time."""
    if not isinstance(marks, list) or len(marks) > MAX_SONG_MARKS:
        return None
    out = []
    for m in marks:
        if not isinstance(m, dict):
            return None
        t = _times([m.get("t")])
        label, color = m.get("label", ""), m.get("color")
        if t is None or not isinstance(label, str):
            return None
        item = {"t": t[0], "label": label.strip()[:40]}
        if color is not None:
            if not isinstance(color, str) or not _HEX.match(color):
                return None
            item["color"] = color.lower()
        out.append(item)
    return sorted(out, key=lambda m: m["t"])


_KEY = re.compile(r"^[A-G][♯#♭b]? (major|minor)$")  # a song's key, as analysis.js names it


def _clean_song_info(body) -> dict | None:
    """Detect's results for a song: {tempo, beats, bars, sections: [{start, end, label, energy}]}, and
    the marks you've put on it ({marks: [{t, label, color}]}) when they're sent."""
    if not isinstance(body, dict):
        return None
    tempo = body.get("tempo")
    if tempo is not None and (isinstance(tempo, bool) or not isinstance(tempo, (int, float))
                              or not math.isfinite(tempo) or not 0 < tempo < 1000):
        return None
    beats, bars = _times(body.get("beats", [])), _times(body.get("bars", []))
    sections = body.get("sections", [])
    if beats is None or bars is None or not isinstance(sections, list) or len(sections) > MAX_SECTIONS:
        return None
    clean = []
    for sec in sections:
        if not isinstance(sec, dict):
            return None
        span = _times([sec.get("start"), sec.get("end")])
        energy = sec.get("energy", 0)
        if span is None or isinstance(energy, bool) or not isinstance(energy, (int, float)) or not math.isfinite(energy):
            return None
        item = {"start": span[0], "end": span[1], "label": str(sec.get("label", ""))[:40],
                "energy": round(float(energy), 4)}
        notes = sec.get("notes")
        if notes is not None:
            if not isinstance(notes, str):
                return None
            if notes.strip():
                item["notes"] = notes.strip()[:MAX_NOTES]
                if sec.get("autoNotes") is True:  # written for you, so describing again may replace them
                    item["autoNotes"] = True
        if sec.get("named") is True:  # a name you typed, which describing never changes
            item["named"] = True
        color = sec.get("color")
        if color is not None:
            if not isinstance(color, str) or not _HEX.match(color):
                return None
            item["color"] = color.lower()
        clean.append(item)
    out = {"tempo": tempo, "beats": beats, "bars": bars, "sections": clean}
    key = body.get("key")
    if key is not None:
        if not isinstance(key, str) or not _KEY.match(key):
            return None
        out["key"] = key
    if "marks" in body:
        marks = _clean_marks(body["marks"])
        if marks is None:
            return None
        out["marks"] = marks
    return out


MAX_PALETTE_COLOURS = 12


def _clean_song_palette(body) -> dict | None:
    """A song's colours: {name, colors, from: "cover" | "ai"}. Null clears them; anything else
    that doesn't fit is refused (raises)."""
    if body is None:
        return None
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected {name, colors, from} or null")
    name, colors, source = body.get("name"), body.get("colors"), body.get("from")
    if not isinstance(name, str) or not name.strip() or not isinstance(colors, list) \
            or not 1 <= len(colors) <= MAX_PALETTE_COLOURS \
            or not all(isinstance(c, str) and _HEX.match(c) for c in colors) or source not in ("cover", "ai"):
        raise web.HTTPBadRequest(text="expected {name, colors: up to 12 #rrggbb, from: cover or ai}")
    return {"name": " ".join(name.split())[:80], "colors": [c.lower() for c in colors], "from": source}


async def get_song_palette(request):
    q = request.query
    return web.json_response(request.app[STORAGE].load_song_palette(q.get("source", ""), q.get("path", "")))


async def put_song_palette(request):
    palette = _clean_song_palette(await request.json())
    q = request.query
    if not request.app[STORAGE].save_song_palette(q.get("source", ""), q.get("path", ""), palette):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# A song's lyrics and singer (storage.load_song_extra), for Singing faces: kept with the song so every
# show on it uses them.
MAX_LYRIC_TEXT = 20000
MAX_LYRIC_LINES = 500
MAX_LYRIC_WORDS = 100  # in one line
MAX_VOICE_STEPS = 20 * 60 * 30  # 30 minutes at 20 a second


def _num(v, lo=0.0, hi=36000.0) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError
    return round(min(max(float(v), lo), hi), 3)


def _clean_song_lyrics(body) -> dict | None:
    """{text, lines: [{start, end, words?: [{start, end}]}]} (one per non-blank line of the text), or null
    to clear."""
    if body is None:
        return None
    try:
        text, lines = body["text"], body["lines"]
        if not isinstance(text, str) or len(text) > MAX_LYRIC_TEXT or not isinstance(lines, list) \
                or len(lines) > MAX_LYRIC_LINES:
            raise ValueError
        if len(lines) != sum(1 for line in text.splitlines() if line.strip()):
            raise ValueError  # one per line of the words
        clean = []
        for line in lines:
            a = _num(line["start"])
            out = {"start": a, "end": max(a, _num(line["end"]))}
            if line.get("words") is not None:  # each word's own times, once moved on the waveform
                words = line["words"]
                if not isinstance(words, list) or not 0 < len(words) <= MAX_LYRIC_WORDS:
                    raise ValueError
                out["words"] = [{"start": (w0 := _num(w["start"])), "end": max(w0, _num(w["end"]))} for w in words]
            clean.append(out)
    except (ValueError, KeyError, TypeError):
        raise web.HTTPBadRequest(text="expected {text, lines: [{start, end}]} or null")
    return {"text": text, "lines": clean}


def _clean_song_voice(body) -> dict | None:
    """The singer's level as the editor measured it: {fps, values (0-100), shapes ("aoem"), from}."""
    if body is None:
        return None
    try:
        fps, values, shapes, src = body["fps"], body["values"], body.get("shapes", ""), body.get("from", "song")
        if isinstance(fps, bool) or not (isinstance(fps, int) and 1 <= fps <= 60) or not isinstance(values, list) or len(values) > MAX_VOICE_STEPS \
                or not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100 for v in values) \
                or not isinstance(shapes, str) or len(shapes) not in (0, len(values)) or set(shapes) - set("aoem") \
                or src not in ("vocals", "song"):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise web.HTTPBadRequest(text="expected {fps, values, shapes, from}")
    return {"fps": fps, "values": values, "shapes": shapes, "from": src}


def _song_extra(key, clean):
    async def get(request):
        q = request.query
        return web.json_response(request.app[STORAGE].load_song_extra(q.get("source", ""), q.get("path", ""), key))

    async def put(request):
        try:
            body = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text="expected JSON")
        value = clean(body)
        q = request.query
        if not request.app[STORAGE].save_song_extra(q.get("source", ""), q.get("path", ""), key, value):
            raise web.HTTPNotFound()
        return web.json_response({"ok": True})
    return get, put


MAX_DRUM_HITS = 20000  # of each kind: a 10-minute song at 32 a second


def _clean_song_drums(body) -> dict | None:
    """When each drum lands in the song (static/js/drumhits.js): {kick, snare, hat, crash}, seconds each."""
    if body is None:
        return None
    try:
        if not isinstance(body, dict) or set(body) - {"kick", "snare", "hat", "crash"}:
            raise ValueError
        out = {}
        for kind in ("kick", "snare", "hat", "crash"):
            hits = body.get(kind, [])
            if not isinstance(hits, list) or len(hits) > MAX_DRUM_HITS:
                raise ValueError
            out[kind] = sorted(_num(t) for t in hits)
    except (ValueError, TypeError):
        raise web.HTTPBadRequest(text="expected {kick, snare, hat, crash}: lists of seconds")
    return out


MAX_SOUND_STEPS = 7200  # half-second steps: an hour
SOUND_KEYS = {"sleighbells", "bells", "mallets", "choir", "brass", "strings", "piano", "organ", "guitar", "synth",
              "woodwind", "harp", "whistling", "clapping", "christmas", "happy", "sad", "tender", "exciting", "angry",
              "scary"}  # static/js/sounds.js SOUNDS


def _clean_song_sounds(body) -> dict | None:
    """What can be heard in the song (static/js/sounds.js): {step, sounds: {key: [0-100 each step]}}."""
    if body is None:
        return None
    try:
        step, sounds = body["step"], body["sounds"]
        if isinstance(step, bool) or not isinstance(step, (int, float)) or not 0.1 <= step <= 5 \
                or not isinstance(sounds, dict) or set(sounds) - SOUND_KEYS:
            raise ValueError
        for values in sounds.values():
            if not isinstance(values, list) or len(values) > MAX_SOUND_STEPS \
                    or not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100 for v in values):
                raise ValueError
    except (ValueError, KeyError, TypeError):
        raise web.HTTPBadRequest(text="expected {step, sounds: {sound: [0-100…]}}")
    # Kept even with nothing heard, so the song isn't listened to again.
    return {"step": step, "sounds": {k: v for k, v in sounds.items()}}


get_song_lyrics, put_song_lyrics = _song_extra("lyrics", _clean_song_lyrics)
get_song_sounds, put_song_sounds = _song_extra("sounds", _clean_song_sounds)
get_song_drums, put_song_drums = _song_extra("drums", _clean_song_drums)
get_song_voice, put_song_voice = _song_extra("voice", _clean_song_voice)


# song drafts --------------------------------------------------------------------
MAX_PIECES = 500


def _song_ref(v) -> dict | None:
    if not isinstance(v, dict):
        return None
    source, path = v.get("source"), v.get("path")
    if not isinstance(source, str) or not isinstance(path, str) or not source or not path \
            or len(source) > 40 or len(path) > 1000:
        return None
    return {"source": source, "path": path}


def _seconds(v, top: float) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= top:
        return None
    return round(float(v), 4)


MAX_LAYERS, MAX_CLIPS = 4, 100


def _gain(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not -60 <= v <= 24:
        return None
    return round(float(v), 2)


MAX_EQ_CHANGES = 100
EQ_BANDS = ("bass", "mid", "treble")


def _eq_band(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not -24 <= v <= 6:
        return None
    return round(float(v), 1)


def _eq_filter(v) -> float | None:
    """The DJ filter: -100 (muffled) to 100 (thin), 0 off."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not -100 <= v <= 100:
        return None
    return round(float(v), 1)


def _clean_eq(eq) -> dict | None:
    """Bass, mid and treble faders (dB, -24 meaning off) and the DJ filter (optional) for the song or a
    layer, with changes at points in the song: {bass, mid, treble, filter, changes: [{anchor: {song, t},
    bass, mid, treble, filter, glide}]}. A filter of 0 isn't saved, so drafts without one look as before."""
    if not isinstance(eq, dict):
        return None
    out = {b: _eq_band(eq.get(b, 0)) for b in EQ_BANDS}
    changes, flt = eq.get("changes", []), _eq_filter(eq.get("filter", 0))
    if None in out.values() or flt is None or not isinstance(changes, list) or len(changes) > MAX_EQ_CHANGES:
        return None
    if flt:
        out["filter"] = flt
    out["changes"] = []
    for c in changes:
        if not isinstance(c, dict) or not isinstance(c.get("anchor"), dict):
            return None
        bands = {b: _eq_band(c.get(b, 0)) for b in EQ_BANDS}
        song, t, glide = _song_ref(c["anchor"].get("song")), _seconds(c["anchor"].get("t"), 86400), _seconds(c.get("glide", 1), 30)
        cf = _eq_filter(c.get("filter", 0))
        if None in (*bands.values(), song, t, glide, cf):
            return None
        out["changes"].append({"anchor": {"song": song, "t": t}, **bands, **({"filter": cf} if cf else {}), "glide": glide})
    return out


SONG_PARTS = ("vocals", "drums", "bass", "rest")
MAX_PART_CHANGES = 200


def _clean_song_parts(parts) -> dict | None:
    """The song's own parts' levels in a draft (static/js/songparts.js): {gain: {part: dB -24 to 6},
    muted: [part], changes: [{part, gain (dB -60 to 6), from: {song, t}, to: {song, t}}]}."""
    if not isinstance(parts, dict):
        return None
    gain, muted, changes = parts.get("gain", {}), parts.get("muted", []), parts.get("changes", [])
    if not isinstance(gain, dict) or set(gain) - set(SONG_PARTS) or not isinstance(muted, list) or set(muted) - set(SONG_PARTS) \
            or not isinstance(changes, list) or len(changes) > MAX_PART_CHANGES:
        return None
    out = {"gain": {}, "muted": sorted(set(muted)), "changes": []}
    for part, g in gain.items():
        if isinstance(g, bool) or not isinstance(g, (int, float)) or not math.isfinite(g) or not -24 <= g <= 6:
            return None
        if g:
            out["gain"][part] = round(float(g), 1)
    for c in changes:
        if not isinstance(c, dict) or c.get("part") not in SONG_PARTS or not isinstance(c.get("from"), dict) or not isinstance(c.get("to"), dict):
            return None
        g = c.get("gain")
        if isinstance(g, bool) or not isinstance(g, (int, float)) or not math.isfinite(g) or not -60 <= g <= 6:
            return None
        ends = [(_song_ref(c[k].get("song")), _seconds(c[k].get("t"), 86400)) for k in ("from", "to")]
        if any(None in e for e in ends):
            return None
        out["changes"].append({"part": c["part"], "gain": round(float(g), 1),
                               "from": {"song": ends[0][0], "t": ends[0][1]}, "to": {"song": ends[1][0], "t": ends[1][1]}})
    return out


def _clean_level_changes(changes) -> list[dict] | None:
    """A layer's volume over stretches of the song: [{gain (dB -60 to 6), fade ("in" or "out", optional),
    from: {song, t}, to: {song, t}}]."""
    if not isinstance(changes, list) or len(changes) > MAX_PART_CHANGES:
        return None
    out = []
    for c in changes:
        if not isinstance(c, dict) or not isinstance(c.get("from"), dict) or not isinstance(c.get("to"), dict):
            return None
        g, fade = c.get("gain", 0), c.get("fade")
        if isinstance(g, bool) or not isinstance(g, (int, float)) or not math.isfinite(g) or not -60 <= g <= 6 \
                or fade not in (None, "in", "out"):
            return None
        ends = [(_song_ref(c[k].get("song")), _seconds(c[k].get("t"), 86400)) for k in ("from", "to")]
        if any(None in e for e in ends):
            return None
        out.append({"gain": round(float(g), 1), **({"fade": fade} if fade else {}),
                    "from": {"song": ends[0][0], "t": ends[0][1]}, "to": {"song": ends[1][0], "t": ends[1][1]}})
    return out


def _clean_layers(layers) -> list[dict] | None:
    """A draft's layers: [{name, gain, duck, duckFrom, duckDb, matchTempo, eq, changes (all optional), clips: [{song, start, end,
    anchor: {song, t}, gain, fadeIn, fadeOut, bpm (optional)}]}], samples or songs played over the song,
    each clip pinned to a moment in it."""
    if not isinstance(layers, list) or len(layers) > MAX_LAYERS:
        return None
    out = []
    for layer in layers:
        if not isinstance(layer, dict) or not isinstance(layer.get("name", ""), str):
            return None
        gain, clips = _gain(layer.get("gain", 0)), layer.get("clips", [])
        if gain is None or not isinstance(clips, list) or len(clips) > MAX_CLIPS:
            return None
        clean = []
        for c in clips:
            if not isinstance(c, dict) or not isinstance(c.get("anchor"), dict):
                return None
            song, anchor_song = _song_ref(c.get("song")), _song_ref(c["anchor"].get("song"))
            start, end, t = _seconds(c.get("start"), 86400), _seconds(c.get("end"), 86400), _seconds(c["anchor"].get("t"), 86400)
            cg = _gain(c.get("gain", 0))
            fade_in, fade_out = _seconds(c.get("fadeIn", 0), 30), _seconds(c.get("fadeOut", 0), 30)
            bpm = c.get("bpm")
            if bpm is not None and (isinstance(bpm, bool) or not isinstance(bpm, (int, float))
                                    or not math.isfinite(bpm) or not 20 <= bpm <= 400):
                return None
            if None in (song, anchor_song, start, end, t, cg, fade_in, fade_out) or end <= start:
                return None
            clean.append({"song": song, "start": start, "end": end, "anchor": {"song": anchor_song, "t": t},
                          "gain": cg, "fadeIn": fade_in, "fadeOut": fade_out})
            if bpm is not None:  # its own tempo, for a layer that matches the song's
                clean[-1]["bpm"] = round(float(bpm), 1)
            ckey = c.get("key")
            if ckey is not None:  # its own key, for a layer that matches the song's
                if not isinstance(ckey, str) or not _KEY.match(ckey):
                    return None
                clean[-1]["key"] = ckey
        duck, match, muted = layer.get("duck", False), layer.get("matchTempo", False), layer.get("muted", False)
        eq = _clean_eq(layer["eq"]) if layer.get("eq") is not None else None
        if not isinstance(duck, bool) or not isinstance(match, bool) or not isinstance(muted, bool) \
                or (layer.get("eq") is not None and eq is None):
            return None
        match_key, semis = layer.get("matchKey", False), layer.get("semitones")
        if not isinstance(match_key, bool) or (semis is not None and (isinstance(semis, bool) or not isinstance(semis, int)
                                                                        or not -6 <= semis <= 6)):
            return None
        changes = _clean_level_changes(layer["changes"]) if layer.get("changes") is not None else []
        if changes is None:
            return None
        duck_from = layer.get("duckFrom")  # "vocals": it goes quieter while the song sings, not the song under it
        if duck_from is not None and duck_from != "vocals":
            return None
        duck_db = layer.get("duckDb")  # how far the song dips under it; missing is 8 dB
        if duck_db is not None and (isinstance(duck_db, bool) or not isinstance(duck_db, (int, float))
                                    or not math.isfinite(duck_db) or not 3 <= duck_db <= 24):
            return None
        out.append({"name": " ".join(layer.get("name", "").split())[:40], "gain": gain, "clips": clean})
        if duck:
            out[-1]["duck"] = True
        if duck_from:
            out[-1]["duckFrom"] = duck_from
        if changes:
            out[-1]["changes"] = changes
        if duck_db is not None:
            out[-1]["duckDb"] = round(float(duck_db), 1)
        if match_key:
            out[-1]["matchKey"] = True
        if semis:
            out[-1]["semitones"] = semis
        if match:
            out[-1]["matchTempo"] = True
        if muted:  # silent while you work, and left out of a song file made from the draft
            out[-1]["muted"] = True
        if eq is not None:
            out[-1]["eq"] = eq
    return out


def _clean_draft(body) -> dict | None:
    """A Music editor draft: {name, base, pieces: [{song, start, end, transition (optional)}], crossfade, fadeIn, fadeOut,
    made, length}. The songs are only referred to, never copied."""
    if not isinstance(body, dict):
        return None
    name = body.get("name")
    base = _song_ref(body.get("base"))
    pieces = body.get("pieces")
    if not isinstance(name, str) or not name.strip() or base is None \
            or not isinstance(pieces, list) or not 0 < len(pieces) <= MAX_PIECES:
        return None
    clean = []
    for p in pieces:
        if not isinstance(p, dict):
            return None
        song, start, end = _song_ref(p.get("song")), _seconds(p.get("start"), 86400), _seconds(p.get("end"), 86400)
        if song is None or start is None or end is None or end <= start:
            return None
        clean.append({"song": song, "start": start, "end": end})
        tr = p.get("transition")  # how the join before it plays (music.js TRANSITIONS)
        if tr is not None:
            beat = tr.get("beat") if isinstance(tr, dict) else None
            if not isinstance(tr, dict) or tr.get("kind") not in ("echo", "filter", "drop") or isinstance(beat, bool) \
                    or not isinstance(beat, (int, float)) or not math.isfinite(beat) or not 0.1 <= beat <= 2:
                return None
            clean[-1]["transition"] = {"kind": tr["kind"], "beat": round(float(beat), 3)}
    crossfade, fade_in, fade_out = (_seconds(body.get(k, 0), top) for k, top in
                                    (("crossfade", 10), ("fadeIn", 30), ("fadeOut", 30)))
    length = _seconds(body.get("length", 0), 86400)
    made = body.get("made")
    made = None if made is None else _song_ref(made)
    if None in (crossfade, fade_in, fade_out, length) or (body.get("made") is not None and made is None):
        return None
    out = {"name": " ".join(name.split())[:80], "base": base, "pieces": clean, "crossfade": crossfade,
           "fadeIn": fade_in, "fadeOut": fade_out, "made": made, "length": length}
    if body.get("layers"):  # sounds layered over the song (only kept when there are some)
        layers = _clean_layers(body["layers"])
        if layers is None:
            return None
        out["layers"] = layers
    if body.get("eq") is not None:  # the song's own bass, mid and treble
        eq = _clean_eq(body["eq"])
        if eq is None:
            return None
        out["eq"] = eq
    if body.get("parts") is not None:  # the song's own parts' levels (kept only when something's changed)
        parts = _clean_song_parts(body["parts"])
        if parts is None:
            return None
        if parts["gain"] or parts["muted"] or parts["changes"]:
            out["parts"] = parts
    return out


def _draft_id(request) -> str:
    draft_id = request.match_info["id"]
    if not valid_id(draft_id):
        raise web.HTTPBadRequest(text="bad draft id")
    return draft_id


async def list_drafts(request):
    return web.json_response(request.app[STORAGE].list_drafts())


async def create_draft(request):
    draft = _clean_draft(await request.json())
    if draft is None:
        raise web.HTTPBadRequest(text="expected {name, base, pieces, crossfade, fadeIn, fadeOut}")
    storage = request.app[STORAGE]
    draft_id = storage.new_draft_id(draft["name"])
    storage.save_draft(draft_id, draft)
    return web.json_response({"id": draft_id})


async def get_draft(request):
    draft = request.app[STORAGE].load_draft(_draft_id(request))
    if draft is None:
        raise web.HTTPNotFound()
    return web.json_response(draft)


async def put_draft(request):
    draft_id = _draft_id(request)
    draft = _clean_draft(await request.json())
    if draft is None:
        raise web.HTTPBadRequest(text="expected {name, base, pieces, crossfade, fadeIn, fadeOut}")
    storage = request.app[STORAGE]
    if storage.load_draft(draft_id) is None:
        raise web.HTTPNotFound()  # deleted meanwhile (another tab): not brought back by an autosave
    storage.save_draft(draft_id, draft)
    return web.json_response({"ok": True})


async def rename_draft(request):
    draft_id = _draft_id(request)
    body = await request.json()
    name = body.get("name") if isinstance(body, dict) else None
    if not isinstance(name, str) or not name.strip():
        raise web.HTTPBadRequest(text="give the draft a name")
    if not request.app[STORAGE].rename_draft(draft_id, " ".join(name.split())[:80]):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


async def delete_draft(request):
    if not request.app[STORAGE].delete_draft(_draft_id(request)):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# seasons: props packed away for part of the year (seasons.py) ------------------------------------
async def get_seasons(request):
    return web.json_response(seasons.load(request.app[STORAGE].load_settings()))


async def put_seasons(request):
    try:
        clean = seasons.clean(await request.json())
    except ValueError as e:
        raise web.HTTPBadRequest(text=str(e))
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["seasons"] = clean
    storage.save_settings(settings)
    # Props just packed away go dark straight away, even in the middle of a show or scene; props put
    # out join in from the next show or scene.
    request.app[RUNNER].player.drop(seasons.away(storage.load_devices(), clean))
    request.app[MQTT].refresh()  # Home Assistant's season switches follow
    return web.json_response(clean)


# pictures for matrices --------------------------------------------------------------
MAX_PICTURE_SIDE, MAX_PICTURE_FRAMES = 64, 120
MAX_PICTURES = 200  # the editor loads them all when it starts, so not without end


def _picture_id(request) -> str:
    picture_id = request.match_info["id"]
    if not valid_id(picture_id):
        raise web.HTTPBadRequest(text="bad picture id")
    return picture_id


def _clean_picture(body) -> dict:
    """{name, w, h, frames: [base64 RGBA, w * h * 4 bytes each], delays: [ms]}: shrunk by the browser to
    fit the largest matrix, so the effect only has to pick dots out of it."""
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected a picture")
    name = " ".join(str(body.get("name") or "").split())[:60]
    if not name:
        raise web.HTTPBadRequest(text="give the picture a name")
    try:
        w, h = int(body.get("w")), int(body.get("h"))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="a picture's width and height must be numbers")
    if not (1 <= w <= MAX_PICTURE_SIDE and 1 <= h <= MAX_PICTURE_SIDE):
        raise web.HTTPBadRequest(text=f"a picture is at most {MAX_PICTURE_SIDE} dots each way")
    frames, delays = body.get("frames"), body.get("delays")
    if not isinstance(frames, list) or not isinstance(delays, list) or not 1 <= len(frames) <= MAX_PICTURE_FRAMES \
            or len(delays) != len(frames):
        raise web.HTTPBadRequest(text=f"a picture has 1 to {MAX_PICTURE_FRAMES} frames, each with a delay")
    for f in frames:
        try:
            data = base64.b64decode(f, validate=True) if isinstance(f, str) else b""
        except (binascii.Error, ValueError):
            data = b""
        if len(data) != w * h * 4:
            raise web.HTTPBadRequest(text="each frame must be the picture's size")
    if not all(isinstance(d, int) and not isinstance(d, bool) and 20 <= d <= 10000 for d in delays):
        raise web.HTTPBadRequest(text="each frame shows for 20 to 10000 ms")
    out = {"name": name, "w": w, "h": h, "frames": frames, "delays": delays}
    if body.get("phone") is not None:
        out["phone"] = _clean_phone_copy(body["phone"])
    return out


PHONE_COPY_SIDE = 256          # as pictures.js PHONE_SIDE
PHONE_COPY_BYTES = 3_200_000   # its frames together, as base64 (pictures.js PHONE_BYTES, with room)


def _clean_phone_copy(phone) -> dict:
    """A picture's sharper copy for visitors' phones: {w, h, frames: [base64 WebP or PNG], delays: [ms]}."""
    if not isinstance(phone, dict):
        raise web.HTTPBadRequest(text="a picture's phone copy is a picture")
    try:
        w, h = int(phone.get("w")), int(phone.get("h"))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="a phone copy's width and height must be numbers")
    if not (1 <= w <= PHONE_COPY_SIDE and 1 <= h <= PHONE_COPY_SIDE):
        raise web.HTTPBadRequest(text=f"a phone copy is at most {PHONE_COPY_SIDE} dots each way")
    frames, delays = phone.get("frames"), phone.get("delays")
    if not isinstance(frames, list) or not isinstance(delays, list) or not 1 <= len(frames) <= MAX_PICTURE_FRAMES \
            or len(delays) != len(frames):
        raise web.HTTPBadRequest(text=f"a phone copy has 1 to {MAX_PICTURE_FRAMES} frames, each with a delay")
    if sum(len(f) for f in frames if isinstance(f, str)) > PHONE_COPY_BYTES:
        raise web.HTTPBadRequest(text="a phone copy is too big")
    for f in frames:
        try:
            data = base64.b64decode(f, validate=True) if isinstance(f, str) else b""
        except (binascii.Error, ValueError):
            data = b""
        if not (data.startswith(b"\x89PNG\r\n\x1a\n") or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")):
            raise web.HTTPBadRequest(text="each frame of a phone copy is a PNG or WebP image")
    if not all(isinstance(d, int) and not isinstance(d, bool) and 20 <= d <= 10000 for d in delays):
        raise web.HTTPBadRequest(text="each frame shows for 20 to 10000 ms")
    return {"w": w, "h": h, "frames": frames, "delays": delays}


async def list_pictures(request):
    return web.json_response(await asyncio.to_thread(request.app[STORAGE].list_pictures))


async def create_picture(request):
    picture = _clean_picture(await request.json())
    storage = request.app[STORAGE]
    if await asyncio.to_thread(storage.count_pictures) >= MAX_PICTURES:
        raise web.HTTPBadRequest(text=f"you have {MAX_PICTURES} pictures already; delete some first")
    return web.json_response({"id": await asyncio.to_thread(storage.save_picture, picture)})


async def get_picture(request):
    """The picture as matrices use it (its phone copy, if any, from /phone)."""
    picture = await asyncio.to_thread(request.app[STORAGE].load_picture, _picture_id(request))
    if picture is None:
        raise web.HTTPNotFound()
    picture = {k: v for k, v in picture.items() if k != "phone"}
    return web.json_response(picture)


async def get_picture_phone(request):
    picture = await asyncio.to_thread(request.app[STORAGE].load_picture, _picture_id(request))
    if picture is None or not isinstance(picture.get("phone"), dict):
        raise web.HTTPNotFound()
    return web.json_response(picture["phone"])


async def rename_picture(request):
    picture_id = _picture_id(request)
    body = await request.json()
    name = " ".join(str(body.get("name") or "").split())[:60] if isinstance(body, dict) else ""
    if not name:
        raise web.HTTPBadRequest(text="give the picture a name")
    if not await asyncio.to_thread(request.app[STORAGE].rename_picture, picture_id, name):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


async def delete_picture(request):
    if not await asyncio.to_thread(request.app[STORAGE].delete_picture, _picture_id(request)):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# your Singing faces ----------------------------------------------------------------
# The parts a face is made from, as in static/js/faces.js (RECIPE_PARTS).
FACE_PARTS = {
    "head": ("round", "oval", "wide", "tree", "ghost", "skull"),
    "patch": ("none", "face", "muzzle", "chest"),
    "eyes": ("dots", "ovals", "big", "triangles", "sockets", "cat"),
    "nose": ("none", "button", "carrot", "triangle", "beak", "long"),
    "mouth": ("open", "grin", "teeth", "small"),
    "top": ("none", "top hat", "santa hat", "witch hat", "elf hat", "bobble hat", "antlers", "cat ears", "bear ears", "star"),
    "extras": ("beard", "moustache", "whiskers", "pointy ears", "baubles", "scarf", "bow tie"),
}
MAX_FACES = 200
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _face_id(request) -> str:
    face_id = request.match_info["id"]
    if not valid_id(face_id):
        raise web.HTTPBadRequest(text="bad face id")
    return face_id


def _clean_face(body) -> dict:
    """{name, recipe: {head: {shape, colour, patch, patchColour}, eyes: {style, colour}, nose: {style, colour},
    mouth: {style, colour}, cheeks: colour or "", top: {style, colour, colour2}, extras: {name: colour}}}."""
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected a face")
    name = " ".join(str(body.get("name") or "").split())[:60]
    if not name:
        raise web.HTTPBadRequest(text="give the face a name")
    r = body.get("recipe")
    if not isinstance(r, dict):
        raise web.HTTPBadRequest(text="a face needs its recipe")

    def part(key):
        v = r.get(key)
        if not isinstance(v, dict):
            raise web.HTTPBadRequest(text=f"the face's {key} is missing")
        return v

    def pick(v, kind):
        if v not in FACE_PARTS[kind]:
            raise web.HTTPBadRequest(text=f"a face's {kind} is one of: {', '.join(FACE_PARTS[kind])}")
        return v

    def colour(v):
        if not isinstance(v, str) or not _HEX.match(v):
            raise web.HTTPBadRequest(text="a face's colours are like #ff8800")
        return v.lower()

    head, eyes, nose, mouth, top = (part(k) for k in ("head", "eyes", "nose", "mouth", "top"))
    extras = r.get("extras") or {}
    if not isinstance(extras, dict):
        raise web.HTTPBadRequest(text="a face's extras are a list of names and colours")
    cheeks = r.get("cheeks") or ""
    return {"name": name, "recipe": {
        "head": {"shape": pick(head.get("shape"), "head"), "colour": colour(head.get("colour")),
                 "patch": pick(head.get("patch", "none"), "patch"), "patchColour": colour(head.get("patchColour", "#ffffff"))},
        "eyes": {"style": pick(eyes.get("style"), "eyes"), "colour": colour(eyes.get("colour"))},
        "nose": {"style": pick(nose.get("style"), "nose"), "colour": colour(nose.get("colour"))},
        "mouth": {"style": pick(mouth.get("style"), "mouth"), "colour": colour(mouth.get("colour"))},
        "cheeks": colour(cheeks) if cheeks else "",
        "top": {"style": pick(top.get("style"), "top"), "colour": colour(top.get("colour")), "colour2": colour(top.get("colour2"))},
        "extras": {pick(k, "extras"): colour(v) for k, v in extras.items()},
    }}


async def list_faces(request):
    return web.json_response(await asyncio.to_thread(request.app[STORAGE].list_faces))


async def create_face(request):
    face = _clean_face(await request.json())
    storage = request.app[STORAGE]
    if await asyncio.to_thread(storage.count_faces) >= MAX_FACES:
        raise web.HTTPBadRequest(text=f"you have {MAX_FACES} faces already; delete some first")
    return web.json_response({"id": await asyncio.to_thread(storage.save_face, face)})


async def put_face(request):
    face_id = _face_id(request)
    face = _clean_face(await request.json())
    storage = request.app[STORAGE]
    if await asyncio.to_thread(storage.load_face, face_id) is None:
        raise web.HTTPNotFound()
    await asyncio.to_thread(storage.save_face, face, face_id)
    return web.json_response({"ok": True})


async def delete_face(request):
    if not await asyncio.to_thread(request.app[STORAGE].delete_face, _face_id(request)):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# samples ---------------------------------------------------------------------------
async def list_samples(request):
    return web.json_response(await asyncio.to_thread(request.app[STORAGE].list_samples))


async def delete_sample(request):
    if not request.app[STORAGE].delete_sample(request.query.get("path", "")):
        raise web.HTTPNotFound(text="no such sample")
    return web.json_response({"ok": True})


async def get_song_info(request):
    q = request.query
    return web.json_response(request.app[STORAGE].load_song_info(q.get("source", ""), q.get("path", "")))


async def put_song_info(request):
    info = _clean_song_info(await request.json())
    if info is None:
        raise web.HTTPBadRequest(text="expected {tempo, beats, bars, sections}")
    q = request.query
    source, path = q.get("source", ""), q.get("path", "")
    # Detect (here or in the Show editor) sends only what it found, so the song's marks stay.
    if "marks" not in info:
        old = request.app[STORAGE].load_song_info(source, path) or {}
        if old.get("marks"):
            info["marks"] = old["marks"]
    if not request.app[STORAGE].save_song_info(source, path, info):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# speakers ----------------------------------------------------------------
PLAY_MEDIA = 512  # MediaPlayerEntityFeature.PLAY_MEDIA in a media player's supported_features


def _media_player(entity) -> str:
    entity = str(entity or "")
    if not entity.startswith("media_player."):
        raise web.HTTPBadRequest(text="expected a media_player entity")
    return entity


async def list_speakers(request):
    """`speakers` are the ones added on the Speakers tab (each passed a test there); the editor
    only offers those. `candidates` are all of Home Assistant's media players."""
    ha = request.app[HA]
    settings = request.app[STORAGE].load_settings()
    delays, added = settings["speaker_delays"], settings.get("speakers", [])
    body = {"available": ha.available, "show_speaker": settings.get("show_speaker"), "candidates": []}
    states = {}
    if ha.available:
        try:
            states = {s["entity_id"]: s for s in await ha.states("media_player")}
        except HAError as e:
            body.update(available=False, error=str(e))
    name = lambda e: states.get(e, {}).get("attributes", {}).get("friendly_name") or e  # noqa: E731
    body["speakers"] = [{"entity_id": e, "name": name(e), "state": states.get(e, {}).get("state", "unavailable"),
                         "delay_ms": delays.get(e, 0)} for e in added]
    body["candidates"] = sorted(({
        "entity_id": e, "name": name(e), "state": st["state"], "added": e in added,
        "can_play": bool(int(st.get("attributes", {}).get("supported_features") or 0) & PLAY_MEDIA),
    } for e, st in states.items()), key=lambda s: s["name"].lower())
    return web.json_response(body)


async def test_speaker(request):
    """Play a chime on a speaker the way a show would; if it works, add it to the editor's list."""
    entity = _media_player((await request.json()).get("entity_id"))
    ha = request.app[HA]
    if not ha.available:
        raise web.HTTPServiceUnavailable(text="Home Assistant isn't reachable from HA-liday Show")
    try:
        st = await ha.state(entity)
    except HAError as e:
        return web.json_response({"ok": False, "error": f"couldn't read {entity}: {e}"})
    features = int(st.get("attributes", {}).get("supported_features") or 0)
    if not features & PLAY_MEDIA:
        return web.json_response({"ok": False, "error": "this media player can't be sent a song to play"})
    try:
        took = await request.app[RUNNER].test_speaker(entity)
    except RunnerError as e:
        return web.json_response({"ok": False, "error": str(e)})
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    added = settings.setdefault("speakers", [])
    if entity not in added:
        added.append(entity)
    storage.save_settings(settings)
    return web.json_response({"ok": True, "start_s": round(took, 2)})


async def remove_speaker(request):
    entity = _media_player((await request.json()).get("entity_id"))
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["speakers"] = [e for e in settings.get("speakers", []) if e != entity]
    storage.save_settings(settings)
    return web.json_response({"ok": True})


async def put_show_speaker(request):
    """The speaker shows play on when started from an automation and the show doesn't pick one."""
    body = await request.json()
    entity = body.get("entity_id") or None
    if entity is not None:
        entity = _media_player(entity)
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["show_speaker"] = entity
    storage.save_settings(settings)
    return web.json_response({"show_speaker": entity})


async def get_late_speaker(request):
    return web.json_response(latespeaker.clean(request.app[STORAGE].load_settings().get("late_speaker")))


async def put_late_speaker(request):
    """Late at night, for the neighbours: quieter, or no speaker, from a time until the morning."""
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["late_speaker"] = latespeaker.clean(body)
    storage.save_settings(settings)
    return web.json_response(settings["late_speaker"])


async def put_speaker_delay(request):
    body = await request.json()
    entity = str(body.get("entity_id", ""))
    if not entity.startswith("media_player."):
        raise web.HTTPBadRequest(text="expected a media_player entity")
    try:
        delay = max(-5000, min(5000, int(body.get("delay_ms", 0))))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="delay_ms must be a number")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["speaker_delays"][entity] = delay
    storage.save_settings(settings)
    return web.json_response({"entity_id": entity, "delay_ms": delay})


# colour palettes ------------------------------------------------------------
# The presets ship in palettes.js; only the user's own palettes are stored here.
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


async def get_palettes(request):
    return web.json_response(request.app[STORAGE].load_settings().get("palettes", []))


async def put_palettes(request):
    body = await request.json()
    if not isinstance(body, list) or len(body) > 100:
        raise web.HTTPBadRequest(text="expected a list of up to 100 palettes")
    palettes = []
    for p in body:
        name = str(p.get("name", "")).strip()[:60] if isinstance(p, dict) else ""
        colors = p.get("colors") if isinstance(p, dict) else None
        if not name or not isinstance(colors, list) or not 1 <= len(colors) <= 12 \
                or not all(isinstance(c, str) and _HEX.match(c) for c in colors):
            raise web.HTTPBadRequest(text="each palette needs a name and 1 to 12 #rrggbb colours")
        palettes.append({"name": name, "colors": [c.lower() for c in colors]})
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["palettes"] = palettes
    storage.save_settings(settings)
    return web.json_response(palettes)


# song folders -------------------------------------------------------------------
# Folders you make in Your songs: names only, each holding the songs (by where they are) put in it.
# The files stay where they are, so shows and speakers still find them.
MAX_FOLDERS, MAX_FOLDER_SONGS, MAX_FOLDER_DEPTH = 200, 2000, 8
_FOLDER_ID = re.compile(r"^[a-z0-9-]{1,40}$")


def _folder_head(f, ids: set, names: set) -> tuple[str, str, str | None]:
    """A folder's id, tidied name and parent (another folder's id, or None at the top). Ids are the
    list's own; names only need to differ from the other folders in the same place."""
    fid, name = str(f.get("id", "")), " ".join(str(f.get("name", "")).split())[:60]
    parent = f.get("parent")
    if parent is not None and (not isinstance(parent, str) or not _FOLDER_ID.match(parent) or parent == fid):
        raise web.HTTPBadRequest(text="a folder's parent is another folder")
    if not _FOLDER_ID.match(fid) or fid in ids or not name or (parent, name.lower()) in names:
        raise web.HTTPBadRequest(text="each folder needs its own id, and a name of its own where it is")
    ids.add(fid)
    names.add((parent, name.lower()))
    return fid, name, parent


def _check_tree(folders: list[dict]):
    """Folders inside folders: every parent is in the list, nothing is inside itself, and they go at
    most MAX_FOLDER_DEPTH deep."""
    parent = {f["id"]: f.get("parent") for f in folders}
    for fid in parent:
        seen, at = set(), fid
        while at is not None:
            if at in seen or len(seen) >= MAX_FOLDER_DEPTH:
                raise web.HTTPBadRequest(text=f"folders go inside each other at most {MAX_FOLDER_DEPTH} deep, and never inside themselves")
            seen.add(at)
            if at not in parent:
                raise web.HTTPBadRequest(text="a folder's parent is another folder")
            at = parent[at]


def _clean_song_folders(body) -> list[dict]:
    if not isinstance(body, list) or len(body) > MAX_FOLDERS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_FOLDERS} folders")
    out, ids, names, placed = [], set(), set(), set()
    for f in body:
        if not isinstance(f, dict):
            raise web.HTTPBadRequest(text="each folder needs an id, a name and its songs")
        songs = f.get("songs")
        if not isinstance(songs, list) or len(songs) > MAX_FOLDER_SONGS:
            raise web.HTTPBadRequest(text="each folder needs its own id and name, and a list of songs")
        fid, name, parent = _folder_head(f, ids, names)
        kept = []
        for s in songs:
            src, path = (s.get("source"), s.get("path")) if isinstance(s, dict) else (None, None)
            if not isinstance(src, str) or not isinstance(path, str) or not 0 < len(src) <= 20 or not 0 < len(path) <= 500:
                raise web.HTTPBadRequest(text="each song in a folder needs its source and path")
            if (src, path) in placed:  # a song is in one folder at most
                continue
            placed.add((src, path))
            kept.append({"source": src, "path": path})
        out.append({"id": fid, "name": name, "songs": kept, **({"parent": parent} if parent else {})})
    _check_tree(out)
    return out


# Folders for the Library's other lists (libfolders.js): per list, [{id, name, items}], where items
# are the keys of what's in it (a show's id, a palette's name, a preset's "effect:name"). Nothing moves.
LIBRARY_KINDS = ("shows", "scenes", "playlists", "palettes", "presets", "pictures", "faces")
MAX_FOLDER_ITEMS = 2000


def _clean_library_folders(body) -> tuple[str, list[dict]]:
    kind = body.get("kind") if isinstance(body, dict) else None
    folders = body.get("folders") if isinstance(body, dict) else None
    if kind not in LIBRARY_KINDS:
        raise web.HTTPBadRequest(text=f"which list? one of {', '.join(LIBRARY_KINDS)}")
    if not isinstance(folders, list) or len(folders) > MAX_FOLDERS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_FOLDERS} folders")
    out, ids, names, placed = [], set(), set(), set()
    for f in folders:
        if not isinstance(f, dict):
            raise web.HTTPBadRequest(text="each folder needs an id, a name and what's in it")
        items = f.get("items")
        if not isinstance(items, list) or len(items) > MAX_FOLDER_ITEMS:
            raise web.HTTPBadRequest(text="each folder needs its own id and name, and a list of what's in it")
        if not all(isinstance(k, str) and 0 < len(k) <= 200 for k in items):
            raise web.HTTPBadRequest(text="what's in a folder is listed by name or id")
        fid, name, parent = _folder_head(f, ids, names)
        kept = [k for k in dict.fromkeys(items) if k not in placed]  # in one folder at most
        placed.update(kept)
        out.append({"id": fid, "name": name, "items": kept, **({"parent": parent} if parent else {})})
    _check_tree(out)
    return kind, out


async def get_library_folders(request):
    saved = request.app[STORAGE].load_settings().get("library_folders")
    saved = saved if isinstance(saved, dict) else {}
    return web.json_response({k: saved.get(k) if isinstance(saved.get(k), list) else [] for k in LIBRARY_KINDS})


async def put_library_folders(request):
    kind, folders = _clean_library_folders(await request.json())
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    saved = settings.get("library_folders") if isinstance(settings.get("library_folders"), dict) else {}
    settings["library_folders"] = {**saved, kind: folders}
    storage.save_settings(settings)
    return web.json_response(folders)


MAX_GROUPS, MAX_GROUP_MEMBERS = 50, 200
_MEMBER_ID = re.compile(r"^[^\x00-\x1f]{1,200}$")


# Light groups ({id, name, members}): lights and parts that a show can give one effect, on its own
# lane in the Show editor. Members are device ids, or "light#part" for a part.
def _clean_light_groups(body) -> list[dict]:
    if not isinstance(body, list) or len(body) > MAX_GROUPS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_GROUPS} groups")
    out, ids, names = [], set(), set()
    for g in body:
        if not isinstance(g, dict):
            raise web.HTTPBadRequest(text="each group needs an id, a name and its lights")
        gid, name = str(g.get("id", "")), " ".join(str(g.get("name", "")).split())[:60]
        members = g.get("members")
        if not _FOLDER_ID.match(gid) or gid in ids or not name or name.lower() in names \
                or not isinstance(members, list) or len(members) > MAX_GROUP_MEMBERS:
            raise web.HTTPBadRequest(text="each group needs its own id and name, and a list of lights")
        if not all(isinstance(m, str) and _MEMBER_ID.match(m) for m in members):
            raise web.HTTPBadRequest(text="a group's lights are named by their ids")
        ids.add(gid)
        names.add(name.lower())
        out.append({"id": gid, "name": name, "members": list(dict.fromkeys(members))})
    return out


async def get_light_groups(request):
    groups = request.app[STORAGE].load_settings().get("light_groups")
    return web.json_response(groups if isinstance(groups, list) else [])


async def put_light_groups(request):
    groups = _clean_light_groups(await request.json())
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["light_groups"] = groups
    storage.save_settings(settings)
    return web.json_response(groups)


async def get_song_folders(request):
    folders = request.app[STORAGE].load_settings().get("song_folders")
    return web.json_response(folders if isinstance(folders, list) else [])


async def put_song_folders(request):
    folders = _clean_song_folders(await request.json())
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["song_folders"] = folders
    storage.save_settings(settings)
    return web.json_response(folders)


# Folders for Library → Samples, the same shape as song folders: the files stay in the Samples folder,
# so Music editor drafts still find them.
async def get_sample_folders(request):
    folders = request.app[STORAGE].load_settings().get("sample_folders")
    return web.json_response(folders if isinstance(folders, list) else [])


async def put_sample_folders(request):
    folders = _clean_song_folders(await request.json())
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["sample_folders"] = folders
    storage.save_settings(settings)
    return web.json_response(folders)


# playlists ----------------------------------------------------------------------
async def get_playlists(request):
    return web.json_response(playlists.load(request.app[STORAGE]))


async def put_playlists(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, list) or len(body) > playlists.MAX_PLAYLISTS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {playlists.MAX_PLAYLISTS} playlists")
    clean = [playlists.clean(p) for p in body]
    if not all(clean):
        raise web.HTTPBadRequest(text=f"each playlist needs an id, a name, up to {playlists.MAX_SHOWS} "
                                      "shows and a pause in seconds")
    if len({p["id"] for p in clean}) != len(clean):
        raise web.HTTPBadRequest(text="each playlist needs its own id")
    blocks = [x["id"] for p in clean for x in p["items"] if x["type"] != "pause" and x["type"] != "show"]
    if len(set(blocks)) != len(blocks):
        raise web.HTTPBadRequest(text="each building block needs its own id")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["playlists"] = clean
    storage.save_settings(settings)
    storage.prune_blocks(set(blocks))
    request.app[MQTT].refresh()
    return web.json_response(clean)


# A playlist's building blocks (playlists.py): the editor bakes their frames, as it does a show's.
def _block_id(request) -> str:
    block_id = request.match_info["id"]
    if not valid_id(block_id) or block_id not in playlists.block_ids(playlists.load(request.app[STORAGE])):
        raise web.HTTPNotFound(text="no such building block; save the playlist first")
    return block_id


async def get_blocks(request):
    return web.json_response({"baked": request.app[STORAGE].baked_blocks()})


def _save_block(request, block_id: str, blob: bytes):
    blob = _unpacked(request, blob)
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_block(block_id, blob)
    return web.json_response({"ok": True, "bytes": len(blob)})


async def put_block(request):
    block_id = _block_id(request)
    return _save_block(request, block_id, await request.read())


async def put_block_part(request):
    block_id = _block_id(request)
    storage = request.app[STORAGE]
    part, size, done = await _receive_part(request, storage.blocks_dir)
    if not done:
        return web.json_response({"received": size})
    blob = part.read_bytes()
    part.unlink(missing_ok=True)
    return _save_block(request, block_id, blob)


def _schedule_view(app) -> dict:
    return {**app[SCHEDULER].state(), "entries": schedule.load_entries(app[STORAGE])}


# pre-show check (preshow.py) --------------------------------------------------------------------
async def preshow_run(request):
    """The checks that need nobody looking: lights, how tonight's shows start, and the sound."""
    app = request.app
    storage, settings = app[STORAGE], app[STORAGE].load_settings()
    devices = storage.load_devices()
    away = seasons.away(devices, seasons.load(settings))
    light_lines, look = await preshow.lights(devices, away, app[HA])
    for ln in light_lines:
        if ln["level"] == "fail":
            app[HUB].emit("light_not_answering", {"light": ln.get("light"), "message": ln["text"]})
    where = app[SCHEDULER].where()[0]
    today = datetime.date.today()
    p = public.load(storage) or public.clean(None)
    picks = public.choices(storage) if p["on"] else []
    page = []
    if p["on"]:
        site = app[PUBLIC]
        answers = site.listening and await preshow.reach(f"http://127.0.0.1:{site.port}/api/state?code={p['code']}") == ""
        outside = await preshow.reach(f"{p['address']}/api/state?code={p['code']}") if p["address"] else None
        page = preshow.page_lines(p, running=site.listening, error=site.error, hours=public.hours_now(p, where),
                                  picks=picks, answers=answers, outside=outside, waiting=len(app[RUNNER].requests))
    entries = schedule.load_entries(storage)
    sched_on, sched, tonight = any(e.get("on") for e in entries), [], []
    if sched_on:
        lists = {pl["id"]: pl for pl in playlists.load(storage)}
        have = {"playlist": set(lists), "scene": {x["id"] for x in storage.list_scenes()},
                "show": {x["id"] for x in storage.list_shows()}}
        alive = {e["id"] for e in entries if e["play"]["id"] in have[e["play"]["type"]]}
        slots = schedule.week(entries, today, where, alive)["slots"]
        sched = preshow.schedule_lines(slots, today.isoformat())
        by_id = {e["id"]: e for e in entries}
        for slot in slots:
            e = by_id.get(slot["entry"])
            if slot["day"] == today.isoformat() and slot["plays"] and e and e["play"]["type"] != "scene":
                tonight += lists[e["play"]["id"]]["shows"] if e["play"]["type"] == "playlist" else [e["play"]["id"]]
    summary, start_lines = preshow.starting(p["on"], page, sched_on, sched)
    # The sound: each speaker tonight's shows play on (their own, else your show speaker), and phones.
    default = settings.get("show_speaker") or ""
    shows = {sid: storage.load_show(sid) or {} for sid in {*tonight, *(s for c in picks if c.get("available") for s in c["shows"])}}
    used = {sh.get("media_player") or default for sh in shows.values()} - {""}
    speakers = {}
    for entity in sorted(used):
        got = await preshow._ask_ha(app[HA], entity)
        name = entity
        if got == "ok":
            with contextlib.suppress(Exception):
                name = (await app[HA].state(entity)).get("attributes", {}).get("friendly_name") or entity
        speakers[name] = got
    missing = sorted({(shows[c["shows"][0]].get("name") or c["name"]) for c in picks
                      if c.get("available") and not c.get("speaker") and p["listen"]
                      and shows[c["shows"][0]].get("audio") and public._song_file(storage, shows[c["shows"][0]]) is None})
    sound = preshow.sound_lines(page_on=p["on"], listen=p["listen"], picks=picks, missing_songs=missing,
                                speakers=speakers, can_shrink=songcopy.converter() is not None)
    return web.json_response({
        "groups": [{"key": "lights", "title": "Lights", "items": light_lines},
                   {"key": "start", "title": "How shows start tonight", "summary": summary, "items": start_lines},
                   {"key": "sound", "title": "Sound", "items": sound}],
        "look": look,
        # The shows that could play tonight, for the editor to check (showhealth.js).
        "shows": sorted(sid for sid, sh in shows.items() if sh)})


async def preshow_timing(request):
    """The timing test (timingtest.py): every light flashes once a second while phones listening beep.
    {"stop": true} stops it (only if it's still what's playing)."""
    runner = request.app[RUNNER]
    body = await request.json() if request.can_read_body else {}
    if isinstance(body, dict) and body.get("stop"):
        await runner.stop(timingtest.TIMING_ID)
        return web.json_response({"ok": True})
    try:
        await runner.play_timing_test()
    except RunnerError as e:
        raise web.HTTPBadRequest(text=str(e)[:1].upper() + str(e)[1:])
    return web.json_response({"ok": True, "seconds": timingtest.SECONDS})


def _clean_preshow_last(body) -> dict:
    """What the last pre-show check found, for Setup to show: {level, problems, warnings}."""
    if not isinstance(body, dict) or body.get("level") not in preshow.LEVELS:
        raise web.HTTPBadRequest(text="expected {level, problems, warnings}")
    count = lambda k: body.get(k) if isinstance(body.get(k), int) and not isinstance(body.get(k), bool) and 0 <= body.get(k) <= 999 else None
    if count("problems") is None or count("warnings") is None:
        raise web.HTTPBadRequest(text="problems and warnings must be counts")
    return {"level": body["level"], "problems": body["problems"], "warnings": body["warnings"],
            "at": datetime.datetime.now().isoformat(timespec="minutes")}


async def get_preshow_last(request):
    last = request.app[STORAGE].load_settings().get("preshow")
    return web.json_response(last if isinstance(last, dict) else None)


async def put_preshow_last(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    last = _clean_preshow_last(body)
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["preshow"] = last
    storage.save_settings(settings)
    request.app[HUB].emit("preshow_check", {k: last[k] for k in ("level", "problems", "warnings")})
    return web.json_response(last)


async def get_schedule(request):
    """The schedule's entries, HA-liday Show's clock, and when each entry next starts."""
    return web.json_response(_schedule_view(request.app))


async def get_schedule_week(request):
    """What plays when over a week (?start=YYYY-MM-DD, today if left out), for the week view."""
    try:
        start = datetime.date.fromisoformat(request.query["start"]) if request.query.get("start") else datetime.date.today()
    except ValueError:
        raise web.HTTPBadRequest(text="start must be a date, like 2026-11-02")
    where, _ = request.app[SCHEDULER].where()
    storage = request.app[STORAGE]
    entries = schedule.load_entries(storage)
    # Rows whose playlist, show or scene is gone are skipped by the scheduler, so they're left out here.
    have = {"playlist": {p["id"] for p in playlists.load(storage)}, "scene": {s["id"] for s in storage.list_scenes()},
            "show": {s["id"] for s in storage.list_shows()}}
    alive = {e["id"] for e in entries if e["play"]["id"] in have[e["play"]["type"]]}
    return web.json_response(schedule.week(entries, start, where, alive))


async def put_schedule(request):
    """The whole schedule, highest priority first (schedule.py)."""
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, list) or len(body) > schedule.MAX_ENTRIES:
        raise web.HTTPBadRequest(text=f"expected a list of up to {schedule.MAX_ENTRIES} schedule entries")
    clean = [schedule.clean_entry(e) for e in body]
    if not all(clean):
        raise web.HTTPBadRequest(text="each entry needs an id, a playlist, show or scene to play, a start "
                                      "and an end that differ, and days")
    if len({e["id"] for e in clean}) != len(clean):
        raise web.HTTPBadRequest(text="each entry needs its own id")
    storage = request.app[STORAGE]
    schedule.load_entries(storage)  # move any old schedules across first, so they aren't made again
    settings = storage.load_settings()
    settings["schedule"] = clean
    storage.save_settings(settings)
    return web.json_response(_schedule_view(request.app))


async def put_location(request):
    """Where sunset is worked out for: {"lat", "lon"}, or {} to go back to Home Assistant's."""
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected a latitude and longitude")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    if body.get("lat") is None and body.get("lon") is None:
        settings.pop("location", None)
    else:
        try:
            lat, lon = float(body["lat"]), float(body["lon"])
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="latitude and longitude must be numbers")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise web.HTTPBadRequest(text="latitude goes from -90 to 90 and longitude from -180 to 180")
        settings["location"] = {"lat": round(lat, 4), "lon": round(lon, 4)}
    storage.save_settings(settings)
    return web.json_response(_schedule_view(request.app))


async def play_playlist(request):
    playlist = playlists.find(request.app[STORAGE], request.match_info["id"])
    if playlist is None:
        raise web.HTTPNotFound(text="no such playlist")
    await stop_tests(request.app)
    try:
        await request.app[RUNNER].play_playlist(playlist)
    except RunnerError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response(request.app[RUNNER].status())


# live music (livemusic.py) --------------------------------------------------------
live_settings = livemusic.settings


async def get_live_music(request):
    live, cfg = request.app[LIVE], live_settings(request.app[STORAGE])
    now = live.now(cfg["source"])
    return web.json_response({"listening": live.listening, "error": live.error, "settings": cfg,
                              "sending": live.sending(), "now": now,
                              "music": bool(now and now["loudness"] >= cfg["from"])})


async def put_live_music(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected the live music settings")
    storage = request.app[STORAGE]
    cfg = live_settings(storage)
    if "source" in body:
        src = body["source"]
        try:
            ok = src == "any" or (isinstance(src, str) and ipaddress.ip_address(src).version == 4)
        except ValueError:
            ok = False
        if not ok:
            raise web.HTTPBadRequest(text="listen to any WLED, or one by its IP address")
        cfg["source"] = src
    if "from" in body:
        level = body["from"]
        if not isinstance(level, int) or isinstance(level, bool) or not 0 <= level <= 100:
            raise web.HTTPBadRequest(text="how loud counts as music goes from 0 to 100")
        cfg["from"] = level
    settings = storage.load_settings()
    settings["live_music"] = cfg
    storage.save_settings(settings)
    return await get_live_music(request)


# scenes (scenelib.py) -------------------------------------------------------------
def _scene_id(request) -> str:
    scene_id = request.match_info["id"]
    if not valid_id(scene_id):
        raise web.HTTPBadRequest(text="bad scene id")
    return scene_id


def _scene_name_taken(storage, name: str, but: str | None = None) -> bool:
    # Home Assistant gets a scene per scene, by name, so two mustn't share one.
    return any(s["name"].lower() == name.lower() and s["id"] != but for s in storage.list_scenes())


async def list_scenes(request):
    return web.json_response(request.app[STORAGE].list_scenes())


async def create_scene(request):
    try:
        body = await request.json()
        name = scenelib.clean_name(body.get("name") if isinstance(body, dict) else None)
    except ValueError as e:
        raise web.HTTPBadRequest(text=str(e) if isinstance(e, scenelib.SceneError) else "expected JSON")
    storage = request.app[STORAGE]
    if _scene_name_taken(storage, name):
        raise web.HTTPConflict(text=f"there's already a scene called {name}")
    scene_id = storage.new_scene_id(name)
    storage.save_scene(scene_id, {"name": name, "mode": "basic", "lights": {}})
    request.app[MQTT].refresh()  # Home Assistant's scenes and the light's list follow
    return web.json_response({"id": scene_id})


async def get_scene(request):
    scene = request.app[STORAGE].load_scene(_scene_id(request))
    if scene is None:
        raise web.HTTPNotFound(text="that scene isn't there")
    return web.json_response(scene)


async def put_scene(request):
    scene_id = _scene_id(request)
    storage = request.app[STORAGE]
    if storage.load_scene(scene_id) is None:
        raise web.HTTPNotFound(text="that scene has been deleted")
    try:
        scene = scenelib.clean_scene(await request.json())
    except ValueError as e:
        raise web.HTTPBadRequest(text=str(e) if isinstance(e, scenelib.SceneError) else "expected JSON")
    if _scene_name_taken(storage, scene["name"], but=scene_id):
        raise web.HTTPConflict(text=f"there's already a scene called {scene['name']}")
    storage.save_scene(scene_id, scene)
    request.app[MQTT].refresh()  # Home Assistant's scenes and the light's list follow
    return web.json_response({"ok": True})


async def delete_scene(request):
    scene_id = _scene_id(request)
    storage = request.app[STORAGE]
    if storage.load_scene(scene_id) is None:
        raise web.HTTPNotFound(text="that scene isn't there")
    await request.app[RUNNER].stop_scene(scene_id)
    await asyncio.to_thread(backup.keep_copy, storage.config_dir, __version__, "delete")
    storage.delete_scene(scene_id)
    request.app[MQTT].refresh()  # Home Assistant's scenes and the light's list follow
    return web.json_response({"ok": True})


def _save_scene_baked(request, scene_id: str, blob: bytes):
    if request.app[STORAGE].load_scene(scene_id) is None:
        raise web.HTTPNotFound(text="that scene has been deleted")
    blob = _unpacked(request, blob)
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_scene_baked(scene_id, blob)
    return web.json_response({"ok": True, "bytes": len(blob)})


async def put_scene_live(request):
    """A scene's live set (liveeffects.py), baked by the editor beside the scene's own bake."""
    scene_id = _scene_id(request)
    storage = request.app[STORAGE]
    if storage.load_scene(scene_id) is None:
        raise web.HTTPNotFound(text="that scene has been deleted")
    blob = _unpacked(request, await request.read())
    if liveeffects.load(blob) is None:
        raise web.HTTPBadRequest(text="that isn't a scene's live set")
    storage.save_scene_live(scene_id, blob)
    return web.json_response({"ok": True, "bytes": len(blob)})


async def delete_scene_live(request):
    request.app[STORAGE].save_scene_live(_scene_id(request), None)
    return web.json_response({"ok": True})


async def put_scene_baked(request):
    scene_id = _scene_id(request)
    return _save_scene_baked(request, scene_id, await request.read())


async def put_scene_baked_part(request):
    scene_id = _scene_id(request)
    storage = request.app[STORAGE]
    storage.scenes_dir.mkdir(parents=True, exist_ok=True)
    part, size, done = await _receive_part(request, storage.scenes_dir)
    if not done:
        return web.json_response({"received": size})
    blob = part.read_bytes()
    part.unlink(missing_ok=True)
    return _save_scene_baked(request, scene_id, blob)


async def play_scene(request):
    await stop_tests(request.app)
    try:
        await request.app[RUNNER].play_scene(_scene_id(request))
    except RunnerError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response(request.app[RUNNER].status())


async def stop_scene(request):
    await request.app[RUNNER].stop_scene(_scene_id(request))
    return web.json_response(request.app[RUNNER].status())


# the public page ---------------------------------------------------------------
def _public_view(app) -> dict:
    site, runner = app[PUBLIC], app[RUNNER]
    waits = runner.queue_waits()
    return {**(public.load(app[STORAGE]) or public.clean(None)),
            "port": site.port, "listening": site.listening, "error": site.error,
            "today": datetime.date.today().isoformat(),
            # Where the nearby check measures from: "you" (typed in for sunset), "ha", or None.
            "home": app[SCHEDULER].where()[1],
            "hours_now": public.hours_now(public.load(app[STORAGE]) or public.clean(None), app[SCHEDULER].where()[0]),
            "has_house_photo": app[STORAGE].house_photo() is not None,
            # Whether songs can be made small for listening on phones (ffmpeg); else the song file goes as is.
            "can_shrink_songs": songcopy.converter() is not None,
            "has_picture": app[STORAGE].public_picture() is not None,
            # Changes whenever the picture does, so the editor's thumbnail reloads after a new one.
            "picture_v": public.picture_version(app[STORAGE], (public.load(app[STORAGE]) or public.clean(None))["look"]),
            # The dated looks with a picture of their own.
            "look_pictures": sorted(app[STORAGE].public_picture_rows()),
            # Which look visitors get today ("" for the everyday one).
            "look_today": public.look_now(public.load(app[STORAGE]) or public.clean(None))["row"],
            # Every word visitors read, grouped, with the wording each starts with, for the Words tab.
            "word_groups": public.WORD_GROUPS,
            "now": runner.public_now["name"] if runner.public_now else None,
            "tonight": public.tonight(runner),
            "waiting": [{"name": r["name"], "wait": w} for r, w in zip(runner.requests, waits)],
            # With voting on: what's been voted for so far this round, the leader first.
            "votes": [{"name": v["name"], "count": v["count"]} for v in runner.vote_counts()]}


async def get_public(request):
    return web.json_response(_public_view(request.app))


async def put_public(request):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected the public page settings")
    storage = request.app[STORAGE]
    stored = public.load(storage) or public.clean(None)
    if "more_hours" in body and (not isinstance(body["more_hours"], list) or len(body["more_hours"]) > public.MAX_MORE_HOURS
                                 or len(public.clean_more_hours(body["more_hours"])) != len(body["more_hours"])):
        raise web.HTTPBadRequest(text=f"each extra set of opening hours needs a start, a different end time and its days "
                                      f"(up to {public.MAX_MORE_HOURS})")
    if "hours" in body and playlists.clean_schedule({**body["hours"], "from": "", "to": ""}
                                                    if isinstance(body["hours"], dict) else None) is None:
        raise web.HTTPBadRequest(text="opening hours need a start, a different end time and their days")
    settings = storage.load_settings()
    # Anything not sent stays as it was, so an editor still open from an older version can't wipe
    # settings it doesn't know about (opening hours turning off, say). The code only changes with New code.
    merged = {**stored, **body}
    if "items" not in body and ("shows" in body or "playlists" in body):  # picks in the format from before dates
        merged.pop("items")
    settings["public"] = {**public.clean(merged), "code": stored["code"]}
    storage.save_settings(settings)
    for gone in storage.public_picture_rows() - {r["id"] for r in settings["public"]["looks"]}:
        storage.delete_public_picture(gone)
    await request.app[PUBLIC].apply()
    return web.json_response(_public_view(request.app))


async def put_public_picture(request):
    """The public page's own picture, instead of the house photo."""
    ext = PHOTO_TYPES.get(request.content_type)
    if ext is None:
        raise web.HTTPUnsupportedMediaType(text="send a JPEG, PNG or WebP picture")
    data = bytearray()
    while chunk := await request.content.read(1 << 16):
        data += chunk
        if len(data) > MAX_PHOTO:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_PHOTO, actual_size=len(data))
    if not data:
        raise web.HTTPBadRequest(text="no picture")
    storage = request.app[STORAGE]
    p = public.load(storage) or public.clean(None)
    row = _dated_look(request, p)
    storage.save_public_picture(bytes(data), ext, row)
    settings = storage.load_settings()
    if row:
        settings["public"] = {**p, "looks": [{**r, "look": {**r["look"], "picture": "upload"}} if r["id"] == row else r
                                             for r in p["looks"]]}
    else:
        settings["public"] = {**p, "look": {**p["look"], "picture": "upload"}}
    storage.save_settings(settings)
    await request.app[PUBLIC].apply()
    return web.json_response(_public_view(request.app))


def _dated_look(request, p: dict) -> str | None:
    """The dated look a request names (?look=…), or None for the everyday look."""
    row = request.query.get("look") or ""
    if not row:
        return None
    if not any(r["id"] == row for r in p["looks"]):
        raise web.HTTPNotFound(text="no such dated look; save it first")
    return row


async def get_public_picture(request):
    st = request.app[STORAGE]
    p = st.public_picture(_dated_look(request, public.load(st) or public.clean(None)))
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})


# A preview of the visitors' page for the Public page tab, served here (behind Home Assistant's
# login) rather than on the public port: the same page, shown as visitors with the code see it, but it
# can't start or cancel anything.
async def public_preview_page(request):
    return public.page_file(request.match_info.get("name") or "index.html")


async def public_preview_state(request):
    st = request.app[STORAGE]
    p = public.load(st) or public.clean(None)
    view = public.state(st, request.app[RUNNER], None, p["code"], where=request.app[SCHEDULER].where()[0],
                        look_id=request.query.get("look") or None)
    return web.json_response({**view, "preview": True},
                             headers={"Cache-Control": "no-store"})


async def public_preview_picture(request):
    # The copy visitors get, so a picture they won't see doesn't show in the preview either.
    st = request.app[STORAGE]
    path = public.picture_path(st, public.look_now(public.load(st) or public.clean(None), force=request.query.get("look") or None))
    try:
        data = public.stripped_picture(path) if path is not None else None
    except OSError:
        data = None
    if data is None:
        raise web.HTTPNotFound()
    return web.Response(body=data, content_type=public.PICTURE_TYPES.get(path.suffix.lower(), "application/octet-stream"),
                        headers={"Cache-Control": "no-cache"})


async def public_preview_cover(request):
    st = request.app[STORAGE]
    q = request.query
    pick = next((c for c in public.choices(st) if c["kind"] == q.get("kind") and c["id"] == q.get("id")), None)
    pic = public.cover_of(st, pick) if pick else None
    if pic is None:
        raise web.HTTPNotFound()
    return web.Response(body=pic[1], content_type=pic[0], headers={"Cache-Control": "no-cache"})


async def public_qr(request):
    """The QR code for the sign: an SVG of the visitors' link, which must carry your current code.
    ?download=1 hands it over as a file to use elsewhere."""
    p = public.load(request.app[STORAGE]) or public.clean(None)
    svg = public.qr_svg(request.query.get("link", ""), p["code"])
    if svg is None:
        raise web.HTTPBadRequest(text="that isn't your visitors' link")
    headers = {"Cache-Control": "no-cache"}
    if request.query.get("download") == "1":
        headers["Content-Disposition"] = 'attachment; filename="light-show-qr-code.svg"'
    return web.Response(text=svg, content_type="image/svg+xml", headers=headers)


async def sign_page(request):
    """A sign to print, with the QR code, for outside the house."""
    return web.FileResponse(STATIC / "sign.html", headers={"Cache-Control": "no-cache"})


async def new_public_code(request):
    """A new code for visitors' links: the old link and any printed QR code stop working."""
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["public"] = {**(public.load(storage) or public.clean(None)), "code": public.new_code()}
    storage.save_settings(settings)
    await request.app[PUBLIC].apply()
    return web.json_response(_public_view(request.app))


async def clear_public_queue(request):
    request.app[RUNNER].clear_requests()
    return web.json_response(_public_view(request.app))


# effect presets -------------------------------------------------------------
# Built-in presets ship in effects.js; only the user's own are stored here. Each is a named set of
# settings for one effect, so values are short strings, numbers or booleans.
_EFFECT_KEY = re.compile(r"^[a-z0-9_]{1,32}$")
MAX_PRESETS = 200


def _clean_preset(p):
    if not isinstance(p, dict):
        return None
    name = str(p.get("name", "")).strip()[:60]
    effect = p.get("effect")
    params = p.get("params")
    if not name or not isinstance(effect, str) or not _EFFECT_KEY.match(effect) \
            or not isinstance(params, dict) or len(params) > 40:
        return None
    clean = {}
    for k, v in params.items():
        if not isinstance(k, str) or not _EFFECT_KEY.match(k):
            return None
        if isinstance(v, str):
            v = v[:200]
        elif not isinstance(v, (bool, int, float)) or (isinstance(v, float) and not math.isfinite(v)):
            return None
        clean[k] = v
    return {"name": name, "effect": effect, "params": clean}


async def get_presets(request):
    return web.json_response(request.app[STORAGE].load_settings().get("presets", []))


async def put_presets(request):
    body = await request.json()
    if not isinstance(body, list) or len(body) > MAX_PRESETS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_PRESETS} presets")
    presets = [_clean_preset(p) for p in body]
    if not all(presets):
        raise web.HTTPBadRequest(text="each preset needs a name, an effect and its settings")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["presets"] = presets
    storage.save_settings(settings)
    return web.json_response(presets)


# house view --------------------------------------------------------------
MAX_PHOTO = 20 * 1024 * 1024
MAX_POINTS = 200


async def get_house(request):
    return web.json_response({**_house(request.app[STORAGE].load_settings()),
                              "photo": request.app[STORAGE].house_photo() is not None})


def _house(settings: dict) -> dict:
    house = settings.get("house", {})
    return {"paths": house.get("paths", {}), "styles": house.get("styles", {}), "pins": house.get("pins", {}),
            "dim": house.get("dim", 0.5)}


def _clean_style(style) -> dict | None:
    """How a light looks on the house photo. {"style": "icicle", "drops": n, "length": l} draws n
    drops hanging from its line, the longest l of the photo's height. {"style": "spots", "beam": b,
    "aims": [[dx, dy], ...]} draws each point as a spotlight shining dx across and dy down the
    photo, its beam b wide for its length. Plain lines need nothing."""
    if not isinstance(style, dict):
        return None
    try:
        if style.get("style") == "icicle":
            drops = min(max(int(style.get("drops", 40)), 1), MAX_BULBS)
            length = round(min(max(float(style.get("length", 0.06)), 0.01), 0.5), 4)
            return {"style": "icicle", "drops": drops, "length": length}
        if style.get("style") == "arches":
            # A line of arches standing on the traced line (or hanging from it), each `height` of the
            # photo's height at its middle.
            arches = min(max(int(style.get("arches", 4)), 1), 100)
            height = round(min(max(float(style.get("height", 0.08)), 0.005), 0.5), 4)
            return {"style": "arches", "arches": arches, "height": height, "down": style.get("down") is True}
        if style.get("style") == "panel":
            # A matrix as a flat panel: its path is the four corners, from the top left round.
            return {"style": "panel"}
        if style.get("style") == "tree":
            # A matrix as a mega-tree: its path is the top, then the left and right ends of the base.
            # round: its strings go all the way round, so the back half is drawn faint.
            return {"style": "tree", "round": True} if style.get("round") is True else {"style": "tree"}
        if style.get("style") == "spots":
            beam = round(min(max(float(style.get("beam", 0.5)), 0.1), 1.5), 3)
            aims = style.get("aims") or []
            if not isinstance(aims, list) or len(aims) > MAX_POINTS:
                raise ValueError
            aims = [[round(min(max(float(a[0]), -1), 1), 4), round(min(max(float(a[1]), -1), 1), 4)]
                    for a in aims]
            return {"style": "spots", "beam": beam, "aims": aims}
    except (TypeError, ValueError, IndexError):
        raise web.HTTPBadRequest(text="a light's style settings must be numbers")
    return None


async def put_house(request):
    """Where each light runs on the house photo (points from 0 to 1 across and down the photo,
    starting at the plug) and how much to darken the photo."""
    body = await request.json()
    paths = body.get("paths") if isinstance(body, dict) else None
    if not isinstance(paths, dict) or len(paths) > 100:
        raise web.HTTPBadRequest(text="expected paths for up to 100 lights")
    clean = {}
    for dev_id, points in paths.items():
        if not isinstance(points, list) or len(points) > MAX_POINTS:
            raise web.HTTPBadRequest(text=f"a path has up to {MAX_POINTS} points")
        pts = []
        for i, point in enumerate(points):
            # [x, y], or [x, y, n] when the stretch from the previous point is out of view
            # (round the back of the house, or an extension lead) and holds n bulbs.
            try:
                if not isinstance(point, list) or len(point) not in (2, 3):
                    raise ValueError
                x, y = round(float(point[0]), 5), round(float(point[1]), 5)
                hidden = int(point[2]) if len(point) == 3 and i else None
            except (TypeError, ValueError):
                raise web.HTTPBadRequest(text="points are [x, y] or [x, y, hidden bulbs]")
            if not (0 <= x <= 1 and 0 <= y <= 1):
                raise web.HTTPBadRequest(text="points must be between 0 and 1")
            if hidden is not None and not 0 <= hidden <= MAX_BULBS:
                raise web.HTTPBadRequest(text=f"a hidden stretch has 0 to {MAX_BULBS} bulbs")
            pts.append([x, y] if hidden is None else [x, y, hidden])
        if pts:
            clean[str(dev_id)[:64]] = pts
    styles = body.get("styles") or {}
    if not isinstance(styles, dict) or len(styles) > 100:
        raise web.HTTPBadRequest(text="expected styles for up to 100 lights")
    styles = {str(k)[:64]: v for k, v in ((k, _clean_style(v)) for k, v in styles.items()) if v}
    # Pins: {light: {segment: how far along its path, 0 to 1}}, where a photo taken at an angle needs
    # a segment's bulbs somewhere other than evenly spread.
    pins = body.get("pins") or {}
    if not isinstance(pins, dict) or len(pins) > 100:
        raise web.HTTPBadRequest(text="expected pins for up to 100 lights")
    clean_pins = {}
    for dev_id, marks in pins.items():
        if not isinstance(marks, dict) or len(marks) > MAX_POINTS:
            raise web.HTTPBadRequest(text=f"a light has up to {MAX_POINTS} pins")
        try:
            got = {str(int(s)): round(min(max(float(t), 0), 1), 5) for s, t in marks.items()}
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="pins are a segment and a number from 0 to 1")
        if any(int(s) < 0 for s in got):
            raise web.HTTPBadRequest(text="pins are a segment and a number from 0 to 1")
        if got and str(dev_id)[:64] in clean:
            clean_pins[str(dev_id)[:64]] = got
    try:
        dim = min(max(float(body.get("dim", 0.5)), 0), 0.9)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="dim must be a number")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["house"] = {"paths": clean, "styles": styles, "pins": clean_pins, "dim": dim}
    storage.save_settings(settings)
    return web.json_response(_house(settings))


async def get_house_photo(request):
    p = request.app[STORAGE].house_photo()
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p)


async def put_house_photo(request):
    ext = PHOTO_TYPES.get(request.content_type)
    if ext is None:
        raise web.HTTPUnsupportedMediaType(text="send a JPEG, PNG or WebP photo")
    data = bytearray()
    while chunk := await request.content.read(1 << 16):
        data += chunk
        if len(data) > MAX_PHOTO:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_PHOTO, actual_size=len(data))
    if not data:
        raise web.HTTPBadRequest(text="no photo")
    request.app[STORAGE].save_house_photo(bytes(data), ext)
    return web.json_response({"ok": True})


async def delete_house_photo(request):
    request.app[STORAGE].delete_house_photo()
    return web.json_response({"ok": True})


PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


# player ------------------------------------------------------------------
# AI ---------------------------------------------------------------------------
def _ai_prefer(request) -> str | None:
    """Which writing AI you picked under Setup → AI, when both Claude and Home Assistant's are set up."""
    v = request.app[STORAGE].load_settings().get("ai_with")
    return v if v in ("claude", "ha") else None


async def ai_status(request):
    return web.json_response(await ai.status(request.app[HA], _ai_prefer(request)))


async def put_ai_with(request):
    """{with: "claude" | "ha" | null}: which writing AI to use when both are set up."""
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    choice = body.get("with") if isinstance(body, dict) else "?"
    if choice not in ("claude", "ha", None):
        raise web.HTTPBadRequest(text="pick claude or ha")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    if choice:
        settings["ai_with"] = choice
    else:
        settings.pop("ai_with", None)
    storage.save_settings(settings)
    return web.json_response(await ai.status(request.app[HA], choice))


async def ai_clips(request):
    """Clips for a request in words. The editor sends the show's context and checks the result."""
    return await _ai_request(request, ai.create_clips)


async def ai_presets(request):
    """Effect presets for a description in words. The editor sends the effects and checks the result."""
    return await _ai_request(request, ai.create_presets)


async def ai_sections(request):
    """Notes (and better names) for a song's sections. The editor sends what was measured in each
    and checks the result."""
    return await _ai_request(request, ai.create_section_notes)


async def ai_cuts(request):
    """Which of the Music editor's suggested cuts works best, and why. The editor checks the reply."""
    return await _ai_request(request, ai.rank_cuts)


async def ai_palettes(request):
    """Colour palettes for a description in words. The editor checks the colours that come back."""
    return await _ai_request(request, ai.create_palettes)


async def _ai_request(request, create):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict) or not isinstance(body.get("context"), dict):
        raise web.HTTPBadRequest(text="expected a request and its context")
    try:
        return web.json_response(await create(request.app[HA], str(body.get("request", "")), body["context"], _ai_prefer(request)))
    except ai.AIError as e:
        raise web.HTTPBadRequest(text=str(e)[:1].upper() + str(e)[1:])


async def player_status(request):
    return web.json_response(request.app[RUNNER].status())


async def player_play(request):
    body = await request.json()
    if body.get("scene"):  # an Advanced scene from the Show editor, from its playhead
        scene_id = str(body["scene"])
        if not valid_id(scene_id):
            raise web.HTTPBadRequest(text="bad scene id")
        await stop_tests(request.app)
        try:
            await request.app[RUNNER].play_scene(scene_id, position=max(float(body.get("position", 0)), 0.0))
        except RunnerError as e:
            raise web.HTTPConflict(text=str(e))
        return web.json_response(request.app[RUNNER].status())
    show_id = str(body.get("show", ""))
    if not valid_id(show_id):
        raise web.HTTPBadRequest(text="bad show id")
    await stop_tests(request.app)
    runner = request.app[RUNNER]
    try:
        await runner.play(show_id, media_player=body.get("media_player") or None,
                          position=float(body.get("position", 0)),
                          offset=float(body.get("offset", 0)))
    except RunnerError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response(runner.status())


async def player_sync(request):
    body = await request.json()
    runner = request.app[RUNNER]
    drift = 0.0
    # A speaker sets its own pace; a sync meant for another show (a Show player page still on the
    # last song) is ignored.
    if not runner.media_player and body.get("show", runner.player.show_id) == runner.player.show_id:
        drift = request.app[PLAYER].sync(float(body.get("position", 0)))
    return web.json_response({**runner.status(), "drift": round(drift, 4)})


async def player_frame(request):
    """What's on the lights right now: {playing, tracks: [{device, segments}], rgb (base64)}."""
    now = request.app[PLAYER].frame_now()
    if now is None:
        return web.json_response({"playing": False, "tracks": [], "rgb": ""}, headers={"Cache-Control": "no-store"})
    tracks, rgb = now
    return web.json_response({"playing": True, "tracks": tracks, "rgb": base64.b64encode(rgb).decode()},
                             headers={"Cache-Control": "no-store"})


async def player_stop(request):
    """Stops what's on. {"show": id} stops it only if that show is what's playing (the editor)."""
    show = None
    if request.can_read_body:
        try:
            body = await request.json()
        except ValueError:
            body = None
        if isinstance(body, dict) and isinstance(body.get("show"), str):
            show = body["show"]
    await request.app[RUNNER].stop(show)
    return web.json_response(request.app[RUNNER].status())


async def run_command(request):
    """The same commands automations send, for trying them from the editor or curl."""
    try:
        result = await commands.handle(request.app[RUNNER], await request.text())
    except (ValueError, RunnerError) as e:
        raise web.HTTPBadRequest(text=str(e))
    return web.json_response({"result": result, **request.app[RUNNER].status()})


# export, import and start afresh ----------------------------------------
async def export_backup(request):
    data = backup.export(request.app[STORAGE].config_dir, __version__)
    name = f"haliday-show-{time.strftime('%Y-%m-%d')}.zip"
    return web.Response(body=data, content_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def _replace_data(app, reason: str, data: bytes | None) -> dict:
    """Keeps a copy of what's there, then restores `data` (an export) or, with None, clears it all."""
    config = app[STORAGE].config_dir
    if data is not None:
        backup.check(data)  # refuse a bad file before anything changes
    await app[RUNNER].stop()
    app[RUNNER].scene = None  # its scene may not be there afterwards
    kept = backup.keep_copy(config, __version__, reason)
    restored = 0
    if data is None:
        backup.clear(config)
    else:
        restored = backup.restore(config, data)
        migrate.fill_device_kinds(app[STORAGE])  # an export from before lights had a kind
        migrate.retire_govee_extras(app[STORAGE])  # or from before 0.2.207's Govee clear-out
    app[MQTT].refresh()
    await app[PUBLIC].apply()
    return {"ok": True, "kept": kept, "restored": restored}


async def import_backup(request):
    data = bytearray()
    while chunk := await request.content.read(1 << 16):
        data += chunk
        if len(data) > MAX_UPLOAD:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=len(data))
    try:
        return web.json_response(await _replace_data(request.app, "import", bytes(data)))
    except backup.BackupError as e:
        raise web.HTTPBadRequest(text=f"Couldn't import: {e}")


async def import_backup_part(request):
    """A backup over 16 MB, in pieces (Home Assistant's ingress proxy refuses bigger requests)."""
    part, size, done = await _receive_part(request, request.app[STORAGE].upload_dir)
    if not done:
        return web.json_response({"received": size})
    try:
        data = await asyncio.to_thread(part.read_bytes)
    finally:
        part.unlink(missing_ok=True)
    try:
        return web.json_response(await _replace_data(request.app, "import", data))
    except backup.BackupError as e:
        raise web.HTTPBadRequest(text=f"Couldn't import: {e}")


async def start_afresh(request):
    return web.json_response(await _replace_data(request.app, "fresh-start", None))


async def list_copies(request):
    return web.json_response(backup.copies(request.app[STORAGE].config_dir))


async def restore_copy(request):
    p = backup.copy_path(request.app[STORAGE].config_dir, request.match_info["name"])
    if p is None:
        raise web.HTTPNotFound(text="that copy has gone")
    try:
        return web.json_response(await _replace_data(request.app, "import", p.read_bytes()))
    except backup.BackupError as e:
        raise web.HTTPBadRequest(text=f"Couldn't restore that copy: {e}")


async def delete_copy(request):
    p = backup.copy_path(request.app[STORAGE].config_dir, request.match_info["name"])
    if p is None:
        raise web.HTTPNotFound(text="that copy has gone")
    p.unlink(missing_ok=True)
    return web.json_response(backup.copies(request.app[STORAGE].config_dir))


async def download_copy(request):
    p = backup.copy_path(request.app[STORAGE].config_dir, request.match_info["name"])
    if p is None:
        raise web.HTTPNotFound(text="that copy has gone")
    return web.FileResponse(p, headers={"Content-Disposition": f'attachment; filename="{p.name}"'})


# app ---------------------------------------------------------------------
def make_app(config_dir: Path, media_dir: Path, *, allow_all: bool = False, password: str = "",
             read_stdin: bool = False) -> web.Application:
    report.keep_recent()  # the last warnings and errors, for Report a problem
    app = web.Application(middlewares=[ingress_only], client_max_size=MAX_UPLOAD)
    app.on_response_prepare.append(no_cache_static)
    app[ALLOW_ALL] = allow_all
    app[PASSWORD] = password
    try:
        migrate.import_old(config_dir, media_dir)
    except OSError as e:
        logging.getLogger(__name__).error("couldn't import from the old add-on: %s", e)
    app[STORAGE] = Storage(config_dir, media_dir)
    try:
        migrate.fill_device_kinds(app[STORAGE])
    except OSError as e:
        logging.getLogger(__name__).error("couldn't mark saved lights as Govee: %s", e)
    try:
        migrate.retire_govee_extras(app[STORAGE])
    except OSError as e:
        logging.getLogger(__name__).error("couldn't move lights off the old Govee protocols: %s", e)
    try:
        migrate.splits_to_parts(app[STORAGE])
    except OSError as e:
        logging.getLogger(__name__).error("couldn't move split vocals into their songs: %s", e)
    app[TESTS] = {}
    app[VIDEOS] = video.Exports(songcopy.converter)
    # Split vocals' files, kept in the temporary folder: one per config folder, so two installs on one
    # machine (or the tests) don't share half-made ones.
    app[STEMS] = StemFiles(Path(tempfile.gettempdir()) / f"haliday-split-vocals-{hashlib.sha1(str(config_dir).encode()).hexdigest()[:8]}")
    app[UPLOADING] = set()
    app[PREVIEWS] = {}
    app[LISTENING] = {"listener": None, "options": {}}
    app[LAB] = Lab()

    async def lifecycle(app):
        app[OUTPUT] = Output()
        app[OUTPUT].start()
        app[PLAYER] = Player(app[OUTPUT])
        app[HA] = HomeAssistant()
        app[OUTPUT].ha = app[HA]
        app[RUNNER] = Runner(app[STORAGE], app[PLAYER], app[HA])
        app[MQTT] = MqttBridge(app[RUNNER])
        app[RUNNER].seasons_changed = app[MQTT].refresh
        app[HUB] = integration.Hub(app[RUNNER])
        app[MQTT].on_refresh.append(app[HUB].refresh)
        app[HUB].released = app[MQTT].refresh
        app[RUNNER].on_event = app[HUB].emit
        app[HUB].extras = lambda: _integration_extras(app)
        app[SCHEDULER] = schedule.Scheduler(app[STORAGE], app[RUNNER])
        app[LIVE] = LiveMusic(lambda: {d["ip"]: d.get("name") for d in app[STORAGE].load_devices() if d.get("ip")})
        await app[LIVE].start()
        app[RUNNER].live = app[LIVE]  # for scenes with React to music
        app[PUBLIC] = public.PublicSite(app[STORAGE], app[RUNNER], lambda: app[SCHEDULER].where()[0])
        await app[PUBLIC].apply()
        try:  # what was on before a restart carries on
            await app[SCHEDULER].resume()
        except Exception:
            log.exception("couldn't pick up what was playing before the restart")
        app[BACKGROUND] = [asyncio.create_task(app[SCHEDULER].run()), asyncio.create_task(app[RUNNER].watch_scene()),
                           asyncio.create_task(app[HUB].run())]
        app[BACKGROUND].append(asyncio.create_task(integration.announce(app[HA], int(os.environ.get("HALIDAY_SHOW_PORT", "8099")))))
        if read_stdin:
            app[BACKGROUND].append(asyncio.create_task(commands.read_stdin(app[RUNNER])))
        if (broker := await app[HA].mqtt_service()):
            app[BACKGROUND].append(asyncio.create_task(app[MQTT].run(broker)))
        else:
            log.info("no MQTT broker found; show entities are off (automations can use app stdin)")
        yield
        for task in app[BACKGROUND]:
            task.cancel()
        await app[PUBLIC].close()
        app[LIVE].close()
        await stop_tests(app)
        app[VIDEOS].close()
        for task in app[STEMS].tasks.values():
            task.cancel()
        await app[RUNNER].close()
        await app[OUTPUT].close()
        await app[HA].close()

    app.cleanup_ctx.append(lifecycle)

    async def close_integrations(app):
        """Home Assistant's open connection would otherwise hold up stopping; it reconnects by itself."""
        for ws in list(app[HUB].clients) if HUB in app else ():
            await ws.close(code=1001, message=b"restarting")

    app.on_shutdown.append(close_integrations)
    r = app.router
    r.add_get("/", index)
    r.add_get("/player", show_player_page)
    r.add_static("/static/", STATIC)
    r.add_get("/api/info", info)
    r.add_get("/api/report", get_report)
    r.add_get("/api/integration", integration_state)
    r.add_get("/api/integration/ws", integration_ws)
    r.add_get("/api/integration/library", integration_library)
    r.add_get("/api/integration/image/{id}", integration_image)
    r.add_post("/api/integration/command", integration_command)
    r.add_post("/api/integration/claim", integration_claim)
    r.add_post("/api/video", video_start)
    r.add_post("/api/video/{id}/part", video_part)
    r.add_post("/api/video/{id}/finish", video_finish)
    r.add_get("/api/video/{id}", video_status)
    r.add_get("/api/video/{id}/file", video_file)
    r.add_post("/api/video/{id}/cancel", video_cancel)
    r.add_get("/api/devices", get_devices)
    r.add_put("/api/devices", put_devices)
    r.add_post("/api/devices/scan", scan_devices)
    r.add_post("/api/wled/info", wled_info)
    r.add_post("/api/wled/scan", wled_scan)
    r.add_post("/api/twinkly/info", twinkly_info)
    r.add_get("/api/ha/entities", ha_entities)
    r.add_post("/api/devices/test", test_device)
    r.add_post("/api/devices/probe", probe_device)
    r.add_post("/api/devices/preview", preview_device)
    r.add_post("/api/diagnostics/listen", start_listening)
    r.add_get("/api/diagnostics/listen", listening_status)
    r.add_post("/api/lab/send", lab_send)
    r.add_post("/api/lab/stop", lab_stop)
    r.add_get("/api/lab", lab_status)
    r.add_get("/api/shows", list_shows)
    r.add_get("/api/shows/archived", list_archived_shows)  # before /api/shows/{id}
    r.add_post("/api/shows", create_show)
    r.add_get("/api/shows/{id}", get_show)
    r.add_put("/api/shows/{id}", put_show)
    r.add_delete("/api/shows/{id}", delete_show)
    r.add_put("/api/shows/{id}/baked", put_baked)
    r.add_get("/api/shows/{id}/baked/key", get_baked_key)
    r.add_post("/api/shows/{id}/baked/part", put_baked_part)
    r.add_post("/api/shows/{id}/duplicate", duplicate_show)
    r.add_post("/api/shows/{id}/rename", rename_show)
    r.add_post("/api/shows/{id}/mark", mark_show)
    r.add_get("/api/shows/{id}/picture", get_show_picture)
    r.add_put("/api/shows/{id}/picture", put_show_picture)
    r.add_delete("/api/shows/{id}/picture", delete_show_picture)
    r.add_post("/api/shows/{id}/archive", archive_show)
    r.add_post("/api/shows/{id}/restore", restore_show)
    r.add_get("/api/audio", list_audio)
    r.add_post("/api/audio", upload_audio)
    r.add_get("/api/stems/files/{name}", get_stem_file)
    r.add_post("/api/stems/prepare", post_stems_prepare)
    r.add_post("/api/audio/part", upload_audio_part)
    r.add_get("/api/samples", list_samples)
    r.add_delete("/api/samples", delete_sample)
    r.add_get("/api/audio/file", get_audio)
    r.add_get("/api/audio/cover", get_audio_cover)
    r.add_get("/api/songs", list_songs)
    r.add_get("/api/songs/archived", list_archived_songs)
    r.add_get("/api/songs/users", song_users)
    r.add_post("/api/songs/archive", archive_song)
    r.add_post("/api/songs/restore", restore_song)
    r.add_post("/api/songs/rename", rename_song)
    r.add_post("/api/songs/duplicate", duplicate_song)
    r.add_post("/api/songs/delete", delete_song)
    r.add_get("/api/audio/info", get_song_info)
    r.add_put("/api/audio/info", put_song_info)
    r.add_get("/api/audio/palette", get_song_palette)
    r.add_put("/api/audio/palette", put_song_palette)
    r.add_get("/api/light-roles", get_light_roles)
    r.add_put("/api/light-roles", put_light_roles)
    r.add_get("/api/audio/parts", get_song_parts)
    r.add_post("/api/audio/parts", put_song_part)
    r.add_get("/api/audio/lyrics", get_song_lyrics)
    r.add_put("/api/audio/lyrics", put_song_lyrics)
    r.add_get("/api/audio/drums", get_song_drums)
    r.add_put("/api/audio/drums", put_song_drums)
    r.add_get("/api/audio/sounds", get_song_sounds)
    r.add_put("/api/audio/sounds", put_song_sounds)
    r.add_get("/api/audio/voice", get_song_voice)
    r.add_put("/api/audio/voice", put_song_voice)
    r.add_get("/api/seasons", get_seasons)
    r.add_put("/api/seasons", put_seasons)
    r.add_get("/api/pictures", list_pictures)
    r.add_post("/api/pictures", create_picture)
    r.add_get("/api/pictures/{id}", get_picture)
    r.add_post("/api/pictures/{id}/rename", rename_picture)
    r.add_delete("/api/pictures/{id}", delete_picture)
    r.add_get("/api/pictures/{id}/phone", get_picture_phone)
    r.add_get("/api/faces", list_faces)
    r.add_post("/api/faces", create_face)
    r.add_put("/api/faces/{id}", put_face)
    r.add_delete("/api/faces/{id}", delete_face)
    r.add_get("/api/drafts", list_drafts)
    r.add_post("/api/drafts", create_draft)
    r.add_get("/api/drafts/{id}", get_draft)
    r.add_put("/api/drafts/{id}", put_draft)
    r.add_delete("/api/drafts/{id}", delete_draft)
    r.add_post("/api/drafts/{id}/rename", rename_draft)
    r.add_get("/api/speakers", list_speakers)
    r.add_put("/api/speakers/delay", put_speaker_delay)
    r.add_put("/api/speakers/show", put_show_speaker)
    r.add_get("/api/speakers/late", get_late_speaker)
    r.add_put("/api/speakers/late", put_late_speaker)
    r.add_post("/api/speakers/test", test_speaker)
    r.add_post("/api/speakers/remove", remove_speaker)
    r.add_get("/api/palettes", get_palettes)
    r.add_put("/api/palettes", put_palettes)
    r.add_get("/api/presets", get_presets)
    r.add_put("/api/presets", put_presets)
    r.add_get("/api/library-folders", get_library_folders)
    r.add_put("/api/library-folders", put_library_folders)
    r.add_get("/api/song-folders", get_song_folders)
    r.add_put("/api/song-folders", put_song_folders)
    r.add_get("/api/sample-folders", get_sample_folders)
    r.add_put("/api/sample-folders", put_sample_folders)
    r.add_get("/api/light-groups", get_light_groups)
    r.add_put("/api/light-groups", put_light_groups)
    r.add_get("/api/playlists", get_playlists)
    r.add_put("/api/playlists", put_playlists)
    r.add_post("/api/playlists/{id}/play", play_playlist)
    r.add_get("/api/live-music", get_live_music)
    r.add_put("/api/live-music", put_live_music)
    r.add_get("/api/house-scenes", list_scenes)
    r.add_post("/api/house-scenes", create_scene)
    r.add_get("/api/house-scenes/{id}", get_scene)
    r.add_put("/api/house-scenes/{id}", put_scene)
    r.add_delete("/api/house-scenes/{id}", delete_scene)
    r.add_put("/api/house-scenes/{id}/baked", put_scene_baked)
    r.add_put("/api/house-scenes/{id}/live", put_scene_live)
    r.add_delete("/api/house-scenes/{id}/live", delete_scene_live)
    r.add_post("/api/house-scenes/{id}/baked/part", put_scene_baked_part)
    r.add_post("/api/house-scenes/{id}/play", play_scene)
    r.add_post("/api/house-scenes/{id}/stop", stop_scene)
    r.add_get("/api/blocks", get_blocks)
    r.add_put("/api/blocks/{id}/baked", put_block)
    r.add_post("/api/blocks/{id}/baked/part", put_block_part)
    r.add_post("/api/preshow/run", preshow_run)
    r.add_post("/api/preshow/timing", preshow_timing)
    r.add_get("/api/preshow/last", get_preshow_last)
    r.add_put("/api/preshow/last", put_preshow_last)
    r.add_get("/api/schedule", get_schedule)
    r.add_get("/api/schedule/week", get_schedule_week)
    r.add_put("/api/schedule", put_schedule)
    r.add_get("/api/public", get_public)
    r.add_put("/api/public", put_public)
    r.add_post("/api/public/clear", clear_public_queue)
    r.add_post("/api/public/code", new_public_code)
    r.add_get("/api/public/picture", get_public_picture)
    r.add_get("/api/public/qr.svg", public_qr)
    r.add_get("/sign", sign_page)
    r.add_get("/public-preview/", public_preview_page)
    r.add_get("/public-preview/{name:(public\\.js|public\\.css|colours\\.js|listensync\\.js|icons\\.js)}", public_preview_page)
    r.add_get("/public-preview/api/state", public_preview_state)
    r.add_get("/public-preview/picture", public_preview_picture)
    r.add_get("/public-preview/cover", public_preview_cover)
    r.add_put("/api/public/picture", put_public_picture)
    r.add_put("/api/location", put_location)
    r.add_get("/api/house", get_house)
    r.add_put("/api/house", put_house)
    r.add_get("/api/house/photo", get_house_photo)
    r.add_put("/api/house/photo", put_house_photo)
    r.add_delete("/api/house/photo", delete_house_photo)
    r.add_get("/api/backup", export_backup)
    r.add_post("/api/backup", import_backup)
    r.add_post("/api/backup/part", import_backup_part)
    r.add_post("/api/backup/reset", start_afresh)
    r.add_get("/api/backup/copies", list_copies)
    r.add_get("/api/backup/copies/{name}", download_copy)
    r.add_delete("/api/backup/copies/{name}", delete_copy)
    r.add_post("/api/backup/copies/{name}/restore", restore_copy)
    r.add_post("/api/command", run_command)
    r.add_get("/api/ai", ai_status)
    r.add_put("/api/ai/with", put_ai_with)
    r.add_post("/api/ai/clips", ai_clips)
    r.add_post("/api/ai/presets", ai_presets)
    r.add_post("/api/ai/palettes", ai_palettes)
    r.add_post("/api/ai/sections", ai_sections)
    r.add_post("/api/ai/cuts", ai_cuts)
    r.add_get("/api/player", player_status)
    r.add_post("/api/player/play", player_play)
    r.add_post("/api/player/sync", player_sync)
    r.add_post("/api/player/stop", player_stop)
    r.add_get("/api/player/frame", player_frame)
    return app
