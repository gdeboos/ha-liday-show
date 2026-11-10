"""The Status sensor: the playing show's name, or idle."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity

from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([StatusSensor(entry)])


class StatusSensor(HalidayEntity, SensorEntity):
    _attr_name = "Status"
    _attr_icon = "mdi:string-lights"

    def __init__(self, entry) -> None:
        super().__init__(entry, "status")

    @property
    def native_value(self) -> str | None:
        return self.state_data.get("status")
