import asyncio
import base64
import json

import pytest

from halidayshow import baked, server


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    media = tmp_path / "media"
    (media / "songs").mkdir(parents=True)
    (media / "songs" / "tune.mp3").write_bytes(b"ID3fake")
    (media / "notes.txt").write_text("not audio")
    app = server.make_app(tmp_path / "config", media, allow_all=True)
    return await aiohttp_client(app)


async def test_index_uses_relative_urls(client):
    resp = await client.get("/")
    html = await resp.text()
    assert resp.status == 200
    assert 'href="static/' in html and 'src="static/' in html
    assert 'href="/' not in html and 'src="/' not in html


@pytest.mark.parametrize("peer,allowed", [("172.30.32.2", True), ("127.0.0.1", True),
                                          ("192.168.1.20", False)])
async def test_only_ingress_proxy_may_connect(tmp_path, peer, allowed):
    from unittest import mock

    from aiohttp import web
    from aiohttp.test_utils import make_mocked_request

    app = server.make_app(tmp_path / "c", tmp_path / "m")
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda k, d=None: (peer, 5000) if k == "peername" else d
    req = make_mocked_request("GET", "/api/info", app=app, transport=transport)

    async def handler(request):
        return web.Response(text="ok")

    if allowed:
        assert (await server.ingress_only(req, handler)).text == "ok"
    else:
        with pytest.raises(web.HTTPForbidden):
            await server.ingress_only(req, handler)


def _lan_request(app, headers=None):
    from unittest import mock

    from aiohttp.test_utils import make_mocked_request

    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda k, d=None: ("192.168.1.20", 5000) if k == "peername" else d
    return make_mocked_request("GET", "/api/info", headers=headers or {}, app=app, transport=transport)


@pytest.mark.parametrize("auth,allowed", [(None, False), ("anyone:secret", True), (":secret", True),
                                          ("anyone:wrong", False), ("not base64", False)])
async def test_password_lets_other_devices_in(tmp_path, auth, allowed):
    import base64

    from aiohttp import web

    app = server.make_app(tmp_path / "c", tmp_path / "m", password="secret")
    headers = {}
    if auth == "not base64":
        headers["Authorization"] = "Basic !!!"
    elif auth:
        headers["Authorization"] = "Basic " + base64.b64encode(auth.encode()).decode()

    async def handler(request):
        return web.Response(text="ok")

    if allowed:
        assert (await server.ingress_only(_lan_request(app, headers), handler)).text == "ok"
    else:
        with pytest.raises(web.HTTPUnauthorized) as e:
            await server.ingress_only(_lan_request(app, headers), handler)
        assert e.value.headers["WWW-Authenticate"].startswith("Basic")


async def test_no_password_still_refuses_other_devices(tmp_path, monkeypatch):
    from aiohttp import web

    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    app = server.make_app(tmp_path / "c", tmp_path / "m")

    async def handler(request):
        return web.Response(text="ok")

    with pytest.raises(web.HTTPForbidden) as e:
        await server.ingress_only(_lan_request(app), handler)
    assert "HALIDAY_SHOW_PASSWORD" in e.value.text


def test_password_is_ignored_inside_home_assistant(monkeypatch):
    from halidayshow import __main__ as entry

    seen = {}
    monkeypatch.setenv("SUPERVISOR_TOKEN", "t")
    monkeypatch.setenv("HALIDAY_SHOW_PASSWORD", "secret")
    monkeypatch.setattr(entry, "make_app", lambda *a, **kw: seen.update(kw))
    monkeypatch.setattr(entry.web, "run_app", lambda *a, **kw: None)
    entry.main()
    assert seen["password"] == ""


async def test_mqtt_broker_from_environment(monkeypatch):
    from halidayshow.ha import HomeAssistant

    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    monkeypatch.delenv("HALIDAY_SHOW_MQTT_HOST", raising=False)
    assert await HomeAssistant().mqtt_service() is None
    monkeypatch.setenv("HALIDAY_SHOW_MQTT_HOST", "broker.lan")
    monkeypatch.setenv("HALIDAY_SHOW_MQTT_USERNAME", "me")
    assert await HomeAssistant().mqtt_service() == {"host": "broker.lan", "port": 1883,
                                                    "username": "me", "password": None}


async def test_devices_round_trip_and_validation(client):
    resp = await client.put("/api/devices", json=[{"ip": "192.168.1.50", "name": "Porch", "segments": 12}])
    assert resp.status == 200
    devices = await (await client.get("/api/devices")).json()
    assert devices == [{"id": "192.168.1.50", "name": "Porch", "kind": "govee", "ip": "192.168.1.50", "sku": "",
                        "segments": 12, "reverse": False, "gradient": False,
                        "protocol": "standard", "brightness": 100, "bulbs": None, "parts": [], "whole": True}]
    resp = await client.put("/api/devices", json=[{"ip": "192.168.1.50", "segments": 12, "bulbs": 200}])
    assert (await resp.json())[0]["bulbs"] == 200
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "bulbs": 5000}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "brightness": 0}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "protocol": "dmx"}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "nope"}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "segments": 0}])).status == 400
    # The whole list saves at once, so the error names the light that's wrong.
    resp = await client.put("/api/devices", json=[{"id": "t1", "name": "Test 1"},
                                                     {"id": "p", "name": "Pillars", "segments": 300}])
    assert resp.status == 400 and (await resp.text()).startswith("Pillars: segments must be 1-255")


async def test_device_parts_validation(client):
    roof = {"ip": "192.168.1.60", "name": "Roof", "segments": 60}
    parts = [{"id": "side", "name": "Side", "from": 24, "to": 40}, {"id": "front", "name": "Front roof", "from": 3, "to": 23}]
    resp = await client.put("/api/devices", json=[{**roof, "parts": parts}])
    assert resp.status == 200
    assert [p["id"] for p in (await resp.json())[0]["parts"]] == ["front", "side"]  # in segment order
    for bad in ([{"id": "a", "from": 0, "to": 3}], [{"id": "a", "from": 3, "to": 61}],
                [{"id": "a", "from": 5, "to": 3}], [{"id": "a", "from": 1, "to": 5}, {"id": "b", "from": 5, "to": 9}],
                [{"id": "a", "from": 1, "to": 2}, {"id": "a", "from": 3, "to": 4}], [{"id": "bad id!", "from": 1, "to": 2}],
                [{"name": "x"}], "nope"):
        assert (await client.put("/api/devices", json=[{**roof, "parts": bad}])).status == 400


async def test_show_lifecycle(client):
    show_id = (await (await client.post("/api/shows", json={"name": "Halloween 2026!"})).json())["id"]
    assert show_id == "halloween-2026"
    show = {"name": "Halloween 2026!", "fps": 40, "duration": 1, "beats": [0.5],
            "tracks": [{"device": "a", "clips": []}]}
    assert (await client.put(f"/api/shows/{show_id}", json=show)).status == 200
    assert await (await client.get(f"/api/shows/{show_id}")).json() == show
    # A second show with the same name gets its own id.
    assert (await (await client.post("/api/shows", json={"name": "Halloween 2026!"})).json())["id"] == \
        "halloween-2026-2"

    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 40)
    assert (await client.put(f"/api/shows/{show_id}/baked", data=blob)).status == 200
    assert (await client.put(f"/api/shows/{show_id}/baked", data=b"junk")).status == 400
    listed = await (await client.get("/api/shows")).json()
    assert listed[0]["id"] == show_id and listed[0]["baked"] is True

    # Saving the show again invalidates the bake.
    await client.put(f"/api/shows/{show_id}", json=show)
    assert (await (await client.get("/api/shows")).json())[0]["baked"] is False

    assert (await client.delete(f"/api/shows/{show_id}")).status == 200
    assert (await client.get(f"/api/shows/{show_id}")).status == 404
    assert (await client.get("/api/shows/..%2Fdevices")).status in (400, 404)


async def test_shows_can_be_duplicated_and_renamed_keeping_their_bake(client):
    show_id = (await (await client.post("/api/shows", json={"name": "Xmas"})).json())["id"]
    show = {"name": "Xmas", "duration": 1, "audio": {"source": "media", "path": "carols/bells.mp3"},
            "tracks": [{"device": "a", "clips": []}]}
    await client.put(f"/api/shows/{show_id}", json=show)
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 40)
    await client.put(f"/api/shows/{show_id}/baked", data=blob)

    r = await client.post(f"/api/shows/{show_id}/duplicate", json={"name": "  Xmas   copy "})
    copy_id = (await r.json())["id"]
    assert copy_id == "xmas-copy"
    listed = {s["id"]: s for s in await (await client.get("/api/shows")).json()}
    assert listed[copy_id]["name"] == "Xmas copy" and listed[copy_id]["baked"] is True
    assert listed[copy_id]["song"] == "carols/bells.mp3"
    assert (await (await client.get(f"/api/shows/{copy_id}")).json())["tracks"] == show["tracks"]

    assert (await client.post(f"/api/shows/{show_id}/rename", json={"name": "Christmas Eve"})).status == 200
    listed = {s["id"]: s for s in await (await client.get("/api/shows")).json()}
    assert listed[show_id]["name"] == "Christmas Eve" and listed[show_id]["baked"] is True

    assert (await client.post(f"/api/shows/{show_id}/rename", json={"name": "  "})).status == 400
    # Two shows can't share a name, as automations can start a show by its name.
    assert (await client.post(f"/api/shows/{show_id}/rename", json={"name": "xmas COPY"})).status == 409
    assert (await client.post(f"/api/shows/{show_id}/duplicate", json={"name": "Xmas copy"})).status == 409
    assert (await client.post(f"/api/shows/{show_id}/rename", json={"name": "Christmas eve"})).status == 200
    assert (await client.post("/api/shows/nope/rename", json={"name": "A"})).status == 404
    assert (await client.post("/api/shows/nope/duplicate", json={"name": "A"})).status == 404
    assert (await client.post("/api/shows/Bad%20Id/rename", json={"name": "A"})).status == 400


