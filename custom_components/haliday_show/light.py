"""One light for all your scenes: on/off, brightness, and the scenes as its effects."""
from __future__ import annotations

from typing import Any

from homeassistant.components.light import ATTR_BRIGHTNESS, ATTR_EFFECT, ColorMode, LightEntity, LightEntityFeature

from .entity import HalidayEntity, named


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([ScenesLight(entry)])


class ScenesLight(HalidayEntity, LightEntity):
    _attr_name = None  # the device's main light: light.ha_liday_show
    _attr_icon = "mdi:string-lights"
    _attr_color_mode = ColorMode.BRIGHTNESS
    _attr_supported_color_modes = {ColorMode.BRIGHTNESS}
    _attr_supported_features = LightEntityFeature.EFFECT

    def __init__(self, entry) -> None:
        super().__init__(entry, "light")

    @property
    def _light(self) -> dict:
        return self.state_data.get("light") or {}

    @property
    def is_on(self) -> bool:
        return bool(self._light.get("on"))

    @property
    def brightness(self) -> int:
        return round((self._light.get("brightness") or 100) * 255 / 100)

    @property
    def effect_list(self) -> list[str]:
        return [s["name"] for s in self.state_data.get("scenes", [])]

    @property
    def effect(self) -> str | None:
        return named(self.state_data.get("scenes", []), self._light.get("scene"))

    async def async_turn_on(self, **kwargs: Any) -> None:
        cmd: dict[str, Any] = {"on": True}
        if ATTR_BRIGHTNESS in kwargs:
            cmd["brightness"] = max(1, round(kwargs[ATTR_BRIGHTNESS] * 100 / 255))
        if ATTR_EFFECT in kwargs:
            cmd["scene"] = kwargs[ATTR_EFFECT]
        await self.send("light", **cmd)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.send("light", on=False)
