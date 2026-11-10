"""Visitors' page open: on while the public page is switched on and within its opening hours."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity

from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([PageOpen(entry)])


class PageOpen(HalidayEntity, BinarySensorEntity):
    _attr_name = "Visitors' page open"
    _attr_icon = "mdi:web"

    def __init__(self, entry) -> None:
        super().__init__(entry, "page_open")

    @property
    def is_on(self) -> bool:
        return bool((self.state_data.get("page") or {}).get("open"))

    @property
    def extra_state_attributes(self) -> dict:
        page = self.state_data.get("page") or {}
        return {"switched_on": bool(page.get("on")), "link": page.get("link")}
