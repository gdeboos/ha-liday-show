"""Play, Play playlist and Stop buttons, as the MQTT entities had."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity

from .entity import HalidayEntity

BUTTONS = (("play", "Play", "mdi:play", "play"),
           ("run_preshow", "Run pre-show check", "mdi:clipboard-check-outline", "preshow"),
           ("play_playlist", "Play playlist", "mdi:play-box-multiple", "play_playlist"),
           ("stop", "Stop", "mdi:stop", "stop"))


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities(HalidayButton(entry, *b) for b in BUTTONS)


class HalidayButton(HalidayEntity, ButtonEntity):
    def __init__(self, entry, key: str, name: str, icon: str, action: str) -> None:
        super().__init__(entry, key)
        self._attr_name = name
        self._attr_icon = icon
        self.action = action

    async def async_press(self) -> None:
        if self.action == "preshow":
            await run_preshow(self.client)
            return
        await self.send(self.action)


async def run_preshow(client) -> dict:
    """The pre-show check, with a clear message if it can't run. Its result arrives as the Last pre-show
    check sensor and a Pre-show check event."""
    from homeassistant.exceptions import HomeAssistantError

    from .client import CannotConnect, CommandFailed

    try:
        return await client.preshow()
    except CommandFailed as err:
        raise HomeAssistantError(str(err)) from err
    except CannotConnect as err:
        raise HomeAssistantError(f"HA-liday Show isn't answering: {err}") from err
