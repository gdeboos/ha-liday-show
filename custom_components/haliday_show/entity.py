"""What every HA-liday Show entity shares: the one device, and the app's pushed state."""
from __future__ import annotations

from typing import Any

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity, DataUpdateCoordinator

from .client import CannotConnect, CommandFailed
from .const import DEVICE_ID, DOMAIN


class HalidayEntity(CoordinatorEntity[DataUpdateCoordinator[dict]]):
    _attr_has_entity_name = True

    def __init__(self, entry, key: str) -> None:
        super().__init__(entry.runtime_data.coordinator)
        self.client = entry.runtime_data.client
        # The same unique ids the MQTT entities used, so they read the same in the registry.
        self._attr_unique_id = f"haliday_show_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, DEVICE_ID)}, name="HA-liday Show", manufacturer="ha-liday-show",
            model="Light show sequencer", sw_version=self.coordinator.data.get("version"))

    @property
    def state_data(self) -> dict:
        return self.coordinator.data or {}

    async def send(self, action: str, **data: Any) -> None:
        try:
            await self.client.command(action, **data)
        except CommandFailed as err:
            raise HomeAssistantError(str(err)) from err
        except CannotConnect as err:
            raise HomeAssistantError(f"HA-liday Show isn't answering: {err}") from err


def named(items: list[dict], ident: str | None) -> str | None:
    return next((i["name"] for i in items if i["id"] == ident), None)
