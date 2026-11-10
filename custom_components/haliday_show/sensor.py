"""Sensors: Status (as with MQTT), and what's next, the visitors' queue, phones listening and the last pre-show check."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.util import dt as dt_util

from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([StatusSensor(entry), NextSensor(entry), QueueSensor(entry), ListeningSensor(entry),
                        PreshowSensor(entry)])


class StatusSensor(HalidayEntity, SensorEntity):
    _attr_name = "Status"
    _attr_icon = "mdi:string-lights"

    def __init__(self, entry) -> None:
        super().__init__(entry, "status")

    @property
    def native_value(self) -> str | None:
        return self.state_data.get("status")


def local_time(text: str | None) -> datetime | None:
    """The app's times are its own local time, without a zone: the same clock as Home Assistant's."""
    when = dt_util.parse_datetime(text) if text else None
    if when and when.tzinfo is None:
        when = when.replace(tzinfo=dt_util.get_default_time_zone())
    return when


class NextSensor(HalidayEntity, SensorEntity):
    _attr_name = "Next on the schedule"
    _attr_icon = "mdi:calendar-clock"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, entry) -> None:
        super().__init__(entry, "next")

    @property
    def native_value(self) -> datetime | None:
        return local_time((self.state_data.get("next") or {}).get("at"))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        nxt = self.state_data.get("next") or {}
        return {"name": nxt.get("name"), "kind": nxt.get("kind")}


class QueueSensor(HalidayEntity, SensorEntity):
    _attr_name = "Visitors waiting"
    _attr_icon = "mdi:human-queue"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry) -> None:
        super().__init__(entry, "queue")

    @property
    def native_value(self) -> int:
        return (self.state_data.get("queue") or {}).get("waiting", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        q = self.state_data.get("queue") or {}
        return {"mode": q.get("mode"), "picks": q.get("names", [])}


class ListeningSensor(HalidayEntity, SensorEntity):
    _attr_name = "Phones listening"
    _attr_icon = "mdi:cellphone-sound"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry) -> None:
        super().__init__(entry, "listening")

    @property
    def native_value(self) -> int:
        return self.state_data.get("listening", 0)


class PreshowSensor(HalidayEntity, SensorEntity):
    _attr_name = "Last pre-show check"
    _attr_icon = "mdi:clipboard-check-outline"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["ok", "info", "warn", "fail"]

    def __init__(self, entry) -> None:
        super().__init__(entry, "preshow")

    @property
    def native_value(self) -> str | None:
        return (self.state_data.get("preshow") or {}).get("level")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        last = self.state_data.get("preshow") or {}
        return {"problems": last.get("problems"), "warnings": last.get("warnings"),
                "checked": local_time(last.get("at"))}