async def test_song_info_is_kept_per_file_until_the_file_changes(client, tmp_path):
    q = {"source": "media", "path": "songs/tune.mp3"}
    assert await (await client.get("/api/audio/info", params=q)).json() is None
    info = {"tempo": 120, "beats": [0.5, 1.0], "bars": [0.5],
            "sections": [{"start": 0, "end": 1.5, "label": "Intro", "energy": 0.3}]}
    assert (await client.put("/api/audio/info", params=q, json=info)).status == 200
    assert await (await client.get("/api/audio/info", params=q)).json() == {
        "tempo": 120, "beats": [0.5, 1.0], "bars": [0.5],
        "sections": [{"start": 0.0, "end": 1.5, "label": "Intro", "energy": 0.3}]}
    coloured = {**info, "sections": [{**info["sections"][0], "color": "#AABBCC", "notes": "  bells only " + "x" * 400}]}
    assert (await client.put("/api/audio/info", params=q, json=coloured)).status == 200
    saved = (await (await client.get("/api/audio/info", params=q)).json())["sections"][0]
    assert saved["color"] == "#aabbcc"
    assert saved["notes"].startswith("bells only x") and len(saved["notes"]) == 300
    for bad in ({"beats": [-1]}, {"beats": "x"}, {"tempo": "fast"}, {"sections": [{"start": "a"}]}, [],
                {"sections": [{"start": 0, "end": 1, "color": "red"}]},
                {"sections": [{"start": 0, "end": 1, "notes": 5}]}):
        assert (await client.put("/api/audio/info", params=q, json=bad)).status == 400
    missing = {"source": "media", "path": "songs/none.mp3"}
    assert (await client.put("/api/audio/info", params=missing, json=info)).status == 404
    songs = {x["path"]: x for x in (await (await client.get("/api/songs")).json())["songs"]}
    assert songs["songs/tune.mp3"]["detected"] is True
    assert songs["songs/tune.mp3"]["tempo"] == 120 and songs["songs/tune.mp3"]["sections"] == 1
    assert songs["songs/tune.mp3"]["size"] > 0
    # Replacing the file drops the old results.
    (tmp_path / "media" / "songs" / "tune.mp3").write_bytes(b"ID3 a different song")
    assert await (await client.get("/api/audio/info", params=q)).json() is None
    songs = {x["path"]: x for x in (await (await client.get("/api/songs")).json())["songs"]}
    assert songs["songs/tune.mp3"]["detected"] is False and songs["songs/tune.mp3"]["sections"] == 0


def test_the_song_list_says_when_it_stopped_short(tmp_path):
    from halidayshow.storage import Storage
    media = tmp_path / "media"
    (media / "a").mkdir(parents=True)
    for name in ("one.mp3", "two.mp3", "three.wav"):
        (media / "a" / name).write_bytes(b"ID3 tune")
    (media / "a" / "photo.jpg").write_bytes(b"not a song")
    st = Storage(tmp_path / "config", media)
    assert st.list_songs(limit=2)["more"] is True and len(st.list_songs(limit=2)["songs"]) == 2
    full = st.list_songs()
    assert full["more"] is False and sorted(x["path"] for x in full["songs"]) == ["a/one.mp3", "a/three.wav", "a/two.mp3"]


async def test_audio_listing_upload_and_path_safety(client):
    listed = await (await client.get("/api/audio")).json()
    assert listed == [{"source": "media", "path": "songs/tune.mp3"}]
    resp = await client.get("/api/audio/file", params={"source": "media", "path": "songs/tune.mp3"})
    assert resp.status == 200 and await resp.read() == b"ID3fake"
    for path in ("../config/devices.json", "notes.txt", "/etc/passwd"):
        resp = await client.get("/api/audio/file", params={"source": "media", "path": path})
        assert resp.status == 404

    import aiohttp
    form = aiohttp.FormData()
    form.add_field("file", b"OggS", filename="../evil/song.ogg")
    ref = await (await client.post("/api/audio", data=form)).json()
    # Uploads land in /media/haliday_show so HA media players can reach them.
    assert ref["source"] == "media" and ref["path"].startswith("haliday_show/")
    assert ref["path"].endswith("song.ogg") and ".." not in ref["path"]
    listed = await (await client.get("/api/audio")).json()
    assert {"source": "media", "path": ref["path"]} in listed
    form = aiohttp.FormData()
    form.add_field("file", b"x", filename="script.sh")
    assert (await client.post("/api/audio", data=form)).status == 400


async def test_play_requires_bake_then_streams(client):
    await client.put("/api/devices", json=[{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    await client.put("/api/shows/s", json={"name": "s", "tracks": []})
    resp = await client.post("/api/player/play", json={"show": "s"})
    assert resp.status == 409
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400)
    await client.put("/api/shows/s/baked", data=blob)
    status = await (await client.post("/api/player/play", json={"show": "s", "position": 2})).json()
    assert status["playing"] is True and status["position"] >= 2
    sync = await (await client.post("/api/player/sync", json={"position": 5})).json()
    assert abs(sync["drift"]) > 2  # re-anchored to the browser's position
    assert (await (await client.get("/api/player")).json())["position"] >= 5
    status = await (await client.post("/api/player/stop")).json()
    assert status["playing"] is False


async def test_speakers_without_home_assistant(client, monkeypatch):
    body = await (await client.get("/api/speakers")).json()
    assert body["speakers"] == []
    resp = await client.put("/api/speakers/delay", json={"entity_id": "media_player.garden", "delay_ms": 250})
    assert (await resp.json())["delay_ms"] == 250
    assert (await client.put("/api/speakers/delay", json={"entity_id": "light.x"})).status == 400


async def test_command_endpoint(client):
    await client.put("/api/devices", json=[{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    await client.put("/api/shows/xmas", json={"name": "Christmas Eve", "tracks": []})
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\x00\xff"] * 400)
    await client.put("/api/shows/xmas/baked", data=blob)
    body = await (await client.post("/api/command", data='{"action": "play", "show": "christmas eve"}')).json()
    assert body["playing"] and body["show"] == "xmas" and body["name"] == "Christmas Eve"
    body = await (await client.post("/api/command", data="stop")).json()
    assert body["playing"] is False
    assert (await client.post("/api/command", data='{"action": "play", "show": "nope"}')).status == 400


async def test_planned_devices_save_but_dont_play(client):
    planned = {"id": "planned-porch", "name": "Porch", "ip": "", "segments": 12}
    devices = await (await client.put("/api/devices", json=[planned])).json()
    assert devices[0]["ip"] == "" and devices[0]["id"] == "planned-porch"
    assert (await client.put("/api/devices", json=[{"ip": "", "segments": 5}])).status == 400  # needs an id
    resp = await client.post("/api/devices/test", json=planned)
    assert resp.status == 400 and "link" in await resp.text()

    await client.put("/api/shows/s", json={"name": "s", "tracks": []})
    blob = baked.encode(40, [{"device": "planned-porch", "segments": 12}], [bytes(36)] * 40)
    await client.put("/api/shows/s/baked", data=blob)
    status = await (await client.post("/api/player/play", json={"show": "s"})).json()
    assert status["playing"]  # the timeline still runs; there is just nothing to send to
    await client.post("/api/player/stop")

    # Linking keeps the id, so shows built for the planned light carry over.
    linked = await (await client.put("/api/devices", json=[{**planned, "ip": "192.168.1.60"}])).json()
    assert linked[0]["id"] == "planned-porch" and linked[0]["ip"] == "192.168.1.60"


async def test_custom_palettes_round_trip_and_validation(client):
    assert await (await client.get("/api/palettes")).json() == []
    mine = [{"name": "Porch party", "colors": ["#FF0000", "#00ff00"]}]
    resp = await client.put("/api/palettes", json=mine)
    assert resp.status == 200
    assert await (await client.get("/api/palettes")).json() == [{"name": "Porch party", "colors": ["#ff0000", "#00ff00"]}]
    for bad in ({"name": "x"}, [{"name": "", "colors": ["#ff0000"]}], [{"name": "x", "colors": []}],
                [{"name": "x", "colors": ["red"]}], [{"name": "x", "colors": ["#000000"] * 13}]):
        assert (await client.put("/api/palettes", json=bad)).status == 400


async def test_probe_lights_one_segment_then_stops(client):
    dev = {"ip": "192.0.2.10", "segments": 15}
    resp = await client.post("/api/devices/probe", json={**dev, "segment": 64})
    assert resp.status == 200
    out = client.app[server.OUTPUT]
    await asyncio.sleep(0.01)
    assert out.devices["192.0.2.10"].segments == 64
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 32})).status == 200
    await asyncio.sleep(0.01)
    assert out.devices["192.0.2.10"].segments == 32
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 0})).status == 200
    assert "192.0.2.10" not in out.devices
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 999})).status == 400


async def test_device_test_holds_a_frame_then_stops(client):
    dev = {"ip": "192.0.2.11", "segments": 3, "reverse": True}
    resp = await client.post("/api/devices/test", json={**dev, "rgb": "ff0000" "00ff00" "0000ff"})
    assert resp.status == 200
    await asyncio.sleep(0.01)
    out = client.app[server.OUTPUT].devices["192.0.2.11"]
    assert out.pending or out.last_frame == bytes.fromhex("0000ff00ff00ff0000")  # reversed for the light
    # Changing the light while it's lit sends the new frame without letting go of the light.
    assert (await client.post("/api/devices/test", json={**dev, "segments": 2, "rgb": "ffffff000000"})).status == 200
    await asyncio.sleep(0.01)
    assert client.app[server.OUTPUT].devices["192.0.2.11"] is out and out.segments == 2
    assert (await client.post("/api/devices/test", json={**dev, "stop": True})).status == 200
    assert "192.0.2.11" not in client.app[server.OUTPUT].devices
    for bad in ("ff00", "zz0000ff0000ff0000"):
        assert (await client.post("/api/devices/test", json={**dev, "rgb": bad})).status == 400


