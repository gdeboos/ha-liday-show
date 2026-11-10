"""The dashboard cards: served by the integration and loaded on every dashboard, so there's no Resources step.

Cards talk to Home Assistant only (entities, actions and the commands below), never to the app directly,
so they work for every user, on phones and away from home."""
from __future__ import annotations

from pathlib import Path

import asyncio
import base64
import logging

import voluptuous as vol
from aiohttp import web

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .client import CannotConnect, CommandFailed
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

URL = "/haliday_show_cards"
# The editor's own drawing code, so the House card draws your house exactly as the editor does. Only
# these files, which are on GitHub anyway; they hold no data.
DRAWING_CODE = {"house.js", "samplehouse.js", "lightwords.js", "matrix.js", "parts.js"}
SAMPLE_HOUSE = "sample-house.svg"  # drawn when you haven't added a photo of your house
FRAME_EVERY = 0.15  # seconds between live frames while a House card is open
FOLDER = Path(__file__).parent / "frontend"


async def async_setup_frontend(hass: HomeAssistant, version: str) -> None:
    await hass.http.async_register_static_paths([StaticPathConfig(URL, str(FOLDER), False)])
    if "frontend" in hass.config.components:  # always, in a real Home Assistant
        add_extra_js_url(hass, f"{URL}/cards.js?v={version}")
    websocket_api.async_register_command(hass, ws_entities)
    websocket_api.async_register_command(hass, ws_library)
    websocket_api.async_register_command(hass, ws_house)
    websocket_api.async_register_command(hass, ws_schedule)
    websocket_api.async_register_command(hass, ws_preshow)
    websocket_api.async_register_command(hass, ws_house_frames)
    hass.http.register_view(ImageView())
    hass.http.register_view(HousePhotoView())
    hass.http.register_view(QrView())
    hass.http.register_view(DrawingCodeView())


def _client(hass: HomeAssistant):
    entry = next((e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED), None)
    return entry.runtime_data.client if entry else None


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/entities"})
@callback
def ws_entities(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Our entities by what they are (player, next, ...), so cards find them even after you rename them."""
    out: dict = {"scenes": [], "seasons": []}
    for e in er.async_get(hass).entities.values():
        if e.platform != DOMAIN or not e.unique_id.startswith("haliday_show_") or e.disabled_by:
            continue
        key = e.unique_id[len("haliday_show_"):]
        if key.startswith("scene_"):
            out["scenes"].append(e.entity_id)
        elif key.startswith("season_"):
            out["seasons"].append(e.entity_id)
        else:
            out[key] = e.entity_id
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/library"})
@websocket_api.async_response
async def ws_library(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    client = _client(hass)
    if client is None:
        connection.send_error(msg["id"], "not_ready", "HA-liday Show isn't set up, or isn't answering")
        return
    try:
        connection.send_result(msg["id"], await client.library())
    except (CannotConnect, CommandFailed) as err:
        connection.send_error(msg["id"], "not_ready", f"HA-liday Show isn't answering: {err}")


class ImageView(HomeAssistantView):
    """A show's picture or cover art. Cards load it with a signed link (auth/sign_path)."""

    url = "/api/haliday_show/image/{show_id}"
    name = "api:haliday_show:image"
    requires_auth = True

    async def get(self, request: web.Request, show_id: str) -> web.Response:
        client = _client(request.app["hass"])
        if client is None or not show_id.replace("-", "").replace("_", "").isalnum():
            raise web.HTTPNotFound
        got = await client.image(show_id)
        if not got:
            raise web.HTTPNotFound
        return web.Response(body=got[0], content_type=got[1], headers={"Cache-Control": "private, max-age=300"})


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/schedule",
                                  vol.Optional("start"): vol.Match(r"^\d{4}-\d{2}-\d{2}$")})
