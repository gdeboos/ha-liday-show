"""A scene entity for each of your scenes, so they're in Home Assistant's Scenes and voice."""
from __future__ import annotations

from typing import Any

from homeassistant.components.scene import Scene

from .dynamic import follow_list
from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    follow_list(hass, entry, async_add_entities, "scenes", HalidayScene)


class HalidayScene(HalidayEntity, Scene):
    _attr_icon = "mdi:creation"

    def __init__(self, entry, item: dict) -> None:
        super().__init__(entry, f"scene_{item['id']}")
        self.item_id = item["id"]
        self._attr_name = item["name"]

    def _handle_coordinator_update(self) -> None:
        item = next((s for s in self.state_data.get("scenes", []) if s["id"] == self.item_id), None)
        if item:
            self._attr_name = item["name"]
        super()._handle_coordinator_update()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        # The scene's own name, as the light's effect list has it, so cards can show which is on.
        item = next((x for x in self.state_data.get("scenes", []) if x["id"] == self.item_id), {})
        return {"scene_name": self._attr_name, "colours": item.get("colours", [])}

    async def async_activate(self, **kwargs: Any) -> None:
        await self.send("scene", scene=self.item_id)
