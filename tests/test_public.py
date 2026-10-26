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


async def _visitor(client, path, json=None, code=True, headers=None):
    """A visitor's phone on the public port, with the code from the QR code unless code=False."""
    p = public.load(client.app[server.STORAGE])
    if code and p and p["code"]:
        if json is None:
            path += ("&" if "?" in path else "?") + f"code={p['code']}"
        else:
            json = {"code": p["code"], **json}
    async with ClientSession() as s:
        url = f"http://127.0.0.1:{client.public_port}{path}"
        req = s.get(url, headers=headers) if json is None else s.post(url, json=json, headers=headers)
        async with req as r:
            body = await r.json() if r.content_type == "application/json" else \
                await r.text() if r.content_type.startswith("text/") else await r.read()
            return r.status, body, r.headers


T1, T2 = "a" * 20, "b" * 20


async def test_the_port_stays_shut_until_the_public_page_is_set_up(client):
    view = await (await client.get("/api/public")).json()
    assert view["listening"] is False and view["on"] is False and view["port"] == client.public_port
    with pytest.raises(OSError):
        await _visitor(client, "/api/state")
    resp = await client.put("/api/public", json={"on": False})
    assert (await resp.json())["listening"] is True
    status, st, _ = await _visitor(client, "/api/state")
    assert status == 200 and st["open"] is False and st["choices"] == []


async def test_visitors_see_only_ticked_shows_and_playlists(client):
    await client.put("/api/public", json={"on": True, "items": [
        {"kind": "show", "id": "party"}, {"kind": "show", "id": "nope"}, {"kind": "show", "id": "BAD id"},
        {"kind": "playlist", "id": "eve"}]})
    _, st, headers = await _visitor(client, f"/api/state?ticket={T1}")
    assert [(c["kind"], c["id"], c["name"]) for c in st["choices"]] == [
        ("show", "party", "Party"), ("playlist", "eve", "Christmas Eve")]
    assert st["choices"][1]["minutes"] == 1  # two 10 s shows and a 5 s pause, rounded up to a minute
    assert headers["Cache-Control"] == "no-store"
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "hidden"})
    assert status == 404


async def test_the_public_port_has_nothing_of_the_editor(client):
    await client.put("/api/public", json={"on": True})
    for path in ("/api/shows", "/api/devices", "/api/public", "/static/js/app.js", "/player", "/api/backup"):
        status, _, _ = await _visitor(client, path)
        assert status == 404, path
    status, html, headers = await _visitor(client, "/")
    assert status == 200 and "Light show" in html and "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    status, _, _ = await _visitor(client, "/public.js")
    assert status == 200


async def test_one_request_per_phone_and_a_full_queue(client):
    await client.put("/api/public", json={"on": True, "shows": ["party", "quiet"], "per_phone": 1, "queue": 2})
    runner = client.app[server.RUNNER]
    await runner.play("party")  # something's on, so requests wait
    status, st, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 200 and st["mine"][0]["place"] == 1 and 5 <= st["mine"][0]["wait"] <= 10
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "already got a show waiting" in text
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    status, text, _ = await _visitor(client, "/api/request", {"ticket": "c" * 20, "kind": "show", "id": "party"})
    assert status == 409 and "queue is full" in text
    view = await (await client.get("/api/public")).json()
    assert [w["name"] for w in view["waiting"]] == ["Quiet", "Party"]
    # Visitors can take back their own request, not someone else's.
    rid = runner.requests[0]["id"]
    await _visitor(client, "/api/cancel", {"ticket": T2, "id": rid})
    assert len(runner.requests) == 2
    _, st, _ = await _visitor(client, "/api/cancel", {"ticket": T1, "id": rid})
    assert st["mine"] == [] and len(runner.requests) == 1
    await client.post("/api/public/clear")
    assert runner.requests == []