async def test_static_files_are_revalidated(client):
    resp = await client.get("/static/js/effects.js")
    assert resp.status == 200
    assert resp.headers["Cache-Control"] == "no-cache"


async def test_live_preview_shows_frames_then_lets_go(client, monkeypatch):
    monkeypatch.setattr(server.LivePreview, "IDLE_S", 0.3)
    dev = {"ip": "192.0.2.11", "segments": 2, "brightness": 50}
    out = client.app[server.OUTPUT]
    resp = await client.post("/api/devices/preview", json={**dev, "rgb": "ff0000" + "00ff00"})
    assert resp.status == 200
    assert out.devices["192.0.2.11"].brightness == 50
    assert out.devices["192.0.2.11"].pending is not None or out.devices["192.0.2.11"].last_frame
    assert (await client.post("/api/devices/preview", json={**dev, "rgb": "ff00"})).status == 400
    assert (await client.post("/api/devices/preview", json={**dev, "rgb": "zz" * 6})).status == 400
    await asyncio.sleep(0.6)  # frames stopped: the light goes back to what it was doing
    assert "192.0.2.11" not in out.devices
    await client.post("/api/devices/preview", json={**dev, "rgb": "000000" * 2})
    assert "192.0.2.11" in out.devices
    assert (await client.post("/api/devices/preview", json={**dev, "stop": True})).status == 200
    assert "192.0.2.11" not in out.devices


async def test_house_photo_and_paths(client):
    assert (await (await client.get("/api/house")).json()) == {"paths": {}, "styles": {}, "pins": {}, "dim": 0.5,
                                                               "photo": False}
    assert (await client.get("/api/house/photo")).status == 404
    resp = await client.put("/api/house/photo", data=b"\xff\xd8fakejpeg", headers={"Content-Type": "image/jpeg"})
    assert resp.status == 200
    resp = await client.get("/api/house/photo")
    assert resp.status == 200 and await resp.read() == b"\xff\xd8fakejpeg"
    # A new photo replaces the old one, even in another format.
    await client.put("/api/house/photo", data=b"\x89PNGfake", headers={"Content-Type": "image/png"})
    assert await (await client.get("/api/house/photo")).read() == b"\x89PNGfake"
    assert (await client.put("/api/house/photo", data=b"x", headers={"Content-Type": "text/plain"})).status == 415

    paths = {"porch": [[0.1, 0.2], [0.5, 0.25]], "empty": []}
    resp = await client.put("/api/house", json={"paths": paths, "dim": 0.7})
    assert (await resp.json()) == {"paths": {"porch": [[0.1, 0.2], [0.5, 0.25]]}, "styles": {}, "pins": {}, "dim": 0.7}
    assert (await (await client.get("/api/house")).json())["photo"] is True
    assert (await client.put("/api/house", json={"paths": {"a": [[2, 0]]}})).status == 400
    assert (await client.put("/api/house", json={"paths": {"a": [["x"]]}})).status == 400
    # A stretch out of view carries its hidden bulb count; one on the first point means nothing.
    resp = await client.put("/api/house", json={"paths": {"eaves": [[0, 0, 5], [0.5, 0], [0.9, 0.1, 12]]}})
    assert (await resp.json())["paths"] == {"eaves": [[0, 0], [0.5, 0], [0.9, 0.1, 12]]}
    assert (await client.put("/api/house", json={"paths": {"a": [[0, 0], [1, 1, -1]]}})).status == 400
    # Icicles keep their drops and length (clamped); a plain line needs no style.
    styles = {"gutter": {"style": "icicle", "drops": 60, "length": 0.9}, "porch": {"style": "line"}}
    resp = await client.put("/api/house", json={"paths": {}, "styles": styles})
    assert (await resp.json())["styles"] == {"gutter": {"style": "icicle", "drops": 60, "length": 0.5}}
    spots = {"flood": {"style": "spots", "beam": 0.4, "aims": [[0, -0.2], [2, 0.1]]}}
    resp = await client.put("/api/house", json={"paths": {}, "styles": spots})
    assert (await resp.json())["styles"] == {"flood": {"style": "spots", "beam": 0.4, "aims": [[0, -0.2], [1, 0.1]]}}
    bad = {"flood": {"style": "spots", "aims": [["x"]]}}
    assert (await client.put("/api/house", json={"paths": {}, "styles": bad})).status == 400
    bad = {"gutter": {"style": "icicle", "drops": "lots"}}
    assert (await client.put("/api/house", json={"paths": {}, "styles": bad})).status == 400

    # Pins hold a segment somewhere along its light's path (clamped to 0-1); a light with no path drops its pins.
    pins = {"porch": {"3": 0.4, 7: 1.5}, "gone": {"1": 0.5}}
    resp = await client.put("/api/house", json={"paths": paths, "pins": pins})
    assert (await resp.json())["pins"] == {"porch": {"3": 0.4, "7": 1}}
    assert (await client.put("/api/house", json={"paths": paths, "pins": {"porch": {"x": 0.1}}})).status == 400
    assert (await client.put("/api/house", json={"paths": paths, "pins": {"porch": {"-1": 0.1}}})).status == 400

    assert (await client.delete("/api/house/photo")).status == 200
    assert (await client.get("/api/house/photo")).status == 404


async def test_default_show_speaker(client):
    assert (await (await client.get("/api/speakers")).json())["show_speaker"] is None
    resp = await client.put("/api/speakers/show", json={"entity_id": "media_player.porch"})
    assert (await resp.json()) == {"show_speaker": "media_player.porch"}
    assert (await (await client.get("/api/speakers")).json())["show_speaker"] == "media_player.porch"
    assert (await client.put("/api/speakers/show", json={"entity_id": "light.porch"})).status == 400
    assert (await (await client.put("/api/speakers/show", json={"entity_id": None})).json()) == {"show_speaker": None}


class FakeSpeakers:
    """Home Assistant with a speaker that plays songs and a TV remote that can't."""
    available = True

    def __init__(self):
        self.calls = []
        self.playing = False

    def _state(self, entity):
        from datetime import datetime, timezone
        features = 512 if entity == "media_player.garden" else 4
        return {"entity_id": entity, "state": "playing" if self.playing else "idle",
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "attributes": {"friendly_name": entity.split(".")[1].title(), "supported_features": features}}

    async def states(self, domain=None):
        return [self._state("media_player.garden"), self._state("media_player.tv")]

    async def state(self, entity):
        return self._state(entity)

    async def call(self, domain, service, data):
        self.calls.append((service, data))
        self.playing = service == "play_media"


async def test_speakers_are_tested_before_the_editor_offers_them(client, monkeypatch):
    ha = FakeSpeakers()
    real = client.app[server.HA]
    monkeypatch.setattr(type(real), "available", True)
    for name in ("states", "state", "call"):
        monkeypatch.setattr(real, name, getattr(ha, name))
    body = await (await client.get("/api/speakers")).json()
    assert body["speakers"] == []
    assert [(c["entity_id"], c["can_play"]) for c in body["candidates"]] == [
        ("media_player.garden", True), ("media_player.tv", False)]

    resp = await (await client.post("/api/speakers/test", json={"entity_id": "media_player.tv"})).json()
    assert not resp["ok"] and "can't be sent a song" in resp["error"]
    resp = await (await client.post("/api/speakers/test", json={"entity_id": "media_player.garden"})).json()
    assert resp["ok"]
    play = ha.calls[0]
    assert play[0] == "play_media" and play[1]["media_content_id"].endswith("haliday_show/haliday-show-speaker-test.wav")
    assert ha.calls[-1][0] == "media_stop"
    body = await (await client.get("/api/speakers")).json()
    assert [s["entity_id"] for s in body["speakers"]] == ["media_player.garden"]
    # The test chime isn't offered as a song.
    assert not any("speaker-test" in a["path"] for a in await (await client.get("/api/audio")).json())

    assert (await client.post("/api/speakers/remove", json={"entity_id": "media_player.garden"})).status == 200
    assert (await (await client.get("/api/speakers")).json())["speakers"] == []
    assert (await client.post("/api/speakers/test", json={"entity_id": "light.x"})).status == 400


async def test_custom_presets_round_trip_and_validation(client):
    assert await (await client.get("/api/presets")).json() == []
    mine = [{"name": "Candy cane crawl", "effect": "duo",
             "params": {"color": "#ff0000", "color2": "#ffffff", "layout": "alternate", "size": 2, "speed": 1.5}}]
    resp = await client.put("/api/presets", json=mine)
    assert resp.status == 200
    assert await (await client.get("/api/presets")).json() == mine
    for bad in ({"name": "x"}, [{"name": "", "effect": "duo", "params": {}}],
                [{"name": "x", "effect": "Bad Effect", "params": {}}], [{"name": "x", "effect": "duo", "params": []}],
                [{"name": "x", "effect": "duo", "params": {"speed": [1]}}],
                [{"name": "x", "effect": "duo", "params": {}}] * 201):
        assert (await client.put("/api/presets", json=bad)).status == 400


