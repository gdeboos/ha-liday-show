import json
import os

from halidayshow import migrate
from halidayshow.storage import Storage


def _old_addon(tmp_path):
    root = tmp_path / "addon_configs"
    old = root / "a1b2c3d4_govee_show"
    (old / "shows").mkdir(parents=True)
    (old / "songs").mkdir()
    (old / "devices.json").write_text(json.dumps([{"id": "pillars", "name": "Pillars"}]))
    (old / "settings.json").write_text(json.dumps({"speaker_delays": {"media_player.kitchen": 120}}))
    show = {"name": "Party", "audio": {"source": "media", "path": "govee_show/song.mp3"}}
    (old / "shows" / "party.json").write_text(json.dumps(show))
    (old / "shows" / "party.gshow").write_bytes(b"baked")
    (old / "house.jpg").write_bytes(b"jpg")
    os.utime(old / "shows" / "party.json", (1_700_000_000, 1_700_000_000))
    media = tmp_path / "media"
    (media / "govee_show").mkdir(parents=True)
    (media / "govee_show" / "song.mp3").write_bytes(b"mp3")
    return root, old, media


async def test_imports_everything_once(tmp_path):
    root, old, media = _old_addon(tmp_path)
    old_store = Storage(old, media)
    assert old_store.save_song_info("media", "govee_show/song.mp3", {"tempo": 120})
    cfg = tmp_path / "config"

    done = migrate.import_old(cfg, media, root)
    assert done["files"] == 6 and done["songs"] == 1

    store = Storage(cfg, media)
    assert store.load_devices()[0]["name"] == "Pillars"
    assert store.load_settings()["speaker_delays"] == {"media_player.kitchen": 120}
    show = store.load_show("party")
    assert show["audio"]["path"] == "haliday_show/song.mp3"
    assert (media / "haliday_show" / "song.mp3").read_bytes() == b"mp3"
    assert store.list_shows()[0]["modified"] == 1_700_000_000  # "last changed" survives
    assert store.house_photo() is not None
    assert store.load_song_info("media", "haliday_show/song.mp3") == {"tempo": 120}
    # The old add-on is left exactly as it was.
    assert json.loads((old / "shows" / "party.json").read_text())["audio"]["path"] == "govee_show/song.mp3"
    assert (media / "govee_show" / "song.mp3").exists()

    (cfg / "devices.json").write_text("[]")
    assert migrate.import_old(cfg, media, root) is None  # only ever once
    assert Storage(cfg, media).load_devices() == []


def test_leaves_an_already_set_up_addon_alone(tmp_path):
    root, _, media = _old_addon(tmp_path)
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "devices.json").write_text("[]")
    assert migrate.import_old(cfg, media, root) is None
    assert not (cfg / "shows").exists()


def test_nothing_to_import(tmp_path):
    assert migrate.import_old(tmp_path / "config", tmp_path / "media", tmp_path / "missing") is None
    assert not (tmp_path / "config" / migrate.MARKER).exists()


def test_saved_lights_without_a_kind_are_marked_govee(tmp_path):
    store = Storage(tmp_path / "config", tmp_path / "media")
    store.save_devices([{"id": "a", "ip": "10.0.0.1", "segments": 15},
                        {"id": "b", "kind": "wled", "ip": "10.0.0.2", "segments": 60}])
    assert migrate.fill_device_kinds(store) == 1
    assert store.load_devices() == [{"id": "a", "ip": "10.0.0.1", "segments": 15, "kind": "govee"},
                                    {"id": "b", "kind": "wled", "ip": "10.0.0.2", "segments": 60}]
    before = store.devices_file.stat().st_mtime_ns
    assert migrate.fill_device_kinds(store) == 0  # nothing to do: the file isn't rewritten
    assert store.devices_file.stat().st_mtime_ns == before
    assert migrate.fill_device_kinds(Storage(tmp_path / "empty", tmp_path / "media")) == 0


def test_parts_stretch_to_keep_their_share_of_the_light():
    parts = [{"id": "p1", "name": "Left", "from": 1, "to": 100}, {"id": "p2", "name": "Center", "from": 101, "to": 200},
             {"id": "p3", "name": "Right", "from": 201, "to": 300}]
    assert [(p["from"], p["to"]) for p in migrate.stretch_parts(parts, 300, 44)] == [(1, 15), (16, 29), (30, 44)]
    assert [(p["from"], p["to"]) for p in migrate.stretch_parts(parts, 300, 600)] == [(1, 200), (201, 400), (401, 600)]
    assert migrate.stretch_parts(parts, 300, 300) == parts
    assert [p["id"] for p in migrate.stretch_parts(parts, 300, 2)] == ["p1", "p2"]  # no room left for Right


