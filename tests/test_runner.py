import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from halidayshow import baked, commands, migrate, mqtt
from halidayshow.ha import media_content_id, position_now
from halidayshow.output import Output
from halidayshow.player import Player
from halidayshow.runner import Runner, RunnerError
from halidayshow.storage import Storage


class FakeHA:
    available = True

    def __init__(self):
        self.calls = []
        self.state_value = "idle"

    async def call(self, domain, service, data):
        self.calls.append((f"{domain}.{service}", data))
        if service == "play_media":
            self.state_value = "playing"

    async def state(self, entity):
        now = datetime.now(timezone.utc)
        return {"state": self.state_value, "last_updated": now.isoformat(),
                "attributes": {"media_position": 0, "media_position_updated_at": now.isoformat()}}


@pytest.fixture
async def runner(tmp_path):
    storage = Storage(tmp_path / "config", tmp_path / "media")
    storage.save_devices([{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    storage.save_show("party", {"name": "Party", "audio": {"source": "media", "path": "music/Party Mix.mp3"},
                                "media_player": "media_player.garden", "tracks": []})
    storage.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400))
    settings = storage.load_settings()
    settings["speaker_delays"]["media_player.garden"] = 300
    storage.save_settings(settings)
    output = Output()
    output.start()
    r = Runner(storage, Player(output), FakeHA())
    yield r
    await r.stop()
    await output.close()


def test_media_content_id_quotes_path():
    assert media_content_id("music/Party Mix.mp3") == "media-source://media_source/local/music/Party%20Mix.mp3"


def test_position_now_extrapolates():
    now = datetime(2026, 10, 20, 12, 0, 10, tzinfo=timezone.utc)
    st = {"attributes": {"media_position": 30, "media_position_updated_at": (now - timedelta(seconds=2)).isoformat()}}
    assert position_now(st, now) == 32
    assert position_now({"attributes": {}}, now) is None


async def test_automation_plays_on_the_shows_speaker(runner):
    msg = await commands.handle(runner, '{"action": "play", "show": "Party"}')
    assert msg == "playing party"
    assert runner.ha.calls[0] == ("media_player.play_media", {
        "entity_id": "media_player.garden",
        "media_content_id": "media-source://media_source/local/music/Party%20Mix.mp3",
        "media_content_type": "music"})
    st = runner.status()
    assert st["playing"] and st["media_player"] == "media_player.garden"
    assert runner.player.offset == pytest.approx(0.3)  # the speaker's delay
    await commands.handle(runner, "stop")
    assert runner.ha.calls[-1] == ("media_player.media_stop", {"entity_id": "media_player.garden"})
    assert not runner.status()["playing"]


async def test_automation_falls_back_to_the_default_show_speaker(runner):
    show = runner.storage.load_show("party")
    show["media_player"] = None
    runner.storage.save_show("party", show)
    runner.storage.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400))
    await runner.play("party", use_show_speaker=True)
    assert runner.ha.calls == [] and runner.status()["playing"]  # no default yet: lights only
    settings = runner.storage.load_settings()
    settings["show_speaker"] = "media_player.porch"
    runner.storage.save_settings(settings)
    await runner.play("party", use_show_speaker=True)
    assert runner.ha.calls[-1][1]["entity_id"] == "media_player.porch"


async def test_lights_stop_when_speaker_stops(runner, monkeypatch):
    monkeypatch.setattr("halidayshow.runner.FOLLOW_EVERY_S", 0.05)
    await runner.play("party", use_show_speaker=True)
    runner.ha.state_value = "paused"
    await asyncio.sleep(0.2)
    assert not runner.player.playing


async def test_play_without_speaker_runs_lights_only(runner):
    await runner.play("party")
    assert runner.ha.calls == [] and runner.status()["playing"]


async def test_missing_show(runner):
    with pytest.raises(RunnerError):
        await runner.play("nope")


def test_mqtt_options_and_discovery():
    opts = mqtt.show_options([{"id": "a", "name": "Xmas"}, {"id": "b", "name": "Xmas"}, {"id": "c", "name": "Boo"}])
    assert opts == {"Xmas (a)": "a", "Xmas (b)": "b", "Boo": "c"}
    cfgs = mqtt.discovery_configs(list(opts))
    select = cfgs["homeassistant/select/haliday_show/show/config"]
    assert select["options"] == ["Xmas (a)", "Xmas (b)", "Boo"]
    assert {c["unique_id"] for c in cfgs.values()} == {
        "haliday_show_show", "haliday_show_play", "haliday_show_stop", "haliday_show_status"}


