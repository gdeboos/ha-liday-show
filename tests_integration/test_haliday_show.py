import asyncio

import pytest
from aiohttp.test_utils import TestServer

from homeassistant.config_entries import SOURCE_HASSIO, SOURCE_USER
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.haliday_show.const import DOMAIN
from halidayshow import server as app_server


@pytest.fixture
async def app(tmp_path):
    """The real HA-liday Show app on 127.0.0.1, with a show and a scene."""
    (tmp_path / "media").mkdir()
    web_app = app_server.make_app(tmp_path / "config", tmp_path / "media", read_stdin=False)
    srv = TestServer(web_app, host="127.0.0.1")
    await srv.start_server()
    storage = web_app[app_server.STORAGE]
    storage.save_show("party", {"name": "Party", "tracks": []})
    srv.storage = storage
    srv.web_app = web_app
    yield srv
    await srv.close()


async def _set_up(hass, app) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={CONF_HOST: "127.0.0.1", CONF_PORT: app.port})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _settle(hass, check, tries=40):
    for _ in range(tries):
        await asyncio.sleep(0.1)
        await hass.async_block_till_done()
        if check():
            return
    raise AssertionError("never happened")


async def test_user_flow_finds_the_app(hass: HomeAssistant, app) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_HOST: "127.0.0.1", CONF_PORT: 1})
    assert result["errors"] == {"base": "cannot_connect"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_HOST: "127.0.0.1", CONF_PORT: app.port})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_HOST: "127.0.0.1", CONF_PORT: app.port}


async def test_found_by_the_supervisor(hass: HomeAssistant, app) -> None:
    info = HassioServiceInfo(config={"host": "127.0.0.1", "port": app.port}, name="HA-liday Show",
                             slug="haliday_show", uuid="1234")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_HASSIO}, data=info)
    assert result["step_id"] == "hassio_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_entities_keep_the_mqtt_names_and_work(hass: HomeAssistant, app) -> None:
    # An MQTT entity left in the registry from before: the integration takes its id.
    ent_reg = er.async_get(hass)
    old = MockConfigEntry(domain="mqtt")
    old.add_to_hass(hass)
    ent_reg.async_get_or_create("select", "mqtt", "haliday_show_show", suggested_object_id="ha_liday_show_show",
                                config_entry=old)
    await _set_up(hass, app)
    assert app.storage.load_settings().get("ha_integration") is True

    show = ent_reg.async_get("select.ha_liday_show_show")
    assert show and show.platform == DOMAIN
    assert hass.states.get("select.ha_liday_show_show").attributes["options"] == ["Party"]
    assert hass.states.get("sensor.ha_liday_show_status").state == "idle"
    assert hass.states.get("button.ha_liday_show_play")
    assert hass.states.get("light.ha_liday_show").state == "off"
    assert hass.states.get("switch.ha_liday_show_halloween_props_out").state == "on"

    await hass.services.async_call("select", "select_option",
                                   {"entity_id": "select.ha_liday_show_show", "option": "Party"}, blocking=True)
    assert app.storage.load_settings()["selected_show"] == "party"
    await _settle(hass, lambda: hass.states.get("select.ha_liday_show_show").state == "Party")

    await hass.services.async_call("switch", "turn_off",
                                   {"entity_id": "switch.ha_liday_show_halloween_props_out"}, blocking=True)
    await _settle(hass, lambda: hass.states.get("switch.ha_liday_show_halloween_props_out").state == "off")


async def test_scenes_come_and_go(hass: HomeAssistant, app) -> None:
    await _set_up(hass, app)
    assert not hass.states.async_entity_ids("scene")
    app.storage.save_scene("candy", {"name": "Candy cane", "mode": "basic", "lights": {}})
    app.web_app[app_server.HUB].refresh()
    await _settle(hass, lambda: hass.states.get("scene.ha_liday_show_candy_cane") is not None)
    assert hass.states.get("light.ha_liday_show").attributes["effect_list"] == ["Candy cane"]
    app.storage.delete_scene("candy")
    app.web_app[app_server.HUB].refresh()
    await _settle(hass, lambda: hass.states.get("scene.ha_liday_show_candy_cane") is None)


async def test_removing_hands_back_to_mqtt(hass: HomeAssistant, app) -> None:
    entry = await _set_up(hass, app)
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert app.storage.load_settings().get("ha_integration") is None
    assert not dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "haliday_show")})