async def test_listening_records_govee_packets(client):
    client.app[server.LISTENING]["options"] = {"ports": (47003,), "allow_raw": False}
    await client.put("/api/devices", json=[{"ip": "127.0.0.1", "name": "Roof", "segments": 10}])
    assert (await client.post("/api/diagnostics/listen", json={"seconds": 1})).status == 200
    await asyncio.sleep(0.1)
    import base64, socket
    pt = base64.b64encode(bytes([0x33, 0x05, 0x15, 0x01])).decode()
    tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx.sendto(json.dumps({"msg": {"cmd": "ptReal", "data": {"command": [pt]}}}).encode(), ("127.0.0.1", 47003))
    tx.sendto(b"\x01\x02", ("127.0.0.1", 47003))
    tx.close()
    await asyncio.sleep(0.1)
    status = await (await client.get("/api/diagnostics/listen")).json()
    assert status["running"] and status["count"] == 2 and not status["raw"]
    assert {"from": "Roof", "to": "this machine:47003", "cmd": "ptReal", "count": 1} in status["summary"]
    full = await (await client.get("/api/diagnostics/listen?download=1")).json()
    assert full["packets"][0]["decoded"] == ["33 05 15 01"] and full["packets"][1]["hex"] == "01 02"
    await asyncio.sleep(1)
    assert not (await (await client.get("/api/diagnostics/listen")).json())["running"]
    for bad in ({"seconds": 0}, {"seconds": 999}, {"seconds": "x"}):
        assert (await client.post("/api/diagnostics/listen", json=bad)).status == 400


async def test_packet_lab_sends_only_to_your_lights(client):
    import socket
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 4003))
    rx.settimeout(1)
    try:
        await client.put("/api/devices", json=[{"ip": "127.0.0.1", "name": "Tree", "segments": 10}])
        ok = {"ip": "127.0.0.1", "kind": "razer", "text": "b1 01", "repeat": 2, "interval_ms": 20}
        assert (await client.post("/api/lab/send", json=ok)).status == 200
        await asyncio.sleep(0.2)  # the sends happen on the event loop
        got = [json.loads(rx.recv(4096))["msg"]["cmd"] for _ in range(2)]
        assert got == ["razer", "razer"]
        status = await (await client.get("/api/lab")).json()
        assert status["sent"] == 2 and [e["dir"] for e in status["log"]] == ["sent", "sent"]
        assert (await client.post("/api/lab/stop")).status == 200
    finally:
        rx.close()
    for bad in ({**ok, "ip": "192.0.2.99"}, {**ok, "kind": "dmx"}, {**ok, "text": "zz"}, {**ok, "repeat": 0},
                {**ok, "repeat": 99999}, {**ok, "interval_ms": 1}, {**ok, "length": -1}):
        assert (await client.post("/api/lab/send", json=bad)).status == 400
    # Only Govee lights: the lab speaks Govee's protocol.
    await client.put("/api/devices", json=[{"ip": "127.0.0.1", "kind": "wled", "name": "Eaves", "segments": 10}])
    assert (await client.post("/api/lab/send", json=ok)).status == 400


async def test_packet_lab_runs_a_sweep_step_by_step(client):
    import socket
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 4003))
    rx.setblocking(False)
    try:
        await client.put("/api/devices", json=[{"ip": "127.0.0.1", "name": "Tree", "segments": 10}])
        steps = [{"kind": "razer", "text": "b0 01 01 ff0000", "repeat": 1, "label": "red: first"},
                 {"kind": "razer", "text": "b2 01 01 00ff00", "repeat": 1, "label": "green: second"}]
        import halidayshow.lab as lab
        old, lab.STEP_GAP_S = lab.STEP_GAP_S, 0.05  # the sweep pauses between steps
        try:
            assert (await client.post("/api/lab/send", json={"ip": "127.0.0.1", "steps": steps})).status == 200
            await asyncio.sleep(0.3)
        finally:
            lab.STEP_GAP_S = old
        pts = []
        while True:
            try:
                pts.append(base64.b64decode(json.loads(rx.recv(4096))["msg"]["data"]["pt"]))
            except BlockingIOError:
                break
        assert [p[3] for p in pts] == [0xB0, 0xB1, 0xB2]  # first step, realtime off between, second step
        status = await (await client.get("/api/lab")).json()
        assert status["steps"] == 2 and status["step"] == 2 and status["label"] == "green: second"
        assert [e["text"] for e in status["log"] if e["dir"] == "step"] == ["1 of 2: red: first", "2 of 2: green: second"]
    finally:
        rx.close()
    bad = {"ip": "127.0.0.1", "steps": []}
    assert (await client.post("/api/lab/send", json=bad)).status == 400
    assert (await client.post("/api/lab/send", json={**bad, "steps": [{"kind": "razer", "text": "b1 01"}] * 21})).status == 400


async def test_packet_lab_sends_set_up_messages_first(client):
    import socket
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 4003))
    rx.setblocking(False)
    try:
        await client.put("/api/devices", json=[{"ip": "127.0.0.1", "name": "Tree", "segments": 10}])
        step = {"kind": "razer", "text": "b0 01 01 ff0000", "repeat": 1, "realtime_on": True,
                "before": [{"kind": "ptreal", "text": "33 14 01"}, {"kind": "razer", "text": "b1 01 2c"}]}
        assert (await client.post("/api/lab/send", json={"ip": "127.0.0.1", **step})).status == 200
        await asyncio.sleep(0.4)
        msgs = []
        while True:
            try:
                msgs.append(json.loads(rx.recv(4096))["msg"])
            except BlockingIOError:
                break
        assert msgs[0]["cmd"] == "ptReal"
        assert base64.b64decode(msgs[0]["data"]["command"][0])[:3] == bytes([0x33, 0x14, 0x01])
        pts = [base64.b64decode(m["data"]["pt"]) for m in msgs[1:]]
        assert [p[3:6] for p in pts[:1]] == [bytes([0xB1, 1, 0x2C])]
        assert [p[3] for p in pts[1:]] == [0xB1, 0xB0]  # then realtime on and the frame, as usual
    finally:
        rx.close()
    bad = {"ip": "127.0.0.1", "kind": "razer", "text": "b1 01"}
    assert (await client.post("/api/lab/send", json={**bad, "before": [{"kind": "x", "text": ""}]})).status == 400
    assert (await client.post("/api/lab/send", json={**bad, "before": [{"kind": "razer", "text": "zz"}]})).status == 400
    assert (await client.post("/api/lab/send", json={**bad, "before": "b1 01"})).status == 400


async def test_long_lights_only_with_protocols_that_allow_them(client):
    ok = await client.put("/api/devices", json=[{"ip": "192.168.1.70", "segments": 300, "protocol": "whole"}])
    assert ok.status == 200 and (await ok.json())[0]["segments"] == 300
    assert (await client.put("/api/devices", json=[{"ip": "192.168.1.70", "segments": 300}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "192.168.1.70", "segments": 1001, "protocol": "whole"}])).status == 400
    for gone in ("razer", "v2", "segments", "pixels"):
        assert (await client.put("/api/devices", json=[{"ip": "192.168.1.70", "protocol": gone}])).status == 400


async def test_packet_lab_sends_a_steps_after_messages_once_it_is_done(client):
    import socket
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 4003))
    rx.setblocking(False)
    try:
        await client.put("/api/devices", json=[{"ip": "127.0.0.1", "name": "Tree", "segments": 10}])
        settle = '{"msg":{"cmd":"colorwc","data":{"color":{"r":255,"g":255,"b":255},"colorTemInKelvin":0}}}'
        step = {"kind": "razer", "text": "b0 01 01 ff0000", "repeat": 2, "interval_ms": 20,
                "after": [{"kind": "razer", "text": "b1 00"}, {"kind": "json", "text": settle}]}
        assert (await client.post("/api/lab/send", json={"ip": "127.0.0.1", "steps": [step]})).status == 200
        await asyncio.sleep(0.4)
        msgs = []
        while True:
            try:
                msgs.append(json.loads(rx.recv(4096))["msg"])
            except BlockingIOError:
                break
        kinds = [base64.b64decode(m["data"]["pt"])[3] if m["cmd"] == "razer" else m["cmd"] for m in msgs]
        assert kinds == [0xB0, 0xB0, 0xB1, "colorwc"]  # the frames, then realtime off and a plain colour
    finally:
        rx.close()
    bad = {"kind": "razer", "text": "b1 01", "after": [{"kind": "nope", "text": ""}]}
    assert (await client.post("/api/lab/send", json={"ip": "127.0.0.1", "steps": [bad]})).status == 400


async def test_wled_devices_send_over_ddp(client):
    strip = {"id": "wled-1", "kind": "wled", "ip": "192.168.1.70", "name": "Eaves", "segments": 900,
             "protocol": "standard", "gradient": True, "sku": "H706A"}
    resp = await client.put("/api/devices", json=[strip, {"ip": "192.168.1.71", "segments": 20}])
    assert resp.status == 200
    wled, govee = await resp.json()
    # WLED strips always go over DDP, can be long, and have no Govee model or blending.
    assert (wled["kind"], wled["protocol"], wled["segments"], wled["sku"], wled["gradient"]) == \
        ("wled", "ddp", 900, "", False)
    assert (govee["kind"], govee["protocol"]) == ("govee", "standard")  # no kind saved: a Govee light
    # "ddp" is only for WLED lights.
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "protocol": "ddp"}])).status == 400
    assert (await client.put("/api/devices", json=[{**strip, "segments": 1001}])).status == 400


