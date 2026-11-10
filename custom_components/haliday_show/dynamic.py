"""Entities that come and go with the app's lists (a scene each, a season switch each)."""
from __future__ import annotations

from collections.abc import Callable

from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er


def follow_list(hass, entry, async_add_entities, items: str, make: Callable) -> None:
    """Add an entity for each new item in state[items]; remove the entity of each one deleted."""
    coordinator = entry.runtime_data.coordinator
    have: dict[str, object] = {}

    @callback
    def sync() -> None:
        listed = {i["id"]: i for i in (coordinator.data or {}).get(items, [])}
        now = set(listed)
        new = [make(entry, listed[i]) for i in sorted(now - set(have))]
        for ent in new:
            have[ent.item_id] = ent
        if new:
            async_add_entities(new)
        reg = er.async_get(hass)
        for gone in set(have) - now:
            ent = have.pop(gone)
            if ent.entity_id and reg.async_get(ent.entity_id):
                reg.async_remove(ent.entity_id)  # takes the entity away too

    sync()
    entry.async_on_unload(coordinator.async_add_listener(sync))
