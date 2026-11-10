"""A switch for each season: on while its props are out, off while they're packed away."""
from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity

from .dynamic import follow_list
from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([PageSwitch(entry)])
    follow_list(hass, entry, async_add_entities, "seasons", SeasonSwitch)


class PageSwitch(HalidayEntity, SwitchEntity):
    """The visitors' page on or off, as the switch on Public page → Access."""

    _attr_name = "Visitors' page"
    _attr_icon = "mdi:web"

    def __init__(self, entry) -> None:
        super().__init__(entry, "page")

    @property
    def is_on(self) -> bool:
        return bool((self.state_data.get("page") or {}).get("on"))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.send("page", on=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.send("page", on=False)


class SeasonSwitch(HalidayEntity, SwitchEntity):
    _attr_icon = "mdi:calendar-star"

    def __init__(self, entry, item: dict) -> None:
        super().__init__(entry, f"season_{item['id']}")
        self.item_id = item["id"]
        self._attr_name = f"{item['name']} props out"

    @property
    def _season(self) -> dict:
        return next((s for s in self.state_data.get("seasons", []) if s["id"] == self.item_id), {})

    @property
    def is_on(self) -> bool:
        return bool(self._season.get("out"))

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.send("season", season=self.item_id, out=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.send("season", season=self.item_id, out=False)
