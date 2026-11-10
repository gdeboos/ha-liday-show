"""Actions: haliday_show.play, stop, skip and season."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .client import CannotConnect, CommandFailed
from .const import DOMAIN

PLAY_SCHEMA = vol.All(
    vol.Schema({
        vol.Exclusive("show", "what"): cv.string,
        vol.Exclusive("playlist", "what"): cv.string,
        vol.Exclusive("scene", "what"): cv.string,
        vol.Optional("media_player"): cv.entity_id,
        vol.Optional("start_at"): vol.All(vol.Coerce(float), vol.Range(min=0, max=24 * 3600)),
    }),
    cv.has_at_least_one_key("show", "playlist", "scene"),
)
SEASON_SCHEMA = vol.Schema({vol.Required("season"): cv.string, vol.Required("out"): cv.boolean})


def _client(hass: HomeAssistant):
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if not entries:
        raise ServiceValidationError("HA-liday Show isn't set up, or isn't answering")
    return entries[0].runtime_data.client


async def _send(hass: HomeAssistant, action: str, **data) -> None:
    try:
        await _client(hass).command(action, **data)
    except CommandFailed as err:
        raise ServiceValidationError(str(err)) from err
    except CannotConnect as err:
        raise HomeAssistantError(f"HA-liday Show isn't answering: {err}") from err


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    async def play(call: ServiceCall) -> None:
        d = call.data
        if "scene" in d:
            if "media_player" in d or "start_at" in d:
                raise ServiceValidationError("A scene has no speaker or start point; leave those out")
            await _send(hass, "scene", scene=d["scene"])
        elif "playlist" in d:
            if "start_at" in d or "media_player" in d:
                raise ServiceValidationError("A playlist uses each show's own speaker and starts at the beginning")
            await _send(hass, "play_playlist", playlist=d["playlist"])
        else:
            extra = {k: v for k, v in (("media_player", d.get("media_player")), ("position", d.get("start_at"))) if v is not None}
            await _send(hass, "play", show=d["show"], **extra)

    async def stop(call: ServiceCall) -> None:
        await _send(hass, "stop")

    async def skip(call: ServiceCall) -> None:
        await _send(hass, "skip")

    async def run_preshow_check(call: ServiceCall) -> None:
        from .button import run_preshow
        await run_preshow(_client(hass))

    async def season(call: ServiceCall) -> None:
        await _send(hass, "season", season=call.data["season"], out=call.data["out"])

    hass.services.async_register(DOMAIN, "play", play, schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, "stop", stop)
    hass.services.async_register(DOMAIN, "skip", skip)
    hass.services.async_register(DOMAIN, "season", season, schema=SEASON_SCHEMA)
    hass.services.async_register(DOMAIN, "run_preshow_check", run_preshow_check)
