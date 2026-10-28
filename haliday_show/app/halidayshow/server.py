"""HTTP API and editor for the Home Assistant ingress panel.

All URLs the editor uses are relative, because ingress serves the panel from
/api/hassio_ingress/<token>/.
"""
import asyncio
import base64
import binascii
import contextlib
import datetime
import hmac
import ipaddress
import json
import logging
import math
import os
import re
import time
from pathlib import Path

from aiohttp import web

from . import __version__, ai, archive, backup, commands, discovery, e131, migrate, playlists, public, scenelib, schedule, twinkly, wled
from .baked import BakedError, decode
from .ha import HAError, HomeAssistant
from .lab import (KINDS as LAB_KINDS, MAX_REPEAT as LAB_MAX_REPEAT, MAX_STEPS as LAB_MAX_STEPS, Lab, LabError,
                  Step as LabStep, build as lab_build)
from .listen import Listener
from .livemusic import LiveMusic
from .mqtt import MqttBridge
from .output import PROBE_MAX, LivePreview, Output, address, linked, run_hold, run_probe, run_test_pattern
from .player import Player
from .protocol import LONG_PROTOCOLS, PROTOCOLS
from .runner import Runner, RunnerError
from .storage import Storage, slugify, valid_id

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PEER = "172.30.32.2"  # the Supervisor's ingress proxy
MAX_UPLOAD = 200 * 1024 * 1024
MAX_BULBS = 2000  # bulbs on one light
MAX_SEGMENTS = 1000  # per light; the Christmas String Lights 2 have 300 bulbs
MAX_FIRST_LED = 100000  # where a light starts on a pixel controller; DDP offsets go far beyond this
KINDS = ("govee", "wled", "ddp", "e131", "ha", "twinkly")
_HA_ENTITY = re.compile(r"^(light|switch)\.[a-z0-9_]{1,200}$")

OUTPUT = web.AppKey("output", Output)
PLAYER = web.AppKey("player", Player)
STORAGE = web.AppKey("storage", Storage)
TESTS = web.AppKey("tests", dict)
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


def _clean_parts(parts, segments: int) -> list:
    """A light split into parts: each a named run of its segments (1-based, inclusive). Parts can't
    overlap; segments outside every part stay off in shows."""
    if not parts:
        return []
    if not isinstance(parts, list) or len(parts) > MAX_PARTS:
        raise web.HTTPBadRequest(text=f"parts must be a list of up to {MAX_PARTS}")
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
    # Realtime messages hold the segment count in one byte; the other protocols can go further.
    most = MAX_SEGMENTS if protocol in LONG_PROTOCOLS or kind != "govee" else 255
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
    if kind == "ddp":
        # A controller can drive several lights from one IP, each from its own first LED.
        try:
            first = int(d["first"]) if d.get("first") is not None else 1
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="first must be a number")
        if not 1 <= first <= MAX_FIRST_LED:
            raise web.HTTPBadRequest(text=f"first must be 1-{MAX_FIRST_LED}")
        extra["first"] = first
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
            "reverse": bool(d.get("reverse")), "gradient": kind == "govee" and bool(d.get("gradient")),
            "protocol": protocol, "brightness": brightness, "bulbs": bulbs,
            "parts": _clean_parts(d.get("parts"), segments),
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
    request.app[STORAGE].save_devices(devices)
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
    return web.json_response({**found, "max": MAX_SEGMENTS})


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
    if rgb is None:
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


def _not_archived(request, show_id: str):
    # A second browser still editing a show that's been archived mustn't bring a copy back to life.
    if archive.show_exists(request.app[STORAGE], show_id, archived=True):
        raise web.HTTPConflict(text="that show has been archived; restore it under Library → Shows to edit it")


async def put_show(request):
    _not_archived(request, _show_id(request))
    show = await request.json()
    if not isinstance(show, dict) or not isinstance(show.get("tracks", []), list):
        raise web.HTTPBadRequest(text="bad show")
    request.app[STORAGE].save_show(_show_id(request), show)
    return web.json_response({"ok": True})


async def put_baked(request):
    show_id = _show_id(request)
    _not_archived(request, show_id)
    blob = await request.read()
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_baked(show_id, blob)
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
    return web.json_response({"source": "media", "path": str(dest.relative_to(storage.media_dir))})


# Big uploads in pieces: Home Assistant's ingress proxy refuses any request over 16 MB, so the editor
# sends a big song, or a long show's baked frames, in parts. Each part says where it goes (offset), so
# a lost or repeated part is caught, and one upload is written by one request at a time. Nothing
# appears until the last part arrives.
MAX_PART = 12 * 1024 * 1024
MAX_OPEN_UPLOADS = 8  # unfinished uploads at once, so they can't fill the disk
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
    return web.json_response({"source": "media", "path": str(dest.relative_to(storage.media_dir))})