async def test_bad_tickets_and_turning_visitors_off(client):
    await client.put("/api/public", json={"on": True, "shows": ["party"]})
    status, _, _ = await _visitor(client, "/api/request", {"ticket": "short", "kind": "show", "id": "party"})
    assert status == 400
    runner = client.app[server.RUNNER]
    await runner.play("quiet")
    await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert runner.requests
    await client.put("/api/public", json={"on": False, "shows": ["party"]})
    assert runner.requests == []  # switched off: nobody's left waiting for a show that won't come
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "no shows right now" in text


def test_settings_are_cleaned():
    assert public.clean({"on": "yes", "items": [{"kind": "show", "id": "a"}, {"kind": "show", "id": "a"},
                                                {"kind": "song", "id": "b"}, {"kind": "playlist", "id": "Bad Id"},
                                                {"kind": "playlist", "id": "eve", "from": "12-01", "to": "01-06"},
                                                {"kind": "show", "id": "c", "from": "02-30", "to": "03-01"}],
                         "per_phone": 99, "queue": 0}) == {
        "on": False, "per_phone": 5, "queue": 1, "code": "", "nearby": True, "distance": 100, "address": "",
        "look": public.clean_look(None), "hours": public.DEFAULT_HOURS,
        "items": [{"kind": "show", "id": "a", "from": "", "to": ""},
                  {"kind": "playlist", "id": "eve", "from": "12-01", "to": "01-06"},
                  {"kind": "show", "id": "c", "from": "", "to": ""}]}  # a broken range: all year
    assert public.clean(None)["per_phone"] == 1 and public.clean(None)["queue"] == 5


def test_picks_saved_before_dates_come_back_as_items():
    assert public.clean({"on": True, "shows": ["party"], "playlists": ["eve"]})["items"] == [
        {"kind": "show", "id": "party", "from": "", "to": ""}, {"kind": "playlist", "id": "eve", "from": "", "to": ""}]


def test_dates_come_round_every_year():
    from datetime import date
    xmas = {"kind": "show", "id": "x", "from": "12-01", "to": "01-06"}
    assert public.available(xmas, date(2026, 12, 25)) and public.available(xmas, date(2027, 1, 6))
    assert not public.available(xmas, date(2026, 10, 26))
    assert public.next_from(xmas, date(2026, 10, 26)) == date(2026, 12, 1)
    assert public.next_from(xmas, date(2027, 1, 7)) == date(2027, 12, 1)
    leap = {"kind": "show", "id": "x", "from": "02-29", "to": "03-02"}
    assert public.next_from(leap, date(2027, 1, 1)) == date(2027, 3, 1)


async def test_visitors_see_later_shows_as_coming_soon(client, monkeypatch):
    from datetime import date
    await client.put("/api/public", json={"on": True, "items": [
        {"kind": "show", "id": "party"},
        {"kind": "show", "id": "quiet", "from": "12-01", "to": "12-31"},
        {"kind": "playlist", "id": "eve", "from": "11-20", "to": "11-30"}]})
    monkeypatch.setattr(public, "date", type("D", (date,), {"today": classmethod(lambda c: date(2026, 10, 26))}))
    public._CHOICES.clear()
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert [c["id"] for c in st["choices"]] == ["party"]
    assert [(c["id"], c["starts"]) for c in st["soon"]] == [("eve", "2026-11-20"), ("quiet", "2026-12-01")]
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 404


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


async def test_archived_shows_are_never_offered(client):
    from halidayshow import archive

    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"},
                                                                {"kind": "playlist", "id": "eve"}]})
    archive.archive_show(client.app[server.STORAGE], "quiet")
    public._CHOICES.clear()
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert [c["id"] for c in st["choices"]] == ["party", "eve"]
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 404
    # The playlist plays without it.
    assert public.choices(client.app[server.STORAGE])[1]["shows"] == ["party"]



