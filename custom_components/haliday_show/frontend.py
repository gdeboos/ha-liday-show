"""The dashboard cards: served by the integration and loaded on every dashboard, so there's no Resources step.

Cards talk to Home Assistant only (entities, actions and the commands below), never to the app directly,
so they work for every user, on phones and away from home."""
from __future__ import annotations

from pathlib import Path

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

URL = "/haliday_show_cards"
FOLDER = Path(__file__).parent / "frontend"


async def async_setup_frontend(hass: HomeAssistant, version: str) -> None:
    await hass.http.async_register_static_paths([StaticPathConfig(URL, str(FOLDER), False)])
    if "frontend" in hass.config.components:  # always, in a real Home Assistant
        add_extra_js_url(hass, f"{URL}/cards.js?v={version}")
    websocket_api.async_register_command(hass, ws_entities)
    websocket_api.async_register_command(hass, ws_library)
    hass.http.register_view(ImageView())


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