async def test_wled_info_reads_name_leds_and_segments(client, aiohttp_server, monkeypatch):
    from aiohttp import web

    from halidayshow import wled

    async def handler(request):
        return web.json_response({
            "info": {"name": "Eaves", "ver": "0.15.0", "leds": {"count": 300}},
            "state": {"seg": [{"id": 0, "start": 0, "stop": 100, "n": "Left"},
                              {"id": 1, "start": 100, "stop": 200},
                              {"id": 2, "start": 210, "stop": 300, "n": "Right"}]}})

    app = web.Application()
    app.router.add_get("/json", handler)
    fake = await aiohttp_server(app, host="127.0.0.1")
    monkeypatch.setattr(wled, "HTTP_PORT", fake.port)
    resp = await client.post("/api/wled/info", json={"ip": "127.0.0.1"})
    assert resp.status == 200
    info = await resp.json()
    assert (info["name"], info["leds"], info["max"]) == ("Eaves", 300, 1000)
    assert info["parts"] == [{"id": "w0", "name": "Left", "from": 1, "to": 100},
                             {"id": "w1", "name": "Segment 2", "from": 101, "to": 200},
                             {"id": "w2", "name": "Right", "from": 211, "to": 300}]
    # The parts are accepted as they are.
    dev = {"kind": "wled", "ip": "192.168.1.70", "segments": 300, "parts": info["parts"]}
    assert (await client.put("/api/devices", json=[dev])).status == 200
    assert (await client.post("/api/wled/info", json={"ip": "nope"})).status == 400
    await fake.close()
    assert (await client.post("/api/wled/info", json={"ip": "127.0.0.1"})).status == 502


async def test_pixel_controller_lights(client):
    strings = [{"id": "ddp-a", "kind": "ddp", "ip": "192.168.1.80", "segments": 100},
               {"id": "ddp-b", "kind": "ddp", "ip": "192.168.1.80", "segments": 600, "first": 101, "gradient": True}]
    resp = await client.put("/api/devices", json=strings)
    assert resp.status == 200
    a, b = await resp.json()
    assert (a["kind"], a["protocol"], a["first"]) == ("ddp", "ddp", 1)
    assert (b["first"], b["segments"], b["gradient"]) == (101, 600, False)
    assert "first" not in (await (await client.put("/api/devices", json=[{"ip": "1.2.3.4"}])).json())[0]
    for bad in (0, 100001, "x"):
        assert (await client.put("/api/devices", json=[{**strings[0], "first": bad}])).status == 400


async def test_e131_lights(client):
    light = {"id": "e131-a", "kind": "e131", "ip": "192.168.1.90", "segments": 170, "universe": 3, "channel": 1}
    resp = await client.put("/api/devices", json=[light, {**light, "id": "e131-b", "universe": None, "channel": None}])
    assert resp.status == 200
    a, b = await resp.json()
    assert (a["kind"], a["protocol"], a["universe"], a["channel"]) == ("e131", "e131", 3, 1)
    assert (b["universe"], b["channel"]) == (1, 1)
    assert "universe" not in (await (await client.put("/api/devices", json=[{"ip": "1.2.3.4"}])).json())[0]
    for bad in ({"universe": 0}, {"universe": 64000}, {"channel": 0}, {"channel": 511}, {"channel": "x"},
                {"universe": 63999, "segments": 1000}):
        assert (await client.put("/api/devices", json=[{**light, **bad}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "protocol": "e131"}])).status == 400


async def test_home_assistant_lights(client):
    resp = await client.put("/api/devices", json=[
        {"kind": "ha", "entity": "light.porch", "name": "Porch", "ip": "10.0.0.1", "segments": 30},
        {"kind": "ha", "entity": "switch.inflatable", "name": "Snowman"},
        {"id": "planned-plug", "kind": "ha", "name": "Plug to buy"}])
    assert resp.status == 200
    porch, snowman, plug = await resp.json()
    assert (porch["id"], porch["ip"], porch["segments"], porch["protocol"]) == ("ha-light.porch", "", 1, "ha_light")
    assert (snowman["protocol"], snowman["entity"]) == ("ha_switch", "switch.inflatable")
    assert plug["entity"] == "" and plug["protocol"] == "ha_light"
    for bad in ("sensor.temp", "light.Porch", "light.", "light.a b"):
        assert (await client.put("/api/devices", json=[{"kind": "ha", "entity": bad}])).status == 400
    # Outside Home Assistant there's nothing to list.
    assert (await client.get("/api/ha/entities")).status == 503


async def test_home_assistant_entities_are_listed(client, monkeypatch):
    class HA:
        async def states(self, domain=None):
            return [{"entity_id": "light.porch", "attributes": {"friendly_name": "Porch", "supported_color_modes": ["xy"]}},
                    {"entity_id": "light.hall", "attributes": {"friendly_name": "Hall", "supported_color_modes": ["brightness"]}},
                    {"entity_id": "switch.snowman", "attributes": {"friendly_name": "snowman"}},
                    {"entity_id": "sensor.temp", "attributes": {}}]
    real = client.app[server.HA]
    monkeypatch.setattr(type(real), "available", True)
    monkeypatch.setattr(real, "states", HA().states)
    found = await (await client.get("/api/ha/entities")).json()
    assert found == [{"entity": "light.hall", "name": "Hall", "colour": False},
                     {"entity": "light.porch", "name": "Porch", "colour": True},
                     {"entity": "switch.snowman", "name": "snowman", "colour": False}]


async def test_wled_scan_endpoint(client, monkeypatch):
    from halidayshow import wled

    async def scan():
        return [{"ip": "192.168.1.70", "name": "Eaves", "leds": 1200, "version": "", "parts": []}]
    monkeypatch.setattr(wled, "scan", scan)
    body = await (await client.post("/api/wled/scan")).json()
    assert body == {"found": [{"ip": "192.168.1.70", "name": "Eaves", "leds": 1200, "version": "", "parts": []}],
                    "max": 1000}


async def test_export_start_afresh_and_import_back(client):
    await client.put("/api/devices", json=[{"id": "roof", "name": "Roof", "ip": "", "segments": 10}])
    created = await (await client.post("/api/shows", json={"name": "Carol"})).json()
    await client.put(f"/api/shows/{created['id']}", json={"name": "Carol", "tracks": []})
    resp = await client.get("/api/backup")
    assert resp.status == 200 and resp.content_type == "application/zip"
    assert "attachment" in resp.headers["Content-Disposition"]
    exported = await resp.read()

    reset = await (await client.post("/api/backup/reset")).json()
    assert reset["kept"].startswith("before-fresh-start-")
    assert await (await client.get("/api/devices")).json() == []
    assert await (await client.get("/api/shows")).json() == []

    resp = await client.post("/api/backup", data=exported, headers={"Content-Type": "application/zip"})
    assert resp.status == 200
    assert (await resp.json())["restored"] >= 2
    assert [d["name"] for d in await (await client.get("/api/devices")).json()] == ["Roof"]
    assert [s["id"] for s in await (await client.get("/api/shows")).json()] == [created["id"]]


async def test_a_bad_import_is_refused_and_changes_nothing(client):
    await client.put("/api/devices", json=[{"id": "roof", "name": "Roof", "ip": "", "segments": 10}])
    resp = await client.post("/api/backup", data=b"not a zip")
    assert resp.status == 400
    assert "isn't a .zip" in await resp.text()
    assert len(await (await client.get("/api/devices")).json()) == 1
    assert await (await client.get("/api/backup/copies")).json() == []


async def test_the_copy_kept_before_a_fresh_start_brings_it_all_back(client):
    await client.put("/api/devices", json=[{"id": "roof", "name": "Roof", "ip": "", "segments": 10}])
    kept = (await (await client.post("/api/backup/reset")).json())["kept"]
    copies = await (await client.get("/api/backup/copies")).json()
    assert [c["name"] for c in copies] == [kept] and copies[0]["reason"] == "fresh-start"
    assert (await client.get(f"/api/backup/copies/{kept}")).status == 200
    assert (await client.post("/api/backup/copies/nope.zip/restore")).status == 404
    assert (await client.post(f"/api/backup/copies/{kept}/restore")).status == 200
    assert [d["name"] for d in await (await client.get("/api/devices")).json()] == ["Roof"]