async def test_visitors_need_the_code_from_the_sign(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "code": "mine123"})
    code = public.load(client.app[server.STORAGE])["code"]
    assert len(code) == 8 and code != "mine123"  # made by the app, not taken from the editor
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}", code=False)
    assert st["locked"] and set(st) == {"open", "locked", "look"}
    assert set(st["look"]) == {"theme", "mode", "spacing", "corners", "size", "borders", "colours"}  # no words or picture
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party", "code": "nope1234"},
                                     code=False)
    assert status == 403 and "Scan the code" in text
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}&code={code.upper()}", code=False)
    assert st["choices"]  # typed in capitals from a sign still works
    # A new code stops the old link working.
    view = await (await client.post("/api/public/code")).json()
    assert view["code"] != code
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}&code={code}", code=False)
    assert st.get("locked")


async def test_settings_saved_before_codes_get_one(tmp_path):
    from halidayshow.runner import Runner
    from halidayshow.storage import Storage

    st = Storage(tmp_path / "c", tmp_path / "m")
    settings = st.load_settings()
    settings["public"] = {"on": True, "items": []}
    st.save_settings(settings)
    site = public.PublicSite(st, Runner(st, None, None))
    site.port = _free_port()
    await site.apply()
    await site.close()
    assert len(public.load(st)["code"]) == 8


FAR = {"CF-Connecting-IP": "203.0.113.9"}  # through a Cloudflare tunnel
HOME = (51.5007, -0.1246)


async def test_through_a_tunnel_phones_must_be_by_the_lights(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "distance": 100})
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}", headers=FAR)
    assert st["needs_location"] is True
    ask = {"ticket": T1, "kind": "show", "id": "party"}
    status, text, _ = await _visitor(client, "/api/request", ask, headers=FAR)
    assert status == 403 and "Turn on location" in text
    # About 1 km away.
    status, text, _ = await _visitor(client, "/api/request", {**ask, "lat": 51.5097, "lon": -0.1246, "accuracy": 20},
                                     headers=FAR)
    assert status == 403 and "too far away" in text
    # Across the road, with a rough fix that might be closer than it says.
    status, _, _ = await _visitor(client, "/api/request", {**ask, "lat": 51.5009, "lon": -0.1246, "accuracy": 80},
                                  headers=FAR)
    assert status == 200


async def test_your_own_wifi_and_the_switch_skip_the_location_check(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}]})
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")  # straight from this machine
    assert st["needs_location"] is False
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "nearby": False})
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"}, headers=FAR)
    assert status == 200
    # With no home location it can't be checked, so internet visitors are refused; the tab says so.
    client.app[server.SCHEDULER].where = lambda: (None, None)
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "nearby": True})
    view = await (await client.get("/api/public")).json()
    assert view["home"] is None
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party",
                                                              "lat": 51.5, "lon": -0.12}, headers=FAR)
    assert status == 403 and "can't be started from here" in text
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    assert status == 200  # your own Wi-Fi still works


def test_distance_and_address_are_checked():
    assert public.clean({"distance": 5})["distance"] == 25 and public.clean({"distance": "x"})["distance"] == 100
    assert public.clean({"address": "https://lights.example.com/"})["address"] == "https://lights.example.com"
    assert public.clean({"address": "javascript:alert(1)"})["address"] == ""
    assert public.link({"address": "https://l.example.com", "code": "abc23456"}) == "https://l.example.com/?c=abc23456"
    assert round(public.metres(HOME, (51.5016, -0.1246))) == 100



async def test_odd_codes_and_cancelling_need_the_code_too(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}]})
    status, st, _ = await _visitor(client, f"/api/state?ticket={T1}&code=%C3%A9%C3%A9%C3%A9%C3%A9%C3%A9%C3%A9", code=False)
    assert status == 200 and st.get("locked")
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party", "code": "éééééé"},
                                  code=False)
    assert status == 403
    runner = client.app[server.RUNNER]
    await runner.play("quiet")
    await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    rid = runner.requests[0]["id"]
    status, _, _ = await _visitor(client, "/api/cancel", {"ticket": T1, "id": rid}, code=False)
    assert status == 403 and runner.requests


