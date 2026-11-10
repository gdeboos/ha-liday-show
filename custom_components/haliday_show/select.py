"""Show and Playlist selects, as the MQTT entities had."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity

from .entity import HalidayEntity, named


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([PickSelect(entry, "show", "Show", "shows", "mdi:playlist-music"),
                        PickSelect(entry, "playlist", "Playlist", "playlists", "mdi:playlist-play")])


class PickSelect(HalidayEntity, SelectEntity):
    def __init__(self, entry, kind: str, name: str, items: str, icon: str) -> None:
        super().__init__(entry, kind)
        self.kind, self.items = kind, items
        self._attr_name = name
        self._attr_icon = icon

    @property
    def options(self) -> list[str]:
        return [i["name"] for i in self.state_data.get(self.items, [])] or [f"(no {self.items} yet)"]

    @property
    def current_option(self) -> str | None:
        return named(self.state_data.get(self.items, []), self.state_data.get(f"selected_{self.kind}"))

    async def async_select_option(self, option: str) -> None:
        item = next((i for i in self.state_data.get(self.items, []) if i["name"] == option), None)
        if item:
            await self.send(f"select_{self.kind}", **{self.kind: item["id"]})