async def test_playlists_round_trip_validation_and_play(client):
    assert await (await client.get("/api/playlists")).json() == []
    good = [{"id": "night", "name": " Halloween night ", "shows": ["spooky", "gone"], "gap": 1000}]
    saved = await (await client.put("/api/playlists", json=good)).json()
    assert saved == [{"id": "night", "name": "Halloween night", "shows": ["spooky", "gone"], "gap": 600, "items": [
        {"type": "show", "id": "spooky"}, {"type": "pause", "id": "pause-1", "seconds": 600},
        {"type": "show", "id": "gone"}, {"type": "pause", "id": "pause-2", "seconds": 600}]}]
    assert await (await client.get("/api/playlists")).json() == saved
    for bad in ([{"id": "Bad Id", "name": "x", "shows": []}],
                [{"id": "a", "name": "", "shows": []}],
                [{"id": "a", "name": "x", "shows": ["../devices"]}],
                [{"id": "a", "name": "x", "shows": [], "gap": "soon"}],
                [{"id": "a", "name": "x", "shows": []}, {"id": "a", "name": "y", "shows": []}],
                {"id": "a"}):
        assert (await client.put("/api/playlists", json=bad)).status == 400, bad
    assert (await client.post("/api/playlists/nope/play")).status == 404
    assert (await client.post("/api/playlists/night/play")).status == 409  # no saved shows yet
    show_id = (await (await client.post("/api/shows", json={"name": "Spooky"})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": "Spooky", "fps": 40, "duration": 10, "tracks": []})
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 400)
    await client.put(f"/api/shows/{show_id}/baked", data=blob)
    st = await (await client.post("/api/playlists/night/play")).json()
    assert st["playlist"] == {"id": "night", "name": "Halloween night", "finishing": False}
    st = await (await client.post("/api/player/stop")).json()
    assert st["playlist"] is None and not st["playing"]


async def test_playlist_schedules_save_and_show_when_they_next_start(client):
    evenings = {"on": True, "start": "17:00", "end": "22:00", "days": [0, 1, 2, 3, 4, 5, 6], "from": "", "to": ""}
    pl = {"id": "night", "name": "Night", "shows": [], "gap": 5, "schedule": evenings}
    assert (await (await client.put("/api/playlists", json=[pl])).json())[0]["schedule"] == evenings
    bad = {**pl, "schedule": {**evenings, "start": "17:00", "end": "17:00"}}
    assert (await client.put("/api/playlists", json=[bad])).status == 400
    st = await (await client.get("/api/schedule")).json()
    assert st["now"] and st["next"]["night"].endswith("T17:00") and st["scheduled"] is None


async def test_location_for_sunset(client):
    st = await (await client.put("/api/location", json={"lat": "51.50735", "lon": -0.1278})).json()
    assert st["location"] == {"lat": 51.5074, "lon": -0.1278, "source": "you"} and st["sunset"]
    for bad in ({"lat": 91, "lon": 0}, {"lat": "north", "lon": 0}, {"lat": 10}, [1, 2]):
        assert (await client.put("/api/location", json=bad)).status == 400, bad
    st = await (await client.put("/api/location", json={})).json()
    assert st["location"] is None


async def test_show_player_page_and_syncs_for_another_show(client):
    resp = await client.get("/player")
    assert resp.status == 200 and "Show player" in await resp.text()
    show_id = (await (await client.post("/api/shows", json={"name": "Thriller"})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": "Thriller", "fps": 40, "duration": 10, "tracks": []})
    await client.put(f"/api/shows/{show_id}/baked", data=baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 400))
    await client.post("/api/player/play", json={"show": show_id})
    st = await (await client.post("/api/player/sync", json={"show": "old-song", "position": 9})).json()
    assert st["position"] < 2  # a sync meant for another show is ignored
    st = await (await client.post("/api/player/sync", json={"show": show_id, "position": 9})).json()
    assert st["position"] > 8
    st = await (await client.post("/api/player/sync", json={"position": 5})).json()  # the editor sends no show
    assert 4 < st["position"] < 6
    await client.post("/api/player/stop")


async def test_archive_restore_and_delete_through_the_server(client, tmp_path):
    media = tmp_path / "media" / "haliday_show"
    media.mkdir(parents=True, exist_ok=True)
    (media / "bells.mp3").write_bytes(b"ID3 bells")
    (media / "other.mp3").write_bytes(b"ID3 other")
    show_id = (await (await client.post("/api/shows", json={"name": "Xmas"})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": "Xmas", "tracks": [],
                                                    "audio": {"source": "media", "path": "haliday_show/bells.mp3"}})
    users = await (await client.get("/api/songs/users", params={"path": "haliday_show/bells.mp3"})).json()
    assert users == {"shows": [{"id": show_id, "name": "Xmas"}], "own": True}

    # Shows
    assert (await client.post(f"/api/shows/{show_id}/archive")).status == 200
    assert await (await client.get("/api/shows")).json() == []
    assert [s["id"] for s in await (await client.get("/api/shows/archived")).json()] == [show_id]
    assert (await client.post(f"/api/shows/{show_id}/restore")).status == 200
    assert (await client.post("/api/shows/nope/archive")).status == 404

    # Songs: archive giving the show another song, restore, then delete for good.
    r = await client.post("/api/songs/archive", json={"path": "haliday_show/bells.mp3",
                                                       "replacement": {"source": "media", "path": "haliday_show/other.mp3"}})
    assert r.status == 200 and (await r.json())["archived"] == "haliday_show/Archived/bells.mp3"
    assert (await (await client.get(f"/api/shows/{show_id}")).json())["audio"]["path"] == "haliday_show/other.mp3"
    assert [s["path"] for s in await (await client.get("/api/songs/archived")).json()] == ["haliday_show/Archived/bells.mp3"]
    assert (await client.post("/api/songs/restore", json={"path": "haliday_show/Archived/bells.mp3"})).status == 200
    assert (await client.post("/api/songs/archive", json={"path": "../etc/passwd"})).status == 400
    assert (await client.post("/api/songs/archive", json={})).status == 400

    r = await client.post("/api/songs/delete", json={"path": "haliday_show/other.mp3"})
    assert r.status == 200 and (await r.json())["shows"] == [{"id": show_id, "audio": None}]
    assert not (media / "other.mp3").exists()
    copies = await (await client.get("/api/backup/copies")).json()
    assert copies and copies[0]["reason"] == "delete", "a copy is kept before deleting for good"

    assert (await client.delete(f"/api/shows/{show_id}")).status == 200
    assert (await client.delete(f"/api/shows/{show_id}")).status == 404


async def test_an_archived_show_cant_be_saved_back_to_life(client):
    show_id = (await (await client.post("/api/shows", json={"name": "Xmas"})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": "Xmas", "tracks": []})
    await client.post(f"/api/shows/{show_id}/archive")
    # Another browser that still has it open saves it.
    assert (await client.put(f"/api/shows/{show_id}", json={"name": "Xmas", "tracks": []})).status == 409
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 40)
    assert (await client.put(f"/api/shows/{show_id}/baked", data=blob)).status == 409
    assert await (await client.get("/api/shows")).json() == []
    assert (await client.post(f"/api/shows/{show_id}/restore")).status == 200


async def test_song_info_keeps_section_marks(client, tmp_path):
    (tmp_path / "media" / "song.mp3").write_bytes(b"id3")
    sections = [{"start": 0, "end": 5, "label": "Intro", "energy": 0.1, "notes": "Quiet.", "autoNotes": True},
                {"start": 5, "end": 9, "label": "Big bit", "energy": 1, "named": True, "notes": "mine"},
                {"start": 9, "end": 10, "label": "Outro", "energy": 0, "autoNotes": True, "named": "yes"}]
    url = "/api/audio/info?source=media&path=song.mp3"
    assert (await client.put(url, json={"tempo": 120, "beats": [], "bars": [], "sections": sections})).status == 200
    got = (await (await client.get(url)).json())["sections"]
    assert got[0]["autoNotes"] is True and "named" not in got[0]
    assert got[1]["named"] is True and "autoNotes" not in got[1]
    assert "autoNotes" not in got[2] and "named" not in got[2]  # no notes to mark; "yes" isn't true


async def test_song_marks_are_kept_when_detect_saves_without_them(client, tmp_path):
    (tmp_path / "media" / "song.mp3").write_bytes(b"id3")
    url = "/api/audio/info?source=media&path=song.mp3"
    marks = [{"t": 12.5, "label": " Big hit ", "color": "#FF0000"}, {"t": 3, "label": ""}]
    info = {"tempo": 120, "beats": [0.5], "bars": [0.5], "sections": []}
    assert (await client.put(url, json={**info, "marks": marks})).status == 200
    got = await (await client.get(url)).json()
    assert got["marks"] == [{"t": 3.0, "label": ""}, {"t": 12.5, "label": "Big hit", "color": "#ff0000"}]
    # Detecting again sends only beats and sections; the marks stay.
    assert (await client.put(url, json={**info, "beats": [0.25]})).status == 200
    got = await (await client.get(url)).json()
    assert got["beats"] == [0.25] and len(got["marks"]) == 2
    # Sending marks replaces them, and an empty list clears them.
    assert (await client.put(url, json={**info, "marks": []})).status == 200
    assert (await (await client.get(url)).json())["marks"] == []
    for bad in ([{"t": -1}], [{"t": 1, "color": "red"}], [{"t": 1, "label": 5}], "x", [{"t": 1}] * 201):
        assert (await client.put(url, json={**info, "marks": bad})).status == 400


async def test_song_drafts_are_kept_listed_and_deleted(client, tmp_path):
    song = {"source": "media", "path": "haliday_show/song.mp3"}
    draft = {"name": "  Short   version ", "base": song, "crossfade": 0.05, "fadeIn": 0, "fadeOut": 2,
             "pieces": [{"song": song, "start": 0, "end": 10}, {"song": song, "start": 20, "end": 60.123456}],
             "length": 49.95}
    resp = await client.post("/api/drafts", json=draft)
    assert resp.status == 200
    draft_id = (await resp.json())["id"]
    assert draft_id == "short-version"
    # A second draft with the same name gets its own id.
    assert (await (await client.post("/api/drafts", json=draft)).json())["id"] == "short-version-2"
    got = await (await client.get(f"/api/drafts/{draft_id}")).json()
    assert got["name"] == "Short version" and got["made"] is None and got["pieces"][1]["end"] == 60.1235
    made = {"source": "media", "path": "haliday_show/Short version.wav"}
    assert (await client.put(f"/api/drafts/{draft_id}", json={**draft, "made": made})).status == 200
    listed = {d["id"]: d for d in await (await client.get("/api/drafts")).json()}
    assert listed[draft_id]["made"] == made and listed[draft_id]["base"] == song
    assert listed[draft_id]["length"] == 49.95
    assert (await client.delete(f"/api/drafts/{draft_id}")).status == 200
    assert (await client.get(f"/api/drafts/{draft_id}")).status == 404
    # An autosave after the draft was deleted (in another tab) doesn't bring it back.
    assert (await client.put(f"/api/drafts/{draft_id}", json=draft)).status == 404
    assert (await client.delete(f"/api/drafts/{draft_id}")).status == 404
    assert (await client.get("/api/drafts/..%2Fx")).status in (400, 404)
    for bad in ({**draft, "pieces": []}, {**draft, "name": " "}, {**draft, "base": "song.mp3"},
                {**draft, "pieces": [{"song": song, "start": 5, "end": 5}]}, {**draft, "crossfade": 11},
                {**draft, "made": "x"}, {**draft, "pieces": [{"song": song, "start": -1, "end": 5}]}):
        assert (await client.post("/api/drafts", json=bad)).status == 400


async def test_drafts_say_which_songs_they_use_and_rename_alone(client, tmp_path):
    a, b = {"source": "media", "path": "haliday_show/a.mp3"}, {"source": "media", "path": "haliday_show/b.wav"}
    draft = {"name": "Mix", "base": a, "pieces": [{"song": a, "start": 0, "end": 5}, {"song": b, "start": 0, "end": 3},
                                                  {"song": a, "start": 9, "end": 12}]}
    draft_id = (await (await client.post("/api/drafts", json=draft)).json())["id"]
    listed = (await (await client.get("/api/drafts")).json())[0]
    assert listed["uses"] == ["haliday_show/a.mp3", "haliday_show/b.wav"]
    assert (await client.post(f"/api/drafts/{draft_id}/rename", json={"name": "  Party   mix "})).status == 200
    got = await (await client.get(f"/api/drafts/{draft_id}")).json()
    assert got["name"] == "Party mix" and len(got["pieces"]) == 3
    assert (await client.post(f"/api/drafts/{draft_id}/rename", json={"name": " "})).status == 400
    assert (await client.post("/api/drafts/nope/rename", json={"name": "x"})).status == 404


async def test_samples_have_their_own_folder_and_list(client, tmp_path):
    import aiohttp
    form = aiohttp.FormData()
    form.add_field("file", b"RIFF", filename="Hohoho.wav")
    resp = await client.post("/api/audio?kind=sample", data=form)
    assert resp.status == 200
    ref = await resp.json()
    assert ref == {"source": "media", "path": "haliday_show/Samples/Hohoho.wav"}
    # In pieces too, as a big sound would go.
    url = "/api/audio/part?upload=00112233445566778899&offset=0&done=1&name=Bells.mp3&kind=sample"
    assert (await client.post(url, data=b"id3")).status == 200
    form = aiohttp.FormData()
    form.add_field("file", b"id3", filename="Song.mp3")
    assert (await client.post("/api/audio", data=form)).status == 200
    samples = [s["path"] for s in await (await client.get("/api/samples")).json()]
    assert samples == ["haliday_show/Samples/Bells.mp3", "haliday_show/Samples/Hohoho.wav"]
    songs = [s["path"] for s in await (await client.get("/api/audio")).json()]
    assert "haliday_show/Song.mp3" in songs and not any("Samples/" in p for p in songs), "samples aren't songs"
    # Only a sound can be deleted this way.
    assert (await client.delete("/api/samples?path=haliday_show/Song.mp3")).status == 404
    assert (await client.delete("/api/samples?path=haliday_show/Samples/../Song.mp3")).status == 404
    assert (await client.delete("/api/samples?path=haliday_show/Samples/Bells.mp3")).status == 200
    assert not (tmp_path / "media" / "haliday_show" / "Samples" / "Bells.mp3").exists()
    assert (tmp_path / "media" / "haliday_show" / "Song.mp3").exists()


async def test_draft_layers_are_kept_and_checked(client, tmp_path):
    song = {"source": "media", "path": "haliday_show/song.mp3"}
    bells = {"source": "media", "path": "haliday_show/Samples/Bells.wav"}
    clip = {"song": bells, "start": 0, "end": 2.5, "anchor": {"song": song, "t": 12}, "gain": -3, "fadeIn": 0.2, "fadeOut": 0}
    draft = {"name": "Mix", "base": song, "pieces": [{"song": song, "start": 0, "end": 60}],
             "layers": [{"name": "  Bells ", "gain": -6, "clips": [clip]}]}
    draft_id = (await (await client.post("/api/drafts", json=draft)).json())["id"]
    got = await (await client.get(f"/api/drafts/{draft_id}")).json()
    assert got["layers"] == [{"name": "Bells", "gain": -6.0, "clips": [{**clip, "gain": -3.0, "fadeOut": 0.0}]}]
    listed = next(d for d in await (await client.get("/api/drafts")).json() if d["id"] == draft_id)
    assert "haliday_show/Samples/Bells.wav" in listed["uses"], "a layer's clips count as using their song"
    # No layers, nothing saved for them (old drafts look the same).
    plain = (await (await client.post("/api/drafts", json={**draft, "layers": []})).json())["id"]
    assert "layers" not in await (await client.get(f"/api/drafts/{plain}")).json()
    # Quieten the song under a layer: kept when on, left out when off.
    ducked = (await (await client.post("/api/drafts", json={**draft, "layers": [
        {"name": "Voice", "duck": True, "clips": []}, {"name": "Bells", "duck": False, "clips": []}]})).json())["id"]
    assert [l.get("duck") for l in (await (await client.get(f"/api/drafts/{ducked}")).json())["layers"]] == [True, None]
    for bad in ([{"name": "x", "duck": "yes", "clips": []}], [{"name": "x", "clips": [{**clip, "end": 0}]}], [{"name": "x", "gain": 99, "clips": []}],
                [{"name": "x", "clips": [{**clip, "anchor": "12"}]}], [{"name": "x", "clips": []}] * 5, "x"):
        assert (await client.post("/api/drafts", json={**draft, "layers": bad})).status == 400


async def test_draft_mixer_settings_are_kept_and_checked(client, tmp_path):
    song = {"source": "media", "path": "haliday_show/song.mp3"}
    loop = {"source": "media", "path": "haliday_show/Samples/Loop.wav"}
    change = {"anchor": {"song": song, "t": 30}, "bass": -24, "mid": 0, "treble": 3, "glide": 2}
    eq = {"bass": -6, "mid": 0, "treble": 0, "changes": [change]}
    clip = {"song": loop, "start": 0, "end": 4, "anchor": {"song": song, "t": 8}, "gain": 0, "fadeIn": 0, "fadeOut": 0, "bpm": 96.04}
    draft = {"name": "Mash", "base": song, "pieces": [{"song": song, "start": 0, "end": 60}], "eq": eq,
             "layers": [{"name": "Loop", "gain": 0, "matchTempo": True, "eq": {"bass": 0, "mid": 2, "treble": 0}, "clips": [clip]}]}
    draft_id = (await (await client.post("/api/drafts", json=draft)).json())["id"]
    got = await (await client.get(f"/api/drafts/{draft_id}")).json()
    assert got["eq"] == {"bass": -6.0, "mid": 0.0, "treble": 0.0, "changes": [{**change, "bass": -24.0, "mid": 0.0, "treble": 3.0, "glide": 2.0}]}
    layer = got["layers"][0]
    assert layer["matchTempo"] is True and layer["eq"] == {"bass": 0.0, "mid": 2.0, "treble": 0.0, "changes": []}
    assert layer["clips"][0]["bpm"] == 96.0
    # Left out, nothing is saved for them (old drafts look the same).
    plain_layer = {"name": "x", "clips": [{k: v for k, v in clip.items() if k != "bpm"}]}
    plain = (await (await client.post("/api/drafts", json={**draft, "eq": None, "layers": [plain_layer]})).json())["id"]
    got = await (await client.get(f"/api/drafts/{plain}")).json()
    assert "eq" not in got and set(got["layers"][0]) == {"name", "gain", "clips"} and "bpm" not in got["layers"][0]["clips"][0]
    for bad in ({**draft, "eq": {"bass": 7}}, {**draft, "eq": {"mid": "loud"}}, {**draft, "eq": "flat"},
                {**draft, "eq": {"changes": [{**change, "glide": 99}]}}, {**draft, "eq": {"changes": [{"bass": 0}]}},
                {**draft, "layers": [{**draft["layers"][0], "matchTempo": 1}]},
                {**draft, "layers": [{**draft["layers"][0], "clips": [{**clip, "bpm": 5}]}]},
                {**draft, "layers": [{**draft["layers"][0], "eq": {"treble": -30}}]}):
        assert (await client.post("/api/drafts", json=bad)).status == 400


async def test_songs_upload_in_parts(client, tmp_path):
    song = bytes(range(256)) * 4096 * 3  # 3 MB
    url = "/api/audio/part?upload=0123456789abcdef"
    assert (await client.post(f"{url}&offset=0", data=song[:1_000_000])).status == 200
    # A repeated or missing part is refused rather than spliced in the wrong place.
    assert (await client.post(f"{url}&offset=5", data=b"x")).status == 409
    assert (await client.post(f"{url}&offset=1000000", data=song[1_000_000:2_000_000])).status == 200
    listed = await (await client.get("/api/audio")).json()
    assert not any(".part" in a["path"] for a in listed)  # not a song until it's whole
    resp = await client.post(f"{url}&offset=2000000&done=1&name=Big%20Song.wav", data=song[2_000_000:])
    ref = await resp.json()
    assert resp.status == 200 and ref == {"source": "media", "path": "haliday_show/Big Song.wav"}
    assert (tmp_path / "media" / "haliday_show" / "Big Song.wav").read_bytes() == song
    assert not list((tmp_path / "media" / "haliday_show").glob(".upload-*"))
    assert (await client.post("/api/audio/part?upload=../x&offset=0", data=b"x")).status == 400
    assert (await client.post(f"{url}&offset=zero", data=b"x")).status == 400
    await client.post(f"{url}&offset=0", data=b"x")
    assert (await client.post(f"{url}&offset=1&done=1&name=notes.txt", data=b"y")).status == 400
    assert (await client.post(f"{url}&offset=0", data=b"z" * (server.MAX_PART + 1))).status == 413


async def test_baked_show_in_parts(client):
    show_id = (await (await client.post("/api/shows", json={"name": "Long"})).json())["id"]
    await client.put(f"/api/shows/{show_id}", json={"name": "Long", "fps": 40, "duration": 10, "tracks": []})
    blob = baked.encode(40, [{"device": "a", "segments": 100}], [bytes(300)] * 400)
    url = f"/api/shows/{show_id}/baked/part?upload=00112233445566778899aabb"
    half = len(blob) // 2
    assert (await client.post(f"{url}&offset=0", data=blob[:half])).status == 200
    resp = await client.post(f"{url}&offset={half}&done=1", data=blob[half:])
    assert resp.status == 200 and (await resp.json())["bytes"] == len(blob)
    assert (await (await client.get("/api/shows")).json())[0]["baked"] is True
    await client.post(f"{url}&offset=0", data=b"junk")
    assert (await client.post(f"{url}&offset=4&done=1", data=b"more")).status == 400  # not a baked show


async def test_upload_parts_one_at_a_time_and_capped(client, tmp_path, monkeypatch):
    app = client.server.app
    url = "/api/audio/part?upload=aaaaaaaaaaaaaaaa"
    app[server.UPLOADING].add("aaaaaaaaaaaaaaaa")  # a part of it is still arriving
    assert (await client.post(f"{url}&offset=0", data=b"x")).status == 409
    app[server.UPLOADING].clear()
    assert (await client.post("/api/audio/part?upload=aaaa%0Aaaaaaaaaaaaa&offset=0", data=b"x")).status == 400
    monkeypatch.setattr(server, "MAX_OPEN_UPLOADS", 2)
    for i in range(2):
        assert (await client.post(f"/api/audio/part?upload={i:016x}&offset=0", data=b"x")).status == 200
    assert (await client.post(f"/api/audio/part?upload={9:016x}&offset=0", data=b"x")).status == 503
    # Finishing one makes room, and replaces a song of the same name.
    (tmp_path / "media" / "haliday_show" / "Same.mp3").write_bytes(b"old")
    assert (await client.post(f"/api/audio/part?upload={0:016x}&offset=1&done=1&name=Same.mp3", data=b"y")).status == 200
    assert (tmp_path / "media" / "haliday_show" / "Same.mp3").read_bytes() == b"xy"
    assert (await client.post(f"/api/audio/part?upload={9:016x}&offset=0", data=b"x")).status == 200


async def test_public_page_settings_are_checked(client):
    assert (await client.put("/api/public", data="nope")).status == 400
    assert (await client.put("/api/public", json=[1, 2])).status == 400
    resp = await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                       {"kind": "show", "id": "Not An Id"}],
                                                 "per_phone": 0, "queue": 500})
    view = await resp.json()
    assert view["on"] is True and view["per_phone"] == 1 and view["queue"] == 20
    assert view["items"] == [{"kind": "show", "id": "party", "from": "", "to": ""}]


