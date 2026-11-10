"""Play, Play playlist and Stop buttons, as the MQTT entities had."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity

from .entity import HalidayEntity

BUTTONS = (("play", "Play", "mdi:play", "play"),
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
        await self.send(self.action)
