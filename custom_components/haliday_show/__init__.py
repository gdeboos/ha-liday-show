"""The HA-liday Show integration: Home Assistant's entities for the HA-liday Show app, without MQTT."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client import BadPassword, CannotConnect, CommandFailed, HalidayClient, TooOld
from .const import DEVICE_ID, DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.BUTTON, Platform.LIGHT, Platform.SCENE, Platform.SELECT, Platform.SENSOR, Platform.SWITCH]


@dataclass
class HalidayData:
    client: HalidayClient
    coordinator: DataUpdateCoordinator[dict]


type HalidayConfigEntry = ConfigEntry[HalidayData]


async def async_setup_entry(hass: HomeAssistant, entry: HalidayConfigEntry) -> bool:
    client = HalidayClient(async_get_clientsession(hass), entry.data[CONF_HOST], entry.data[CONF_PORT],
                           entry.data.get(CONF_PASSWORD))

    async def update() -> dict:
        try:
            return await client.state()
        except BadPassword as err:
            raise ConfigEntryAuthFailed("HA-liday Show's password has changed") from err
        except TooOld as err:
            raise UpdateFailed("Update the HA-liday Show app and this integration to the same version") from err
        except CannotConnect as err:
            raise UpdateFailed(f"HA-liday Show isn't answering: {err}") from err

    coordinator = DataUpdateCoordinator(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_method=update)
    await coordinator.async_config_entry_first_refresh()

    try:
        await client.claim(True)
    except (CannotConnect, BadPassword, CommandFailed) as err:
        raise ConfigEntryNotReady(str(err)) from err
    await _take_over_mqtt(hass, entry)

    entry.runtime_data = HalidayData(client, coordinator)

    def lost() -> None:
        coordinator.async_set_update_error(UpdateFailed("lost touch with HA-liday Show"))

    claiming: list[asyncio.Task] = []

    def pushed(state: dict) -> None:
        coordinator.async_set_updated_data(state)
        # The app forgot (a restored backup, a reinstall, or a week without us): claim again before
        # MQTT brings back a second set of entities.
        if state.get("claimed") is False and not any(not t.done() for t in claiming):
            claiming[:] = [entry.async_create_background_task(hass, _claim_again(hass, client, entry), "haliday_show claim")]

    client.listen(pushed, lost)
    entry.async_on_unload(client.stop)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HalidayConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Hand Home Assistant's entities back to MQTT."""
    client = HalidayClient(async_get_clientsession(hass), entry.data[CONF_HOST], entry.data[CONF_PORT],
                           entry.data.get(CONF_PASSWORD))
    try:
        await client.claim(False)
    except Exception as err:  # noqa: BLE001 - the app may be off; it brings MQTT back after a week without us
        _LOGGER.warning("couldn't tell HA-liday Show to bring its MQTT entities back: %s. "
                        "Restart the app with Home Assistant running, or they come back by themselves after a week", err)


async def _claim_again(hass: HomeAssistant, client: HalidayClient, entry: ConfigEntry) -> None:
    try:
        await client.claim(True)
    except (CannotConnect, BadPassword, CommandFailed) as err:
        _LOGGER.warning("couldn't take over HA-liday Show's MQTT entities: %s", err)
        return
    await _take_over_mqtt(hass, entry)


async def _take_over_mqtt(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Move the MQTT entities (select.ha_liday_show_show and the rest) across to this integration.

    The app has already withdrawn their MQTT discovery entries. Our entities have the same unique ids, so
    each is registered here with the MQTT one's entity id, and any name, icon or area you gave it."""
    ent_reg = er.async_get(hass)
    old = [e for e in list(ent_reg.entities.values())
           if e.platform == "mqtt" and e.unique_id.startswith("haliday_show_")]
    for e in old:
        ent_reg.async_remove(e.entity_id)
    # A loaded MQTT entity goes from the state machine a moment later; its id can't be reused until then.
    for _ in range(50):
        if not any(hass.states.get(e.entity_id) for e in old):
            break
        await asyncio.sleep(0.1)
    for e in old:
        if hass.states.get(e.entity_id) or ent_reg.async_get(e.entity_id):
            continue
        new = ent_reg.async_get_or_create(e.domain, DOMAIN, e.unique_id, config_entry=entry,
                                          suggested_object_id=e.entity_id.split(".", 1)[1])
        changes = {k: v for k, v in (("name", e.name), ("icon", e.icon), ("area_id", e.area_id),
                                     ("labels", e.labels), ("aliases", e.aliases)) if v}
        if new.entity_id != e.entity_id:
            changes["new_entity_id"] = e.entity_id
        if changes:
            ent_reg.async_update_entity(new.entity_id, **changes)
    dev_reg = dr.async_get(hass)
    if device := dev_reg.async_get_device(identifiers={("mqtt", DEVICE_ID)}):
        dev_reg.async_remove_device(device.id)
