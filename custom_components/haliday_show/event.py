"""Event entities, so HA-liday Show's happenings show in the logbook and can start automations from the UI.

The same events are fired on Home Assistant's event bus as haliday_show_<name>."""
from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import EVENT_SIGNAL
from .entity import HalidayEntity

# entity key, name, icon, {app event: event type}
EVENTS = (
    ("show_event", "Show", "mdi:play-circle-outline", {"show_started": "started", "show_ended": "ended"}),
    ("visitor_event", "Visitors", "mdi:account-group", {"visitor_pick": "pick", "visitor_vote": "vote"}),
    ("preshow_event", "Pre-show check", "mdi:clipboard-check-outline", {"preshow_check": "finished"}),
    ("light_event", "Lights", "mdi:lightbulb-alert-outline", {"light_not_answering": "not_answering"}),
)


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities(HalidayEvent(entry, *e) for e in EVENTS)


class HalidayEvent(HalidayEntity, EventEntity):
    def __init__(self, entry, key: str, name: str, icon: str, types: dict[str, str]) -> None:
        super().__init__(entry, key)
        self._attr_translation_key = key  # for the event types' names
        self._attr_name = name
        self._attr_icon = icon
        self.types = types
        self._attr_event_types = list(types.values())

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(self.hass, EVENT_SIGNAL, self._got))

    @callback
    def _got(self, name: str, data: dict) -> None:
        if name in self.types:
            self._trigger_event(self.types[name], {k: v for k, v in data.items() if v is not None})
            self.async_write_ha_state()