async def test_the_page_asks_whether_its_near_before_offering_start(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}]})
    status, st, _ = await _visitor(client, "/api/near", {"lat": 51.5097, "lon": -0.1246, "accuracy": 20}, headers=FAR)
    assert status == 200 and st["near"] is False and st["why"] == "far" and "too far away" in st["text"]
    status, st, _ = await _visitor(client, "/api/near", {"lat": 51.5008, "lon": -0.1246, "accuracy": 10}, headers=FAR)
    assert status == 200 and st == {"near": True}
    _, st, _ = await _visitor(client, "/api/near", {}, headers=FAR)
    assert st["why"] == "location"
    client.app[server.SCHEDULER].where = lambda: (None, None)
    _, st, _ = await _visitor(client, "/api/near", {"lat": 51.5008, "lon": -0.1246}, headers=FAR)
    assert st["why"] == "closed"
    status, st, _ = await _visitor(client, "/api/near", {})  # your own Wi-Fi: no need
    assert st == {"near": True}
    status, _, _ = await _visitor(client, "/api/near", {"lat": 51.5008, "lon": -0.1246}, code=False, headers=FAR)
    assert status == 403



def test_the_look_is_cleaned():
    look = public.clean_look({"title": "  The   Deboos  Lights ", "welcome": " Hello!\n  Be kind \n", "theme": "halloween",
                              "mode": "neon", "snow": "yes", "picture": "upload", "link": "javascript:alert(1)",
                              "link_text": "x" * 200})
    assert {k: look[k] for k in ("title", "welcome", "picture", "theme", "mode", "snow", "link", "link_text")} == {
        "title": "The Deboos Lights", "welcome": "Hello!\nBe kind", "picture": "upload",
        "theme": "halloween", "mode": "auto", "snow": False, "link": "", "link_text": "x" * 80}
    assert (look["spacing"], look["corners"], look["size"], look["borders"]) == ("normal", "soft", "normal", True)
    own = public.clean_look({"theme": "custom", "spacing": "roomy", "corners": "round", "size": "huge", "borders": False,
                             "colours": {"bg": "#FFFFFF", "text": "red", "panel": 7}})
    assert (own["theme"], own["spacing"], own["corners"], own["size"], own["borders"]) == ("custom", "roomy", "round",
                                                                                          "normal", False)
    assert own["colours"]["bg"] == "#ffffff" and own["colours"]["text"] == public.DEFAULT_COLOURS["text"]
    assert public.clean_look({"link": "https://justgiving.com/x?y=1"})["link"] == "https://justgiving.com/x?y=1"
    assert public.clean_look(None)["theme"] == "plain"


async def test_visitors_get_the_look_and_picture_only_with_the_code(client):
    st = client.app[server.STORAGE]
    look = {"title": "The Deboos Lights", "welcome": "Hello", "theme": "christmas", "mode": "dark", "snow": True,
            "picture": "house", "link": "https://example.org/give", "link_text": "Give"}
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "look": look})
    _, state, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert {k: state["look"][k] for k in look} == {**look, "picture": 0}  # no house photo yet
    st.save_house_photo(b"\xff\xd8\xffphoto", ".jpg")
    _, state, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert state["look"]["picture"] > 0
    status, body, _ = await _visitor(client, "/picture")
    assert status == 200
    status, _, _ = await _visitor(client, "/picture", code=False)
    assert status == 404
    _, locked, _ = await _visitor(client, f"/api/state?ticket={T1}", code=False)
    assert locked["look"]["theme"] == "christmas" and "title" not in locked["look"]
    # An uploaded picture instead; choosing another keeps it, in case you change your mind.
    resp = await client.put("/api/public/picture", data=b"\x89PNGpic", headers={"Content-Type": "image/png"})
    assert (await resp.json())["look"]["picture"] == "upload" and st.public_picture() is not None
    assert (await client.put("/api/public/picture", data=b"x", headers={"Content-Type": "text/html"})).status == 415
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}],
                                          "look": {**look, "picture": "house"}})
    assert st.public_picture() is not None


