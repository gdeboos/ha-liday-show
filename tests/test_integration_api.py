"""The API the Home Assistant integration (custom_components/haliday_show) talks to."""
import asyncio
import json

import pytest

from halidayshow import integration, mqtt, server
from test_runner import FakeClient, runner  # noqa: F401  (runner is a fixture)


async def _show(client, name):
    show_id = (await (await client.post("/api/shows", json={"name": name})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": name, "fps": 40, "duration": 1, "tracks": []})
    return show_id


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    media = tmp_path / "media"
    (media / "songs").mkdir(parents=True)
    app = server.make_app(tmp_path / "config", media, allow_all=True)
    return await aiohttp_client(app)


async def test_snapshot_lists_shows_scenes_and_seasons(client):
    await _show(client, "Party")
    await client.post("/api/house-scenes", json={"name": "Candy cane"})
    state = await (await client.get("/api/integration")).json()
    assert state["api"] == integration.API and state["claimed"] is False
    assert [s["name"] for s in state["shows"]] == ["Party"]
    assert [s["name"] for s in state["scenes"]] == ["Candy cane"]
    assert {s["name"] for s in state["seasons"]} == {"Halloween", "Christmas"}
    assert state["status"] == "idle" and state["light"]["on"] is False


async def test_commands_select_and_check_input(client):
    show_id = await _show(client, "Party")
    r = await client.post("/api/integration/command", json={"action": "select_show", "show": "Party"})
    assert r.status == 200
    assert (await (await client.get("/api/integration")).json())["selected_show"] == show_id
    assert (await client.post("/api/integration/command", json={"action": "select_show", "show": "Nope"})).status == 400
    assert (await client.post("/api/integration/command", json={"action": "fly"})).status == 400
    assert (await client.post("/api/integration/command", json=["x"])).status == 400
    r = await client.post("/api/integration/command", json={"action": "season", "season": "Halloween", "out": False})
    assert r.status == 200
    state = await (await client.get("/api/integration")).json()
    assert next(s for s in state["seasons"] if s["name"] == "Halloween")["out"] is False
    assert (await client.post("/api/integration/command", json={"action": "light", "on": True})).status == 400  # no scenes


async def test_claim_and_release(client):
    assert (await client.post("/api/integration/claim", json={"on": "yes"})).status == 400
    assert (await (await client.post("/api/integration/claim", json={"on": True})).json())["claimed"] is True
    assert (await (await client.get("/api/integration")).json())["claimed"] is True
    await client.post("/api/integration/claim", json={"on": False})
    assert (await (await client.get("/api/integration")).json())["claimed"] is False


async def test_websocket_sends_state_and_changes(client):
    async with client.ws_connect("/api/integration/ws") as ws:
        first = json.loads((await ws.receive(timeout=2)).data)
        assert first["type"] == "state" and first["state"]["shows"] == []
        await _show(client, "Party")
        msg = json.loads((await ws.receive(timeout=3)).data)
        assert [s["name"] for s in msg["state"]["shows"]] == ["Party"]


async def test_mqtt_withdraws_its_entities_while_claimed(runner):
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/select/haliday_show/show/config"] != b""
    integration.set_claimed(runner.storage, True)
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/select/haliday_show/show/config"] == b""
    assert bridge.client.published["homeassistant/light/haliday_show/scenes/config"] == b""
    assert bridge.client.published["homeassistant/switch/haliday_show/season_halloween/config"] == b""
    assert bridge.client.published["haliday_show/status"] == "idle"  # topics still answer
    integration.set_claimed(runner.storage, False)
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/select/haliday_show/show/config"] != b""


def test_hub_refresh_follows_mqtt_refresh(runner):
    bridge = mqtt.MqttBridge(runner)
    hub = integration.Hub(runner)
    bridge.on_refresh.append(hub.refresh)
    bridge.refresh()
    assert hub._changed.is_set()


async def test_announces_itself_to_the_supervisor():
    sent = []

    class FakeHA:
        supervisor = "http://supervisor"

        async def _request(self, method, url, json=None):
            sent.append((method, url, json))

    await integration.announce(FakeHA(), 8099)
    assert sent == [("POST", "http://supervisor/discovery",
                     {"service": "haliday_show", "config": {"host": "127.0.0.1", "port": 8099}})]
    FakeHA.supervisor = None  # Docker and pipx: nothing to tell
    await integration.announce(FakeHA(), 8099)
    assert len(sent) == 1


def test_integration_speaks_the_same_api():
    import json
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "custom_components" / "haliday_show"
    assert f"API = {integration.API}" in (root / "const.py").read_text()
    from halidayshow import __version__
    assert json.loads((root / "manifest.json").read_text())["version"] == __version__


async def test_play_options_and_skip_are_checked(client):
    await _show(client, "Party")
    bad = await client.post("/api/integration/command", json={"action": "play", "show": "Party",
                                                                  "media_player": "light.porch"})
    assert bad.status == 400
    r = await client.post("/api/integration/command", json={"action": "skip"})
    assert r.status == 400 and "nothing to skip" in await r.text()
    assert server._clean_integration_command({"action": "play", "position": -5})["position"] == 0.0
    assert "position" not in server._clean_integration_command({"action": "play", "position": float("nan")})


async def test_hub_events_reach_the_integration(client):
    async with client.ws_connect("/api/integration/ws") as ws:
        await ws.receive(timeout=2)
        await client.put("/api/preshow/last", json={"level": "ok", "problems": 0, "warnings": 0})
        msg = json.loads((await ws.receive(timeout=2)).data)
        assert msg == {"type": "event", "event": "preshow_check", "data": {"level": "ok", "problems": 0, "warnings": 0}}


async def test_snapshot_has_the_sensor_details(client):
    state = await (await client.get("/api/integration")).json()
    assert state["playing"] is None and state["next"] is None and state["listening"] == 0
    assert state["queue"] == {"mode": "queue", "waiting": 0, "names": []}
    assert state["page"] == {"on": False, "open": False}
    await client.put("/api/preshow/last", json={"level": "warn", "problems": 0, "warnings": 1})
    state = await (await client.get("/api/integration")).json()
    assert state["preshow"]["level"] == "warn"


async def test_library_and_images_for_the_cards(client):
    await _show(client, "Party")
    await client.put("/api/library-folders", json={"kind": "shows", "folders": [{"id": "f1", "name": "Fun", "items": ["party"]}]})
    lib = await (await client.get("/api/integration/library")).json()
    assert [s["name"] for s in lib["shows"]] == ["Party"] and lib["shows"][0]["picture"] == 0
    assert lib["folders"]["shows"][0]["items"] == ["party"] and lib["playlists"] == []
    assert (await client.get("/api/integration/image/party")).status == 404
    assert (await client.get("/api/integration/image/..%2Fsettings")).status in (400, 404)


def test_scene_colours_for_the_buttons():
    looks = {"lights": {"a": {"effect": "twinkle", "params": {"color": "#FF0000", "color2": "#00ff00", "color3": "#0000ff",
                                                              "count": 2}},
                        "b": {"params": {"color": "#ff0000", "color2": "#ffffff", "speed": 5}}}}
    assert integration.scene_colours(looks) == ["#ff0000", "#00ff00", "#ffffff"]  # count respected, no repeats
    assert integration.scene_colours({"tracks": [{"clips": [{"params": {"color": "#123456"}}]}]}) == ["#123456"]
    assert integration.scene_colours({"lights": "junk", "tracks": [None, {"clips": [None]}]}) == []