async def test_playlist_blocks_are_baked_kept_and_tidied_away(client):
    items = [{"type": "show", "id": "spooky"}, {"type": "colour", "id": "glow-1", "seconds": 10, "colour": "#ff0000"}]
    await client.put("/api/playlists", json=[{"id": "night", "name": "Night", "items": items}])
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 40)
    assert (await client.put("/api/blocks/other/baked", data=blob)).status == 404  # not in a playlist
    assert (await client.put("/api/blocks/glow-1/baked", data=b"junk")).status == 400
    assert (await client.put("/api/blocks/glow-1/baked", data=blob)).status == 200
    assert await (await client.get("/api/blocks")).json() == {"baked": ["glow-1"]}
    # The same block can't be in two playlists: each has its own frames.
    twice = [{"id": "a", "name": "A", "items": items}, {"id": "b", "name": "B", "items": items}]
    assert (await client.put("/api/playlists", json=twice)).status == 400
    # Taken out of the playlist, its frames go too.
    await client.put("/api/playlists", json=[{"id": "night", "name": "Night", "items": items[:1]}])
    assert await (await client.get("/api/blocks")).json() == {"baked": []}


async def test_public_page_settings_keep_what_isnt_sent(client):
    hours = {"on": True, "start": "17:00", "end": "22:00", "days": [4, 5]}
    view = await (await client.put("/api/public", json={"on": True, "hours": hours})).json()
    assert view["hours"]["on"] and view["hours"]["days"] == [4, 5] and "hours_now" in view
    # An editor from before opening hours doesn't send them: they stay.
    view = await (await client.put("/api/public", json={"on": True, "queue": 3})).json()
    assert view["hours"]["on"] and view["queue"] == 3
    resp = await client.put("/api/public", json={"on": True, "hours": {**hours, "end": "17:00"}})
    assert resp.status == 400
    assert (await (await client.get("/api/public")).json())["hours"]["end"] == "22:00"