class FakeClient:
    def __init__(self):
        self.published = {}

    async def publish(self, topic, payload, retain=False):
        self.published[topic] = payload


async def test_mqtt_select_then_press_plays(runner):
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    assert bridge.client.published["haliday_show/status"] == "idle"
    await bridge._on_message("haliday_show/show/set", b"Party")
    assert bridge.client.published["haliday_show/show/state"] == "Party"
    await bridge._on_message("haliday_show/play", b"PRESS")
    await asyncio.sleep(0.05)
    assert runner.status()["media_player"] == "media_player.garden"
    await bridge._publish_status()
    assert bridge.client.published["haliday_show/status"] == "Party"
    await bridge._on_message("haliday_show/stop", b"PRESS")
    assert not runner.status()["playing"]


async def test_mqtt_clears_old_entities_once_after_import(runner):
    cfg = runner.storage.config_dir
    bridge = mqtt.MqttBridge(runner)
    bridge.client = FakeClient()
    await bridge._publish_all()
    assert "homeassistant/select/govee_show/show/config" not in bridge.client.published
    (cfg / migrate.MARKER).write_text('{"files": 3}')
    await bridge._publish_all()
    assert bridge.client.published["homeassistant/select/govee_show/show/config"] == b""
    assert bridge.client.published["govee_show/availability"] == b""
    bridge.client = FakeClient()
    await bridge._publish_all()
    assert "homeassistant/select/govee_show/show/config" not in bridge.client.published


def test_stdin_stream_splitting():
    out, rest = commands.split_stream('{"action":"play","show":"x"}"stop"{"action":"st')
    assert out == ['{"action":"play","show":"x"}', '"stop"'] and rest == '{"action":"st'
    assert commands.parse('"stop"') == {"action": "stop", "show": ""}
    assert commands.parse("play My Show") == {"action": "play", "show": "My Show"}


def _short_show(storage, show_id, frames=4):
    """A lights-only show lasting frames/40 seconds."""
    storage.save_show(show_id, {"name": show_id.title(), "tracks": []})
    storage.save_baked(show_id, baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * frames))


def _save_playlists(storage, playlists):
    settings = storage.load_settings()
    settings["playlists"] = playlists
    storage.save_settings(settings)


async def test_playlist_plays_shows_in_order_round_and_round(runner, monkeypatch):
    for s in ("one", "two"):
        _short_show(runner.storage, s)
    started = []
    real_play = runner.player.play

    async def play(show_id, *a, **kw):
        started.append(show_id)
        await real_play(show_id, *a, **kw)
    monkeypatch.setattr(runner.player, "play", play)
    await runner.play_playlist({"id": "night", "name": "Night", "shows": ["one", "gone", "two"], "gap": 0})
    assert runner.status()["playlist"] == {"id": "night", "name": "Night"}
    for _ in range(100):
        if len(started) >= 4:
            break
        await asyncio.sleep(0.05)
    assert started[:4] == ["one", "two", "one", "two"]  # the deleted show is skipped
    await runner.stop()
    assert runner.status()["playlist"] is None and not runner.player.playing


async def test_playlist_pauses_between_shows(runner):
    for s in ("one", "two"):
        _short_show(runner.storage, s)
    await runner.play_playlist({"id": "night", "name": "Night", "shows": ["one", "two"], "gap": 5})
    await asyncio.sleep(0.4)  # "one" lasts 0.1 s, then the pause
    assert not runner.player.playing and runner.status()["playlist"]["id"] == "night"
    assert runner.player.show_id == "one"


async def test_playing_a_show_ends_the_playlist(runner):
    _short_show(runner.storage, "one", frames=400)
    await runner.play_playlist({"id": "night", "name": "Night", "shows": ["one"], "gap": 0})
    await asyncio.sleep(0.05)
    await runner.play("party")
    assert runner.status()["playlist"] is None and runner.player.show_id == "party"


async def test_playlist_with_nothing_to_play(runner):
    with pytest.raises(RunnerError):
        await runner.play_playlist({"id": "x", "name": "X", "shows": ["gone"], "gap": 0})


async def test_automation_plays_a_playlist_by_name(runner):
    _short_show(runner.storage, "one", frames=400)
    _save_playlists(runner.storage, [{"id": "night", "name": "Halloween night", "shows": ["one"], "gap": 5}])
    assert await commands.handle(runner, '{"action": "play", "playlist": "halloween NIGHT"}') == "playing playlist night"
    assert runner.status()["playlist"]["name"] == "Halloween night"
    with pytest.raises(ValueError):
        await commands.handle(runner, '{"action": "play", "playlist": "nope"}')