async def test_the_editor_previews_the_page_as_visitors_with_the_code_see_it(client):
    st = client.app[server.STORAGE]
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}],
                                          "look": {"title": "Deboos Lights", "picture": "house"}})
    st.save_house_photo(b"\xff\xd8\xffphoto", ".jpg")
    resp = await client.get("/public-preview/api/state")
    view = await resp.json()
    assert view["preview"] is True and view["look"]["title"] == "Deboos Lights" and view["choices"]
    assert view["needs_location"] is False and "locked" not in view
    assert (await client.get("/public-preview/picture")).status == 200
    assert (await client.get("/public-preview/")).status == 200
    assert (await client.get("/public-preview/public.js")).status == 200
    # It can't start or cancel anything.
    assert (await client.post("/public-preview/api/request", json={})).status in (404, 405)



def test_opening_hours():
    from datetime import datetime
    p = public.clean({"hours": {"on": True, "start": "17:00", "end": "22:00", "days": [5, 6], "from": "12-01", "to": "12-02"}})
    assert p["hours"]["from"] == ""  # dates belong to each show, not the hours
    sat = datetime(2026, 10, 31, 18, 0)  # a Saturday
    assert public.hours_now(p, None, sat) == {"open": True}
    morning = public.hours_now(p, None, datetime(2026, 10, 31, 9, 30))
    assert morning == {"open": False, "next": "2026-10-31T17:00", "now": "2026-10-31T09:30"}
    assert public.hours_now(p, None, datetime(2026, 10, 26, 18, 0))["next"] == "2026-10-31T17:00"  # Monday
    assert public.hours_now(public.clean({}), None, sat) == {"open": True}  # off: always open
    assert public.clean({"hours": {"on": True, "start": "25:00"}})["hours"] == public.DEFAULT_HOURS
    # Sunset with nowhere to work it out from never opens.
    dusk = public.clean({"hours": {"on": True, "start": "sunset", "offset": 0, "end": "22:00", "days": [0, 1, 2, 3, 4, 5, 6]}})
    assert public.hours_now(dusk, None, sat) == {"open": False, "next": None, "now": "2026-10-31T18:00"}


async def test_outside_the_hours_visitors_are_told_and_refused(client, monkeypatch):
    from datetime import datetime
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}],
                                          "hours": {"on": True, "start": "17:00", "end": "17:01", "days": [0]}})
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    if datetime.now().weekday() == 0 and datetime.now().strftime("%H:%M") == "17:00":
        return  # by chance it's open this minute
    assert st["hours"]["open"] is False and st["hours"]["next"].endswith("T17:00")
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "Come back" in text
    # A visitor already waiting still gets their show; that's the runner's queue, untouched by the hours.


async def test_the_sign_and_its_qr_code(client):
    await client.put("/api/public", json={"on": True, "address": "https://lights.example.com",
                                          "look": {"sign_text": "  Please be kind  "}})
    view = await (await client.get("/api/public")).json()
    assert view["look"]["sign_text"] == "Please be kind"
    link = f"https://lights.example.com/?c={view['code']}"
    resp = await client.get("/api/public/qr.svg", params={"link": link})
    assert resp.status == 200 and resp.content_type == "image/svg+xml" and "<svg" in await resp.text()
    resp = await client.get("/api/public/qr.svg", params={"link": link, "download": "1"})
    assert "attachment" in resp.headers["Content-Disposition"]
    # Only your own visitors' link, with your current code.
    for bad in ("https://lights.example.com/?c=wrong123", "javascript:alert(1)", ""):
        assert (await client.get("/api/public/qr.svg", params={"link": bad})).status == 400
    assert (await client.get("/sign")).status == 200