async def test_song_folders_round_trip_and_validation(client):
    assert await (await client.get("/api/song-folders")).json() == []
    song = {"source": "media", "path": "haliday_show/carol.mp3"}
    mine = [{"id": "xmas", "name": "  Christmas  songs ", "songs": [song, song]},
            {"id": "party", "name": "Party", "songs": [song, {"source": "media", "path": "haliday_show/dance.mp3"}]}]
    resp = await client.put("/api/song-folders", json=mine)
    assert resp.status == 200
    saved = await (await client.get("/api/song-folders")).json()
    # Names are tidied, and a song is in one folder at most (the first).
    assert saved == [{"id": "xmas", "name": "Christmas songs", "songs": [song]},
                     {"id": "party", "name": "Party", "songs": [{"source": "media", "path": "haliday_show/dance.mp3"}]}]
    for bad in ({"id": "x"}, [{"id": "Bad Id", "name": "A", "songs": []}],
                [{"id": "a", "name": "A", "songs": []}, {"id": "b", "name": "a", "songs": []}],
                [{"id": "a", "name": "A", "songs": []}, {"id": "a", "name": "B", "songs": []}],
                [{"id": "a", "name": "", "songs": []}], [{"id": "a", "name": "A", "songs": [{"path": "x"}]}],
                [{"id": f"f{k}", "name": f"F{k}", "songs": []} for k in range(101)]):
        assert (await client.put("/api/song-folders", json=bad)).status == 400


async def test_scenes_are_made_saved_baked_played_and_deleted(client):
    resp = await client.post("/api/house-scenes", json={"name": "Candy cane"})
    scene_id = (await resp.json())["id"]
    assert scene_id == "candy-cane"
    assert (await client.post("/api/house-scenes", json={"name": "candy CANE"})).status == 409  # names are unique
    assert (await client.post("/api/house-scenes", json={"name": " "})).status == 400
    body = {"name": "Candy cane", "mode": "basic", "lights": {"a": {"effect": "chase", "params": {"color": "#ff0000"}}}}
    assert (await client.put(f"/api/house-scenes/{scene_id}", json=body)).status == 200
    assert (await client.put(f"/api/house-scenes/{scene_id}", json={**body, "mode": "odd"})).status == 400
    assert (await client.put("/api/house-scenes/gone", json=body)).status == 404
    assert (await (await client.get(f"/api/house-scenes/{scene_id}")).json())["lights"]["a"]["effect"] == "chase"
    # Not baked yet: it can't play.
    assert (await client.post(f"/api/house-scenes/{scene_id}/play")).status == 409
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 40)
    assert (await client.put(f"/api/house-scenes/{scene_id}/baked", data=b"junk")).status == 400
    assert (await client.put(f"/api/house-scenes/{scene_id}/baked", data=blob)).status == 200
    [row] = await (await client.get("/api/house-scenes")).json()
    assert row["baked"] and row["name"] == "Candy cane"
    st = await (await client.post(f"/api/house-scenes/{scene_id}/play")).json()
    assert st["scene"] == {"id": scene_id, "name": "Candy cane", "playing": True}
    st = await (await client.post(f"/api/house-scenes/{scene_id}/stop")).json()
    assert st["scene"] is None
    assert (await client.delete(f"/api/house-scenes/{scene_id}")).status == 200
    assert await (await client.get("/api/house-scenes")).json() == []
    assert (await client.delete(f"/api/house-scenes/{scene_id}")).status == 404


async def test_the_editor_stopping_its_own_show_only_stops_that_show(client):
    resp = await client.post("/api/player/stop", json={"show": "not-playing"})
    assert resp.status == 200
    assert (await client.post("/api/player/stop")).status == 200  # no body: stop whatever is on


async def test_advanced_scenes_are_saved_and_the_editor_plays_one_from_its_playhead(client):
    scene_id = (await (await client.post("/api/house-scenes", json={"name": "Snow"})).json())["id"]
    body = {"name": "Snow", "mode": "advanced", "loop": 10,
            "tracks": [{"device": "@house", "clips": [{"effect": "sweep", "start": 0, "end": 10, "color": "#ffffff"}]},
                       {"device": "a", "clips": [{"effect": "twinkle", "start": 2, "end": 8}]}]}
    assert (await client.put(f"/api/house-scenes/{scene_id}", json=body)).status == 200
    saved = await (await client.get(f"/api/house-scenes/{scene_id}")).json()
    assert saved["mode"] == "advanced" and saved["loop"] == 10 and len(saved["tracks"]) == 2
    [row] = await (await client.get("/api/house-scenes")).json()
    assert row["loop"] == 10 and row["tracks"][1]["device"] == "a"
    late = {**body, "tracks": [{"device": "a", "clips": [{"effect": "solid", "start": 9, "end": 12}]}]}
    assert (await client.put(f"/api/house-scenes/{scene_id}", json=late)).status == 400
    assert (await client.put(f"/api/house-scenes/{scene_id}", json={**body, "loop": 9999})).status == 400
    # Played from the Show editor's playhead.
    assert (await client.post("/api/player/play", json={"scene": "Not An Id"})).status == 400
    assert (await client.post("/api/player/play", json={"scene": "gone", "position": 1})).status == 409
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400)
    await client.put(f"/api/house-scenes/{scene_id}/baked", data=blob)
    st = await (await client.post("/api/player/play", json={"scene": scene_id, "position": 3})).json()
    assert st["scene"]["id"] == scene_id and st["scene"]["playing"] and st["position"] >= 3
    await client.post(f"/api/house-scenes/{scene_id}/stop")


async def test_a_scene_with_a_bad_schedule_is_turned_down(client):
    scene_id = (await (await client.post("/api/house-scenes", json={"name": "Glow"})).json())["id"]
    bad = {"name": "Glow", "mode": "basic", "lights": {}, "schedule": {"on": True, "start": "25:00", "end": "22:00"}}
    assert (await client.put(f"/api/house-scenes/{scene_id}", json=bad)).status == 400
