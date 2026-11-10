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
    assert hass.states.get("scene.ha_liday_show_candy_cane").attributes["scene_name"] == "Candy cane"
    app.storage.delete_scene("candy")
    app.web_app[app_server.HUB].refresh()
    await _settle(hass, lambda: hass.states.get("scene.ha_liday_show_candy_cane") is None)


async def test_removing_hands_back_to_mqtt(hass: HomeAssistant, app) -> None:
    entry = await _set_up(hass, app)
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert app.storage.load_settings().get("ha_integration") is None
    assert not dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "haliday_show")})


async def test_renamed_mqtt_entities_keep_their_id_and_area(hass: HomeAssistant, app) -> None:
    ent_reg = er.async_get(hass)
    old = MockConfigEntry(domain="mqtt")
    old.add_to_hass(hass)
    made = ent_reg.async_get_or_create("button", "mqtt", "haliday_show_play", suggested_object_id="garden_show_go",
                                       config_entry=old)
    ent_reg.async_update_entity(made.entity_id, area_id="garden", name="Go!")
    await _set_up(hass, app)
    moved = ent_reg.async_get("button.garden_show_go")
    assert moved and moved.platform == DOMAIN and moved.area_id == "garden" and moved.name == "Go!"
    assert hass.states.get("button.garden_show_go")
    assert not hass.states.get("button.ha_liday_show_play")


async def test_claims_again_when_the_app_forgets(hass: HomeAssistant, app) -> None:
    await _set_up(hass, app)
    settings = app.storage.load_settings()
    settings.pop("ha_integration")
    app.storage.save_settings(settings)
    app.web_app[app_server.HUB].refresh()
    await _settle(hass, lambda: app.storage.load_settings().get("ha_integration") is True)


async def test_a_deleted_show_is_reported(hass: HomeAssistant, app) -> None:
    from homeassistant.exceptions import HomeAssistantError
    await _set_up(hass, app)
    await hass.services.async_call("select", "select_option",
                                   {"entity_id": "select.ha_liday_show_show", "option": "Party"}, blocking=True)
    app.storage.delete_show("party") if hasattr(app.storage, "delete_show") else (app.storage.config_dir / "shows" / "party.json").unlink()
    with pytest.raises(HomeAssistantError, match="no show"):
        await hass.services.async_call("button", "press", {"entity_id": "button.ha_liday_show_play"}, blocking=True)


async def test_actions(hass: HomeAssistant, app) -> None:
    from homeassistant.exceptions import ServiceValidationError
    from halidayshow import baked
    await _set_up(hass, app)
    app.storage.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    await hass.services.async_call(DOMAIN, "season", {"season": "Christmas", "out": False}, blocking=True)
    await _settle(hass, lambda: hass.states.get("switch.ha_liday_show_christmas_props_out").state == "off")
    with pytest.raises(ServiceValidationError, match="nothing to skip"):
        await hass.services.async_call(DOMAIN, "skip", {}, blocking=True)
    with pytest.raises(ServiceValidationError, match="no show"):
        await hass.services.async_call(DOMAIN, "play", {"show": "Nope"}, blocking=True)
    with pytest.raises(ServiceValidationError, match="scene has no speaker"):
        await hass.services.async_call(DOMAIN, "play", {"scene": "x", "start_at": 3}, blocking=True)

    started, ended = [], []
    hass.bus.async_listen(f"{DOMAIN}_show_started", lambda e: started.append(e.data))
    hass.bus.async_listen(f"{DOMAIN}_show_ended", lambda e: ended.append(e.data))
    await hass.services.async_call(DOMAIN, "play", {"show": "Party", "start_at": 2}, blocking=True)
    await _settle(hass, lambda: hass.states.get("sensor.ha_liday_show_status").state == "Party")
    runner = app.web_app[app_server.RUNNER]
    assert runner.status()["position"] >= 2
    await _settle(hass, lambda: started)
    assert started[0]["name"] == "Party"
    assert hass.states.get("event.ha_liday_show_show").attributes["event_type"] == "started"
    await hass.services.async_call(DOMAIN, "stop", {}, blocking=True)
    await _settle(hass, lambda: ended)


async def test_visitor_and_check_events(hass: HomeAssistant, app) -> None:
    await _set_up(hass, app)
    got = []
    hass.bus.async_listen(f"{DOMAIN}_visitor_pick", lambda e: got.append(("pick", e.data)))
    hass.bus.async_listen(f"{DOMAIN}_preshow_check", lambda e: got.append(("check", e.data)))
    runner = app.web_app[app_server.RUNNER]
    runner.add_request({"id": "r1", "ticket": "t", "kind": "show", "ref": "party", "name": "Party", "shows": [], "gap": 0})
    import aiohttp
    async with aiohttp.ClientSession() as s:
        await s.put(f"http://127.0.0.1:{app.port}/api/preshow/last", json={"level": "warn", "problems": 0, "warnings": 2})
    await _settle(hass, lambda: len(got) == 2)
    assert ("check", {"level": "warn", "problems": 0, "warnings": 2}) in got
    assert got[0][0] == "pick" and got[0][1]["name"] == "Party"
    assert hass.states.get("event.ha_liday_show_visitors").attributes["event_type"] == "pick"


