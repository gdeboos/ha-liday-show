"""The HA-liday Show integration: Home Assistant's entities for the HA-liday Show app, without MQTT."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client import BadPassword, CannotConnect, HalidayClient, TooOld
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
    except (CannotConnect, BadPassword) as err:
        raise ConfigEntryNotReady(str(err)) from err
    _take_over_mqtt(hass)

    entry.runtime_data = HalidayData(client, coordinator)

    def lost() -> None:
        coordinator.async_set_update_error(UpdateFailed("lost touch with HA-liday Show"))

    client.listen(coordinator.async_set_updated_data, lost)
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
    except Exception as err:  # noqa: BLE001 - the app may be gone too; MQTT comes back when it next says so
        _LOGGER.warning("couldn't tell HA-liday Show to bring its MQTT entities back: %s", err)


def _take_over_mqtt(hass: HomeAssistant) -> None:
    """Free the MQTT entities' ids (select.ha_liday_show_show and the rest) so ours take them.

    The app has already withdrawn their MQTT discovery entries; this clears what's left in the registries,
    for example while the broker is down."""
    ent_reg = er.async_get(hass)
    for entry in list(ent_reg.entities.values()):
        if entry.platform == "mqtt" and entry.unique_id.startswith("haliday_show_"):
            ent_reg.async_remove(entry.entity_id)
    dev_reg = dr.async_get(hass)
    if device := dev_reg.async_get_device(identifiers={("mqtt", DEVICE_ID)}):
        dev_reg.async_remove_device(device.id)