async def put_baked_part(request):
    """A show's baked frames in parts, for long shows (see _receive_part)."""
    show_id = _show_id(request)
    _not_archived(request, show_id)
    storage = request.app[STORAGE]
    part, size, done = await _receive_part(request, storage.shows_dir)
    if not done:
        return web.json_response({"received": size})
    blob = part.read_bytes()
    part.unlink(missing_ok=True)
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    storage.save_baked(show_id, blob)
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
    if "marks" in body:
        marks = _clean_marks(body["marks"])
        if marks is None:
            return None
        out["marks"] = marks
    return out


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


def _clean_eq(eq) -> dict | None:
    """Bass, mid and treble faders (dB, -24 meaning off) for the song or a layer, with changes at
    points in the song: {bass, mid, treble, changes: [{anchor: {song, t}, bass, mid, treble, glide}]}."""
    if not isinstance(eq, dict):
        return None
    out = {b: _eq_band(eq.get(b, 0)) for b in EQ_BANDS}
    changes = eq.get("changes", [])
    if None in out.values() or not isinstance(changes, list) or len(changes) > MAX_EQ_CHANGES:
        return None
    out["changes"] = []
    for c in changes:
        if not isinstance(c, dict) or not isinstance(c.get("anchor"), dict):
            return None
        bands = {b: _eq_band(c.get(b, 0)) for b in EQ_BANDS}
        song, t, glide = _song_ref(c["anchor"].get("song")), _seconds(c["anchor"].get("t"), 86400), _seconds(c.get("glide", 1), 30)
        if None in (*bands.values(), song, t, glide):
            return None
        out["changes"].append({"anchor": {"song": song, "t": t}, **bands, "glide": glide})
    return out


def _clean_layers(layers) -> list[dict] | None:
    """A draft's layers: [{name, gain, duck, matchTempo, eq (all optional), clips: [{song, start, end,
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
        duck, match = layer.get("duck", False), layer.get("matchTempo", False)
        eq = _clean_eq(layer["eq"]) if layer.get("eq") is not None else None
        if not isinstance(duck, bool) or not isinstance(match, bool) or (layer.get("eq") is not None and eq is None):
            return None
        out.append({"name": " ".join(layer.get("name", "").split())[:40], "gain": gain, "clips": clean})
        if duck:
            out[-1]["duck"] = True
        if match:
            out[-1]["matchTempo"] = True
        if eq is not None:
            out[-1]["eq"] = eq
    return out


def _clean_draft(body) -> dict | None:
    """A Music editor draft: {name, base, pieces: [{song, start, end}], crossfade, fadeIn, fadeOut,
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
MAX_FOLDERS, MAX_FOLDER_SONGS = 100, 2000
_FOLDER_ID = re.compile(r"^[a-z0-9-]{1,40}$")


def _clean_song_folders(body) -> list[dict]:
    if not isinstance(body, list) or len(body) > MAX_FOLDERS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_FOLDERS} folders")
    out, ids, names, placed = [], set(), set(), set()
    for f in body:
        if not isinstance(f, dict):
            raise web.HTTPBadRequest(text="each folder needs an id, a name and its songs")
        fid, name = str(f.get("id", "")), " ".join(str(f.get("name", "")).split())[:60]
        songs = f.get("songs")
        if not _FOLDER_ID.match(fid) or fid in ids or not name or name.lower() in names \
                or not isinstance(songs, list) or len(songs) > MAX_FOLDER_SONGS:
            raise web.HTTPBadRequest(text="each folder needs its own id and name, and a list of songs")
        ids.add(fid)
        names.add(name.lower())
        kept = []
        for s in songs:
            src, path = (s.get("source"), s.get("path")) if isinstance(s, dict) else (None, None)
            if not isinstance(src, str) or not isinstance(path, str) or not 0 < len(src) <= 20 or not 0 < len(path) <= 500:
                raise web.HTTPBadRequest(text="each song in a folder needs its source and path")
            if (src, path) in placed:  # a song is in one folder at most
                continue
            placed.add((src, path))
            kept.append({"source": src, "path": path})
        out.append({"id": fid, "name": name, "songs": kept})
    return out


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