async def test_media_player_and_sensors(hass: HomeAssistant, app) -> None:
    from halidayshow import baked
    await _set_up(hass, app)
    assert hass.states.get("media_player.ha_liday_show_player").state == "idle"
    assert hass.states.get("sensor.ha_liday_show_visitors_waiting").state == "0"
    assert hass.states.get("sensor.ha_liday_show_phones_listening").state == "0"
    assert hass.states.get("sensor.ha_liday_show_next_on_the_schedule").state == "unknown"
    assert hass.states.get("binary_sensor.ha_liday_show_visitors_page_open").state == "off"
    app.storage.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    await hass.services.async_call("media_player", "select_source",
                                   {"entity_id": "media_player.ha_liday_show_player", "source": "Party"}, blocking=True)
    await _settle(hass, lambda: hass.states.get("media_player.ha_liday_show_player").attributes.get("source") == "Party")
    await hass.services.async_call("media_player", "media_play", {"entity_id": "media_player.ha_liday_show_player"},
                                   blocking=True)
    await _settle(hass, lambda: hass.states.get("media_player.ha_liday_show_player").state == "playing")
    st = hass.states.get("media_player.ha_liday_show_player")
    assert st.attributes["media_title"] == "Party" and st.attributes["media_duration"] == 10
    assert "entity_picture" not in st.attributes  # no song, so no cover art
    assert st.attributes["visitor_pick"] is False  # your own show: Skip isn't offered
    await asyncio.sleep(2.2)  # two pushes later the player hasn't rewritten its state
    await hass.async_block_till_done()
    assert hass.states.get("media_player.ha_liday_show_player").last_updated == st.last_updated
    await hass.services.async_call("media_player", "media_stop", {"entity_id": "media_player.ha_liday_show_player"},
                                   blocking=True)
    await _settle(hass, lambda: hass.states.get("media_player.ha_liday_show_player").state == "idle")

    async with __import__("aiohttp").ClientSession() as s:
        await s.put(f"http://127.0.0.1:{app.port}/api/preshow/last", json={"level": "fail", "problems": 1, "warnings": 0})
    await _settle(hass, lambda: hass.states.get("sensor.ha_liday_show_last_pre_show_check").state == "fail")
    assert hass.states.get("sensor.ha_liday_show_last_pre_show_check").attributes["problems"] == 1


async def test_next_on_the_schedule(hass: HomeAssistant, app) -> None:
    settings = app.storage.load_settings()
    settings["schedule"] = [{"id": "r1", "play": {"type": "show", "id": "party"}, "on": True, "start": "23:58",
                             "end": "23:59", "days": [0, 1, 2, 3, 4, 5, 6]}]
    app.storage.save_settings(settings)
    await _set_up(hass, app)
    st = hass.states.get("sensor.ha_liday_show_next_on_the_schedule")
    assert st.state not in ("unknown", "unavailable") and st.attributes["name"] == "Party"


async def test_cards_are_served_with_their_data(hass: HomeAssistant, app, hass_ws_client, hass_client) -> None:
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "http", {})
    settings = app.storage.load_settings()
    settings["library_folders"] = {"shows": [{"id": "f1", "name": "Christmas", "items": ["party"]}]}
    app.storage.save_settings(settings)
    await _set_up(hass, app)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haliday_show/entities"})
    ents = (await ws.receive_json())["result"]
    assert ents["player"] == "media_player.ha_liday_show_player" and ents["show"] == "select.ha_liday_show_show"
    assert "switch.ha_liday_show_halloween_props_out" in ents["seasons"]
    await ws.send_json({"id": 2, "type": "haliday_show/library"})
    lib = (await ws.receive_json())["result"]
    assert [s["name"] for s in lib["shows"]] == ["Party"]
    assert lib["folders"]["shows"][0]["items"] == ["party"]

    client = await hass_client()
    js = await client.get("/haliday_show_cards/cards.js")
    assert js.status == 200 and "haliday-show-player-card" in await js.text()
    assert (await client.get("/haliday_show_cards/cardlib.js")).status == 200
    assert (await client.get("/api/haliday_show/image/party")).status == 404  # no picture or cover
    (app.storage.shows_dir / "party.jpg").write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
    pic = await client.get("/api/haliday_show/image/party")
    assert pic.status == 200 and await pic.read() == b"\xff\xd8\xff\xe0fakejpeg"
    assert (await client.get("/api/haliday_show/image/..%2Fsettings")).status in (400, 404)