def test_qr_code_reads_back():
    import segno
    qr = segno.make("https://lights.example.com/?c=abc23456", error="m", micro=False)
    assert qr.error == "M" and qr.designator  # a real QR code, not a micro one phones can't read


async def test_guessing_the_code_cant_lock_visitors_out(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}], "queue": 5,
                                          "nearby": False})
    # Wrong codes from many addresses (as if through a tunnel) don't use up everyone's limit.
    for k in range(public.MAX_POSTS_PER_MIN + 5):
        status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party",
                                                                "code": "wrongcode"},
                                      code=False, headers={"X-Forwarded-For": f"203.0.113.{k % 250}, 10.0.0.{k % 7}"})
        assert status in (403, 429)
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"},
                                  headers={"X-Forwarded-For": "198.51.100.7"})
    assert status == 200


async def test_each_visitor_has_their_own_share(client, monkeypatch):
    monkeypatch.setattr(public, "MAX_POSTS_PER_CLIENT_MIN", 3)
    monkeypatch.setattr(public, "MAX_STATE_PER_CLIENT_MIN", 4)
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}]})
    one, other = {"X-Forwarded-For": "198.51.100.1"}, {"X-Forwarded-For": "198.51.100.2"}
    for _ in range(3):
        await _visitor(client, "/api/cancel", {"ticket": T1, "id": "x"}, headers=one)
    status, _, _ = await _visitor(client, "/api/cancel", {"ticket": T1, "id": "x"}, headers=one)
    assert status == 429
    status, _, _ = await _visitor(client, "/api/cancel", {"ticket": T2, "id": "x"}, headers=other)
    assert status == 200
    for _ in range(4):
        assert (await _visitor(client, "/api/state", headers=one))[0] == 200
    assert (await _visitor(client, "/api/state", headers=one))[0] == 429
    assert (await _visitor(client, "/api/state", headers=other))[0] == 200


def test_who_is_asking():
    class R:
        def __init__(self, remote, headers):
            self.remote, self.headers = remote, headers
    assert public.client(R("192.168.1.5", {"X-Forwarded-For": "1.2.3.4, 5.6.7.8"})) == "5.6.7.8"
    assert public.client(R("172.30.32.1", {"X-Real-IP": "9.9.9.9"})) == "9.9.9.9"
    # A header the proxy only passes on, as the visitor wrote it, isn't believed.
    assert public.client(R("172.30.32.1", {"CF-Connecting-IP": "6.6.6.6", "X-Forwarded-For": "9.9.9.9"})) == "9.9.9.9"
    # Straight from the internet, a visitor's own headers aren't believed.
    assert public.client(R("81.2.69.160", {"X-Forwarded-For": "1.1.1.1"})) == "81.2.69.160"
    # One IPv6 phone or home is one visitor, whatever the end of its address.
    a = public.client(R("2001:db8:1:2::1", {}))
    assert a == public.client(R("2001:db8:1:2:ffff::9", {})) != public.client(R("2001:db8:1:3::1", {}))


def test_a_flood_of_addresses_forgets_the_longest_quiet_not_everyone(monkeypatch):
    monkeypatch.setattr(public, "MAX_CLIENTS", 10)

    class R:
        def __init__(self, ip):
            self.remote, self.headers, self.app = ip, {}, app
    app = {public.CLIENTS: {}}
    for k in range(30):
        public._limit_client(R(f"81.2.70.{k}"), "state", 100)
    for _ in range(5):
        public._limit_client(R("81.2.69.1"), "state", 100)  # someone using the page right now
    for k in range(3):
        public._limit_client(R(f"81.2.71.{k}"), "state", 100)
    seen = app[public.CLIENTS]
    assert len(seen) <= 10 and len(seen[("state", "81.2.69.1")]) == 5
