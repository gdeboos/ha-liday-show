"""Adding HA-liday Show: found automatically on the app, or by address for Docker and pipx installs."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.hassio import HassioServiceInfo

from .client import BadPassword, CannotConnect, HalidayClient, TooOld
from .const import DEFAULT_HOST, DEFAULT_PORT, DOMAIN


class HalidayConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._found: dict[str, Any] = {}

    async def _check(self, data: dict[str, Any]) -> str | None:
        client = HalidayClient(async_get_clientsession(self.hass), data[CONF_HOST], data[CONF_PORT],
                               data.get(CONF_PASSWORD))
        try:
            await client.state()
        except BadPassword:
            return "invalid_auth"
        except TooOld:
            return "too_old"
        except CannotConnect:
            return "cannot_connect"
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {CONF_HOST: user_input[CONF_HOST].strip(), CONF_PORT: user_input[CONF_PORT]}
            if user_input.get(CONF_PASSWORD):
                data[CONF_PASSWORD] = user_input[CONF_PASSWORD]
            if not (error := await self._check(data)):
                return self.async_create_entry(title="HA-liday Show", data=data)
            errors["base"] = error
        schema = vol.Schema({
            vol.Required(CONF_HOST, default=DEFAULT_HOST): str,
            vol.Required(CONF_PORT, default=DEFAULT_PORT): int,
            vol.Optional(CONF_PASSWORD): str,
        })
        return self.async_show_form(step_id="user", data_schema=self.add_suggested_values_to_schema(schema, user_input),
                                    errors=errors)

    async def async_step_hassio(self, discovery_info: HassioServiceInfo) -> ConfigFlowResult:
        """The app told Home Assistant it's here."""
        await self.async_set_unique_id(DOMAIN)
        data = {CONF_HOST: discovery_info.config.get("host", DEFAULT_HOST),
                CONF_PORT: int(discovery_info.config.get("port", DEFAULT_PORT))}
        self._abort_if_unique_id_configured(updates=data)
        self._found = data
        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if not (error := await self._check(self._found)):
                return self.async_create_entry(title="HA-liday Show", data=self._found)
            errors["base"] = error
        return self.async_show_form(step_id="hassio_confirm", errors=errors)

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            data = {**entry.data, CONF_PASSWORD: user_input[CONF_PASSWORD]}
            if not (error := await self._check(data)):
                return self.async_update_reload_and_abort(entry, data=data)
            errors["base"] = error
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({vol.Required(CONF_PASSWORD): str}),
                                    errors=errors)