def test_lights_on_retired_govee_protocols_move_to_realtime(tmp_path):
    store = Storage(tmp_path / "config", tmp_path / "media")
    parts = [{"id": "p1", "name": "Left", "from": 1, "to": 150}, {"id": "p2", "name": "Right", "from": 151, "to": 300}]
    store.save_devices([
        {"id": "pillars", "kind": "govee", "name": "Pillars", "sku": "H70C5", "segments": 300, "protocol": "pixels",
         "parts": parts},
        {"id": "strip", "kind": "govee", "name": "Strip", "sku": "H6199", "segments": 400, "protocol": "segments"},
        {"id": "bar", "kind": "govee", "name": "Bar", "segments": 15, "protocol": "v2"},
        {"id": "ok", "kind": "govee", "name": "Ok", "segments": 300, "protocol": "whole"},
        {"id": "w", "kind": "wled", "name": "W", "segments": 300, "protocol": "ddp"}])
    assert migrate.retire_govee_protocols(store) == ["Pillars", "Strip", "Bar"]
    by = store.devices_by_id()
    assert (by["pillars"]["protocol"], by["pillars"]["segments"]) == ("standard", 44)  # its realtime reach
    assert [(p["from"], p["to"]) for p in by["pillars"]["parts"]] == [(1, 22), (23, 44)]
    assert (by["strip"]["protocol"], by["strip"]["segments"]) == ("standard", 255)
    assert (by["bar"]["protocol"], by["bar"]["segments"]) == ("standard", 15)
    assert by["ok"]["protocol"] == "whole" and by["w"]["protocol"] == "ddp"
    assert migrate.retire_govee_protocols(store) == []


def test_govee_scene_clips_come_out_of_shows_and_bakes(tmp_path):
    from halidayshow import baked
    store = Storage(tmp_path / "config", tmp_path / "media")
    scene = {"effect": "scene", "start": 0, "end": 1, "code": 7, "param": ""}
    plain = {"effect": "solid", "start": 1, "end": 2}
    store.save_show("xmas", {"name": "Xmas", "tracks": [{"device": "a", "clips": [scene, plain]}]})
    store.save_show("calm", {"name": "Calm", "tracks": [{"device": "a", "clips": [plain]}]})
    blob = baked.encode(2, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 4,
                        {"scenes": [{"track": 0, "start": 1, "end": 3, "code": 7, "param": ""}]})
    store.save_baked("xmas", blob)
    (store.shows_dir / "archived").mkdir()
    (store.shows_dir / "archived" / "old.json").write_text(json.dumps({"name": "Old", "tracks": [{"device": "a", "clips": [scene]}]}))
    store.save_settings({"playlists": [{"id": "p", "items": [{"type": "effect", "id": "b1", "seconds": 5, "effect": "scene", "params": {}},
                                                             {"type": "show", "id": "xmas"}]}]})
    (store.config_dir / "scenes").mkdir()
    (store.config_dir / "scenes" / "H70C5.json").write_text("[]")

    done = migrate.drop_govee_scenes(store)
    assert done == {"clips": 2, "shows": ["Xmas", "Old"], "blocks": 1}
    assert store.load_show("xmas")["tracks"][0]["clips"] == [plain]
    b = store.load_baked("xmas")  # kept, so the show still plays, with the scene stretch dark
    assert b is not None and b"scenes" not in b
    assert [baked.decode(b).track_frame(baked.decode(b).tracks[0], i) for i in range(4)] == \
        [b"\x01\x02\x03", bytes(3), bytes(3), b"\x01\x02\x03"]
    assert store.load_settings()["playlists"][0]["items"][0] == {"type": "off", "id": "b1", "seconds": 5}
    assert not (store.config_dir / "scenes").exists()
    assert migrate.drop_govee_scenes(store) == {"clips": 0, "shows": [], "blocks": 0}


def test_what_the_clear_out_changed_is_kept_for_the_editor(tmp_path):
    store = Storage(tmp_path / "config", tmp_path / "media")
    assert migrate.retire_govee_extras(store) is None and migrate.retired(store.config_dir) is None
    store.save_devices([{"id": "a", "kind": "govee", "name": "Pillars", "segments": 15, "protocol": "razer"}])
    done = migrate.retire_govee_extras(store)
    assert (done["lights"], done["clips"]) == (["Pillars"], 0)
    assert migrate.retired(store.config_dir)["at"] == done["at"]