@websocket_api.async_response
async def ws_schedule(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """The week ahead, for the Schedule card."""
    client = _client(hass)
    if client is None:
        connection.send_error(msg["id"], "not_ready", "HA-liday Show isn't set up, or isn't answering")
        return
    try:
        path = "/api/integration/schedule" + (f"?start={msg['start']}" if msg.get("start") else "")
        connection.send_result(msg["id"], await client.get(path))
    except (CannotConnect, CommandFailed) as err:
        connection.send_error(msg["id"], "not_ready", f"HA-liday Show isn't answering: {err}")


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/preshow/run"})
@websocket_api.async_response
async def ws_preshow(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Run the pre-show check for the Visitors and checks card: the result and what to look at."""
    client = _client(hass)
    if client is None:
        connection.send_error(msg["id"], "not_ready", "HA-liday Show isn't set up, or isn't answering")
        return
    try:
        connection.send_result(msg["id"], await client.preshow())
    except CommandFailed as err:
        connection.send_error(msg["id"], "busy", str(err))
    except CannotConnect as err:
        connection.send_error(msg["id"], "not_ready", f"HA-liday Show isn't answering: {err}")


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/house"})
@websocket_api.async_response
async def ws_house(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Where your lights are on the photo, and the lights themselves, for the House card."""
    client = _client(hass)
    if client is None:
        connection.send_error(msg["id"], "not_ready", "HA-liday Show isn't set up, or isn't answering")
        return
    try:
        house, devices = await asyncio.gather(client.get("/api/house"), client.get("/api/devices"))
    except (CannotConnect, CommandFailed) as err:
        connection.send_error(msg["id"], "not_ready", f"HA-liday Show isn't answering: {err}")
        return
    # Only what drawing needs: no addresses or other settings of your lights.
    keep = ("id", "name", "segments", "bulbs", "reverse", "brightness", "matrix", "parts", "whole", "planned")
    connection.send_result(msg["id"], {
        "house": {k: house.get(k) for k in ("paths", "styles", "pins", "dim", "photo")},
        "devices": [{k: d[k] for k in keep if k in d} for d in devices if isinstance(d, dict)],
    })


@websocket_api.websocket_command({vol.Required("type"): "haliday_show/house/frames"})
@callback
def ws_house_frames(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """What's on the lights, a few times a second, for as long as a House card is on screen. One feed is
    shared by every open card, and it stops when the last one goes."""
    feed = hass.data.setdefault(f"{DOMAIN}_frames", {"subs": {}, "task": None, "last": None})
    key = (id(connection), msg["id"])
    feed["subs"][key] = (connection, msg["id"])

    @callback
    def unsubscribe() -> None:
        feed["subs"].pop(key, None)
        if not feed["subs"] and feed["task"]:
            feed["task"].cancel()
            feed["task"] = None

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    if feed["last"] is not None:
        connection.send_message(websocket_api.event_message(msg["id"], feed["last"]))
    if feed["task"] is None:
        feed["task"] = hass.async_create_background_task(_frames(hass, feed), "haliday_show house frames")


async def _frames(hass: HomeAssistant, feed: dict) -> None:
    feed["last"] = None
    while feed["subs"]:
        client = _client(hass)  # again each time: the integration may have been reloaded
        try:
            now = await client.get("/api/player/frame") if client else None
        except Exception as err:  # noqa: BLE001 - a bad moment (app restarting, password changed): try again
            _LOGGER.debug("no frame from HA-liday Show: %s", err)
            now = None
        if now is not None and now != feed["last"]:
            feed["last"] = now
            for connection, msg_id in list(feed["subs"].values()):
                connection.send_message(websocket_api.event_message(msg_id, now))
        await asyncio.sleep(FRAME_EVERY if (now or {}).get("playing") else 1)
    feed["last"] = None


class QrView(HomeAssistantView):
    """Your visitors' QR code, for the Visitors and checks card (loaded with a signed link)."""

    url = "/api/haliday_show/qr"
    name = "api:haliday_show:qr"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        client = _client(request.app["hass"])
        got = await client.raw("/api/integration/qr.svg") if client else None
        if not got:
            raise web.HTTPNotFound
        return web.Response(body=got[0], content_type="image/svg+xml", headers={"Cache-Control": "no-cache"})


class HousePhotoView(HomeAssistantView):
    """The house photo, for the House card (loaded with a signed link)."""

    url = "/api/haliday_show/house_photo"
    name = "api:haliday_show:house_photo"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        client = _client(request.app["hass"])
        got = await client.raw("/api/house/photo") if client else None
        if not got:
            raise web.HTTPNotFound
        return web.Response(body=got[0], content_type=got[1], headers={"Cache-Control": "private, max-age=300"})


class DrawingCodeView(HomeAssistantView):
    """The editor's drawing modules. Without sign-in, as a script's own imports can't send it; only the
    files in DRAWING_CODE, which are open source and hold no data."""

    url = "/api/haliday_show/js/{name}"
    name = "api:haliday_show:js"
    requires_auth = False

    def __init__(self) -> None:
        self.cache: dict[tuple[str, str], bytes] = {}  # (name, app version) -> file, so anyone asking can't load the app

    async def get(self, request: web.Request, name: str) -> web.Response:
        if name not in DRAWING_CODE and name != SAMPLE_HOUSE:
            raise web.HTTPNotFound
        hass = request.app["hass"]
        client = _client(hass)
        if client is None:
            raise web.HTTPNotFound
        entry = next(e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED)
        key = (name, str((entry.runtime_data.coordinator.data or {}).get("version")))
        if key not in self.cache:
            got = await client.raw(f"/static/{name}" if name == SAMPLE_HOUSE else f"/static/js/{name}")
            if not got:
                raise web.HTTPNotFound
            self.cache = {k: v for k, v in self.cache.items() if k[1] == key[1]}  # drop an older app's files
            self.cache[key] = got[0]
        # no-cache: after an update the browser checks again, so it never mixes old and new files.
        return web.Response(body=self.cache[key], content_type="image/svg+xml" if name == SAMPLE_HOUSE else "text/javascript",
                            headers={"Cache-Control": "no-cache"})
