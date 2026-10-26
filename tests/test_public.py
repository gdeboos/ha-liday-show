import asyncio
import socket

import pytest
from aiohttp import ClientSession

from halidayshow import baked, public, server


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
async def client(aiohttp_client, tmp_path, monkeypatch):
    port = _free_port()
    monkeypatch.setenv("HALIDAY_SHOW_PUBLIC_PORT", str(port))
    monkeypatch.setattr(public.ai, "OPTIONS", tmp_path / "options.json")
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    c = await aiohttp_client(app)
    st = app[server.STORAGE]
    st.save_devices([{"id": "a", "ip": "", "segments": 1}])
    for sid, frames in (("party", 400), ("quiet", 400), ("hidden", 4)):
        st.save_show(sid, {"name": sid.title(), "tracks": []})
        st.save_baked(sid, baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * frames))
    settings = st.load_settings()
    settings["playlists"] = [{"id": "eve", "name": "Christmas Eve", "shows": ["party", "quiet"], "gap": 5}]
    st.save_settings(settings)
    c.public_port = port
    return c


async def _visitor(port, path, json=None):
    async with ClientSession() as s:
        if json is None:
            async with s.get(f"http://127.0.0.1:{port}{path}") as r:
                return r.status, (await r.json() if r.content_type == "application/json" else await r.text()), r.headers
        async with s.post(f"http://127.0.0.1:{port}{path}", json=json) as r:
            return r.status, (await r.json() if r.content_type == "application/json" else await r.text()), r.headers


T1, T2 = "a" * 20, "b" * 20


async def test_the_port_stays_shut_until_the_public_page_is_set_up(client):
    view = await (await client.get("/api/public")).json()
    assert view["listening"] is False and view["on"] is False and view["port"] == client.public_port
    with pytest.raises(OSError):
        await _visitor(client.public_port, "/api/state")
    resp = await client.put("/api/public", json={"on": False})
    assert (await resp.json())["listening"] is True
    status, st, _ = await _visitor(client.public_port, "/api/state")
    assert status == 200 and st["open"] is False and st["choices"] == []


async def test_visitors_see_only_ticked_shows_and_playlists(client):
    await client.put("/api/public", json={"on": True, "shows": ["party", "nope", "BAD id"], "playlists": ["eve"]})
    _, st, headers = await _visitor(client.public_port, f"/api/state?ticket={T1}")
    assert [(c["kind"], c["id"], c["name"]) for c in st["choices"]] == [
        ("show", "party", "Party"), ("playlist", "eve", "Christmas Eve")]
    assert st["choices"][1]["minutes"] == 1  # two 10 s shows and a 5 s pause, rounded up to a minute
    assert headers["Cache-Control"] == "no-store"
    status, _, _ = await _visitor(client.public_port, "/api/request", {"ticket": T1, "kind": "show", "id": "hidden"})
    assert status == 404


async def test_the_public_port_has_nothing_of_the_editor(client):
    await client.put("/api/public", json={"on": True})
    for path in ("/api/shows", "/api/devices", "/api/public", "/static/js/app.js", "/player", "/api/backup"):
        status, _, _ = await _visitor(client.public_port, path)
        assert status == 404, path
    status, html, headers = await _visitor(client.public_port, "/")
    assert status == 200 and "Light show" in html and "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    status, _, _ = await _visitor(client.public_port, "/public.js")
    assert status == 200


async def test_one_request_per_phone_and_a_full_queue(client):
    await client.put("/api/public", json={"on": True, "shows": ["party", "quiet"], "per_phone": 1, "queue": 2})
    runner = client.app[server.RUNNER]
    await runner.play("party")  # something's on, so requests wait
    status, st, _ = await _visitor(client.public_port, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 200 and st["mine"][0]["place"] == 1 and 5 <= st["mine"][0]["wait"] <= 10
    status, text, _ = await _visitor(client.public_port, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "already got a show waiting" in text
    await _visitor(client.public_port, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    status, text, _ = await _visitor(client.public_port, "/api/request", {"ticket": "c" * 20, "kind": "show", "id": "party"})
    assert status == 409 and "queue is full" in text
    view = await (await client.get("/api/public")).json()
    assert [w["name"] for w in view["waiting"]] == ["Quiet", "Party"]
    # Visitors can take back their own request, not someone else's.
    rid = runner.requests[0]["id"]
    await _visitor(client.public_port, "/api/cancel", {"ticket": T2, "id": rid})
    assert len(runner.requests) == 2
    _, st, _ = await _visitor(client.public_port, "/api/cancel", {"ticket": T1, "id": rid})
    assert st["mine"] == [] and len(runner.requests) == 1
    await client.post("/api/public/clear")
    assert runner.requests == []


async def test_bad_tickets_and_turning_visitors_off(client):
    await client.put("/api/public", json={"on": True, "shows": ["party"]})
    status, _, _ = await _visitor(client.public_port, "/api/request", {"ticket": "short", "kind": "show", "id": "party"})
    assert status == 400
    runner = client.app[server.RUNNER]
    await runner.play("quiet")
    await _visitor(client.public_port, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert runner.requests
    await client.put("/api/public", json={"on": False, "shows": ["party"]})
    assert runner.requests == []  # switched off: nobody's left waiting for a show that won't come
    status, text, _ = await _visitor(client.public_port, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "no shows right now" in text


def test_settings_are_cleaned():
    assert public.clean({"on": "yes", "shows": ["a", "a", 3], "per_phone": 99, "queue": 0}) == {
        "on": False, "shows": ["a"], "playlists": [], "per_phone": 5, "queue": 1}
    assert public.clean(None)["per_phone"] == 1 and public.clean(None)["queue"] == 5


def test_port_from_the_configuration_tab_or_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(public.ai, "OPTIONS", tmp_path / "options.json")
    monkeypatch.delenv("HALIDAY_SHOW_PUBLIC_PORT", raising=False)
    assert public.port() == 18099
    monkeypatch.setenv("HALIDAY_SHOW_PUBLIC_PORT", "20000")
    assert public.port() == 20000
    (tmp_path / "options.json").write_text('{"public_port": 21000}')
    assert public.port() == 21000
    (tmp_path / "options.json").write_text('{"public_port": 80}')
    assert public.port() == 18099