async def get_schedule(request):
    """HA-liday Show's clock, and when each scheduled playlist next starts."""
    return web.json_response(request.app[SCHEDULER].state())


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
    return web.json_response(request.app[SCHEDULER].state())


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
def live_settings(storage) -> dict:
    """Setup → Settings → Live music: which WLED listens ("any", or its IP), and how loud counts as music."""
    s = storage.load_settings().get("live_music") or {}
    source = s.get("source") if isinstance(s.get("source"), str) and s.get("source") else "any"
    level = s.get("from") if isinstance(s.get("from"), int) and 0 <= s.get("from") <= 100 else 15
    return {"source": source, "from": level}


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
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_scene_baked(scene_id, blob)
    return web.json_response({"ok": True, "bytes": len(blob)})


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
            "has_picture": app[STORAGE].public_picture() is not None,
            # Changes whenever the picture does, so the editor's thumbnail reloads after a new one.
            "picture_v": public.picture_version(app[STORAGE], (public.load(app[STORAGE]) or public.clean(None))["look"]),
            # Every word visitors read, grouped, with the wording each starts with, for the Words tab.
            "word_groups": public.WORD_GROUPS,
            "now": runner.public_now["name"] if runner.public_now else None,
            "waiting": [{"name": r["name"], "wait": w} for r, w in zip(runner.requests, waits)]}


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
    storage.save_public_picture(bytes(data), ext)
    settings = storage.load_settings()
    p = public.load(storage) or public.clean(None)
    settings["public"] = {**p, "look": {**p["look"], "picture": "upload"}}
    storage.save_settings(settings)
    await request.app[PUBLIC].apply()
    return web.json_response(_public_view(request.app))


async def get_public_picture(request):
    p = request.app[STORAGE].public_picture()
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})


# A preview of the visitors' page for the Public page tab, served here (behind Home Assistant's
# login) rather than on the public port: the same page, shown as visitors with the code see it, but it
# can't start or cancel anything.
async def public_preview_page(request):
    name = request.match_info.get("name") or "index.html"
    if name not in ("index.html", "public.js", "public.css", "colours.js"):
        raise web.HTTPNotFound()
    return web.FileResponse(public.PAGE / name, headers={"Cache-Control": "no-cache"})


async def public_preview_state(request):
    st = request.app[STORAGE]
    p = public.load(st) or public.clean(None)
    view = public.state(st, request.app[RUNNER], None, p["code"], where=request.app[SCHEDULER].where()[0])
    return web.json_response({**view, "preview": True},
                             headers={"Cache-Control": "no-store"})


async def public_preview_picture(request):
    # The copy visitors get, so a picture they won't see doesn't show in the preview either.
    st = request.app[STORAGE]
    path = public.picture_path(st, (public.load(st) or public.clean(None))["look"])
    try:
        data = public.stripped_picture(path) if path is not None else None
    except OSError:
        data = None
    if data is None:
        raise web.HTTPNotFound()
    return web.Response(body=data, content_type=public.PICTURE_TYPES.get(path.suffix.lower(), "application/octet-stream"),
                        headers={"Cache-Control": "no-cache"})


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
async def ai_status(request):
    return web.json_response(await ai.status(request.app[HA]))


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
        return web.json_response(await create(request.app[HA], str(body.get("request", "")), body["context"]))
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


async def download_copy(request):
    p = backup.copy_path(request.app[STORAGE].config_dir, request.match_info["name"])
    if p is None:
        raise web.HTTPNotFound(text="that copy has gone")
    return web.FileResponse(p, headers={"Content-Disposition": f'attachment; filename="{p.name}"'})


# app ---------------------------------------------------------------------
def make_app(config_dir: Path, media_dir: Path, *, allow_all: bool = False, password: str = "",
             read_stdin: bool = False) -> web.Application:
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
    app[TESTS] = {}
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
        app[SCHEDULER] = schedule.Scheduler(app[STORAGE], app[RUNNER])
        app[BACKGROUND] = [asyncio.create_task(app[SCHEDULER].run()), asyncio.create_task(app[RUNNER].watch_scene())]
        app[LIVE] = LiveMusic(lambda: {d["ip"]: d.get("name") for d in app[STORAGE].load_devices() if d.get("ip")})
        await app[LIVE].start()
        app[PUBLIC] = public.PublicSite(app[STORAGE], app[RUNNER], lambda: app[SCHEDULER].where()[0])
        await app[PUBLIC].apply()
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
        await app[RUNNER].close()
        await app[OUTPUT].close()
        await app[HA].close()

    app.cleanup_ctx.append(lifecycle)
    r = app.router
    r.add_get("/", index)
    r.add_get("/player", show_player_page)
    r.add_static("/static/", STATIC)
    r.add_get("/api/info", info)
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
    r.add_post("/api/shows/{id}/baked/part", put_baked_part)
    r.add_post("/api/shows/{id}/duplicate", duplicate_show)
    r.add_post("/api/shows/{id}/rename", rename_show)
    r.add_post("/api/shows/{id}/archive", archive_show)
    r.add_post("/api/shows/{id}/restore", restore_show)
    r.add_get("/api/audio", list_audio)
    r.add_post("/api/audio", upload_audio)
    r.add_post("/api/audio/part", upload_audio_part)
    r.add_get("/api/samples", list_samples)
    r.add_delete("/api/samples", delete_sample)
    r.add_get("/api/audio/file", get_audio)
    r.add_get("/api/songs", list_songs)
    r.add_get("/api/songs/archived", list_archived_songs)
    r.add_get("/api/songs/users", song_users)
    r.add_post("/api/songs/archive", archive_song)
    r.add_post("/api/songs/restore", restore_song)
    r.add_post("/api/songs/delete", delete_song)
    r.add_get("/api/audio/info", get_song_info)
    r.add_put("/api/audio/info", put_song_info)
    r.add_get("/api/drafts", list_drafts)
    r.add_post("/api/drafts", create_draft)
    r.add_get("/api/drafts/{id}", get_draft)
    r.add_put("/api/drafts/{id}", put_draft)
    r.add_delete("/api/drafts/{id}", delete_draft)
    r.add_post("/api/drafts/{id}/rename", rename_draft)
    r.add_get("/api/speakers", list_speakers)
    r.add_put("/api/speakers/delay", put_speaker_delay)
    r.add_put("/api/speakers/show", put_show_speaker)
    r.add_post("/api/speakers/test", test_speaker)
    r.add_post("/api/speakers/remove", remove_speaker)
    r.add_get("/api/palettes", get_palettes)
    r.add_put("/api/palettes", put_palettes)
    r.add_get("/api/presets", get_presets)
    r.add_put("/api/presets", put_presets)
    r.add_get("/api/song-folders", get_song_folders)
    r.add_put("/api/song-folders", put_song_folders)
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
    r.add_post("/api/house-scenes/{id}/baked/part", put_scene_baked_part)
    r.add_post("/api/house-scenes/{id}/play", play_scene)
    r.add_post("/api/house-scenes/{id}/stop", stop_scene)
    r.add_get("/api/blocks", get_blocks)
    r.add_put("/api/blocks/{id}/baked", put_block)
    r.add_post("/api/blocks/{id}/baked/part", put_block_part)
    r.add_get("/api/schedule", get_schedule)
    r.add_get("/api/public", get_public)
    r.add_put("/api/public", put_public)
    r.add_post("/api/public/clear", clear_public_queue)
    r.add_post("/api/public/code", new_public_code)
    r.add_get("/api/public/picture", get_public_picture)
    r.add_get("/api/public/qr.svg", public_qr)
    r.add_get("/sign", sign_page)
    r.add_get("/public-preview/", public_preview_page)
    r.add_get("/public-preview/{name:(public\\.js|public\\.css|colours\\.js)}", public_preview_page)
    r.add_get("/public-preview/api/state", public_preview_state)
    r.add_get("/public-preview/picture", public_preview_picture)
    r.add_put("/api/public/picture", put_public_picture)
    r.add_put("/api/location", put_location)
    r.add_get("/api/house", get_house)
    r.add_put("/api/house", put_house)
    r.add_get("/api/house/photo", get_house_photo)
    r.add_put("/api/house/photo", put_house_photo)
    r.add_delete("/api/house/photo", delete_house_photo)
    r.add_get("/api/backup", export_backup)
    r.add_post("/api/backup", import_backup)
    r.add_post("/api/backup/reset", start_afresh)
    r.add_get("/api/backup/copies", list_copies)
    r.add_get("/api/backup/copies/{name}", download_copy)
    r.add_post("/api/backup/copies/{name}/restore", restore_copy)
    r.add_post("/api/command", run_command)
    r.add_get("/api/ai", ai_status)
    r.add_post("/api/ai/clips", ai_clips)
    r.add_post("/api/ai/presets", ai_presets)
    r.add_post("/api/ai/palettes", ai_palettes)
    r.add_post("/api/ai/sections", ai_sections)
    r.add_post("/api/ai/cuts", ai_cuts)
    r.add_get("/api/player", player_status)
    r.add_post("/api/player/play", player_play)
    r.add_post("/api/player/sync", player_sync)
    r.add_post("/api/player/stop", player_stop)
    return app
