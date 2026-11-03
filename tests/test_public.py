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
    monkeypatch.setattr(public, "LOOPBACK_IS_LOCAL", True)  # the test's "phone" is this machine
    monkeypatch.setattr(public.ai, "OPTIONS", tmp_path / "options.json")
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    c = await aiohttp_client(app)
    st = app[server.STORAGE]
    st.save_devices([{"id": "a", "ip": "", "segments": 1}])
    for sid, frames in (("party", 400), ("quiet", 400), ("hidden", 4), ("carols", 400), ("extra", 400)):
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
# The smallest JPEG the picture cleaner can read all through: start, one scan, end.
PHOTO = b"\xff\xd8\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x12\x34\xff\xd9"


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
    await client.put("/api/public", json={"on": True, "shows": ["party", "quiet", "extra"], "per_phone": 1, "queue": 2})
    runner = client.app[server.RUNNER]
    await runner.play("carols")  # something's on, so requests wait
    status, st, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 200 and st["mine"][0]["place"] == 1 and 5 <= st["mine"][0]["wait"] <= 10
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 409 and "pick another show once yours starts" in text
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    status, text, _ = await _visitor(client, "/api/request", {"ticket": "c" * 20, "kind": "show", "id": "extra"})
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
    assert status == 409 and "no shows right now" in text.lower()


def test_settings_are_cleaned():
    assert public.clean({"on": "yes", "items": [{"kind": "show", "id": "a"}, {"kind": "show", "id": "a"},
                                                {"kind": "song", "id": "b"}, {"kind": "playlist", "id": "Bad Id"},
                                                {"kind": "playlist", "id": "eve", "from": "12-01", "to": "01-06"},
                                                {"kind": "show", "id": "c", "from": "02-30", "to": "03-01"}],
                         "per_phone": 99, "queue": 0}) == {
        "on": False, "per_phone": 5, "queue": 1, "code": "", "nearby": True, "distance": 100, "address": "",
        "look": public.clean_look(None), "hours": public.DEFAULT_HOURS, "words": {},
        "listen": False, "listen_pin": "", "admin_pin": "",
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
    assert st["locked"] and set(st) == {"open", "locked", "boot", "look", "words"}
    assert set(st["words"]) == {"locked", "locked_hint", "offline"}  # nothing else of the page
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
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"}], "nearby": True})
    view = await (await client.get("/api/public")).json()
    assert view["home"] is None
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party",
                                                              "lat": 51.5, "lon": -0.12}, headers=FAR)
    assert status == 403 and "can't be started from here" in text
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "quiet"})
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
    st.save_house_photo(PHOTO, ".jpg")
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
    st.save_house_photo(PHOTO, ".jpg")
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


async def test_a_picture_that_cant_be_cleaned_isnt_shown(client):
    st = client.app[server.STORAGE]
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}],
                                          "look": {"picture": "house"}})
    st.save_house_photo(b"\xff\xd8\xff\xe1\x00\x10Exif GPS cut short", ".jpg")
    assert (await _visitor(client, "/picture"))[0] == 404
    assert (await client.get("/public-preview/picture")).status == 404
    st.save_house_photo(PHOTO, ".jpg")
    assert (await _visitor(client, "/picture"))[0] == 200


def test_ipv4_visitors_written_the_ipv6_way_are_still_told_apart():
    class R:
        def __init__(self, remote, headers):
            self.remote, self.headers = remote, headers
    a = public.client(R("172.30.32.1", {"X-Forwarded-For": "::ffff:81.2.69.1"}))
    assert a == "81.2.69.1" != public.client(R("172.30.32.1", {"X-Forwarded-For": "::ffff:81.2.69.2"}))


def test_tunnels_and_proxies_never_count_as_your_home_wifi(monkeypatch):
    from unittest import mock

    def req(peer, headers=None):
        r = mock.Mock()
        r.remote, r.headers = peer, headers or {}
        return r

    assert public.is_local(req("192.168.1.30"))  # a phone on your Wi-Fi
    assert public.is_local(req("::ffff:192.168.1.30"))
    assert not public.is_local(req("127.0.0.1"))  # Tailscale Funnel, or anything else on this machine
    assert not public.is_local(req("::1"))
    assert not public.is_local(req("172.30.33.5"))  # another Home Assistant app, such as a proxy
    assert not public.is_local(req("192.168.1.30", {"CF-Connecting-IP": "203.0.113.9"}))
    assert not public.is_local(req("203.0.113.9"))
    assert not public.is_local(req("8.8.8.8"))
    assert public.is_local(req("10.0.0.7")) and public.is_local(req("fd00::7"))
    monkeypatch.setattr(public, "LOOPBACK_IS_LOCAL", True)
    assert public.is_local(req("127.0.0.1"))



async def test_the_editor_is_told_when_the_picture_changes(client):
    import os
    await client.put("/api/public", json={"on": True})
    resp = await client.put("/api/public/picture", data=b"\x89PNGone", headers={"Content-Type": "image/png"})
    first = (await resp.json())["picture_v"]
    assert first > 0
    pic = client.app[server.STORAGE].public_picture()
    os.utime(pic, (first + 60, first + 60))  # as if a new one came a minute later
    assert (await (await client.get("/api/public")).json())["picture_v"] == first + 60



def test_words_keep_only_your_own_changes():
    default = public.DEFAULT_WORDS["start"]
    assert public.clean_words({"start": "  ▶  Go!  ", "idle": public.DEFAULT_WORDS["idle"], "made_up": "x",
                               "full": "", "next": 5}) == {"start": "▶ Go!", "next": "5"}
    assert public.words(public.clean({"words": {"start": "Go"}}))["start"] == "Go"
    assert public.words(public.clean({}))["start"] == default
    assert len(public.clean_words({"start": "x" * 1000})["start"]) == public.MAX_WORD
    # Every key the page and server use is in the list.
    for key in ("locked", "too_far", "full", "one_waiting", "many_waiting", "busy", "not_open_now", "gone",
                "ask_house", "location_needed", "warning", "accept", "sign_scan", "come_back", "length"):
        assert key in public.DEFAULT_WORDS, key


async def test_visitors_get_your_words_and_the_server_uses_them(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "carols"}], "per_phone": 1,
                                          "words": {"start": "Go!", "one_waiting": "Patience, one at a time."},
                                          "look": {"show_length": False, "warning": "accept"}})
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert st["words"]["start"] == "Go!" and st["words"]["pick_head"] == public.DEFAULT_WORDS["pick_head"]
    assert st["look"]["show_length"] is False and st["look"]["warning"] == "accept"
    runner = client.app[server.RUNNER]
    await runner.play("quiet")
    await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "carols"})
    assert status == 409 and text == "Patience, one at a time."
    view = await (await client.get("/api/public")).json()
    assert view["words"] == {"start": "Go!", "one_waiting": "Patience, one at a time."}
    assert view["word_groups"][0]["words"][0]["key"] == "idle"


async def test_a_visitors_show_with_opening_hours_on_doesnt_break_the_page(client):
    # The page's own clock and the visitor's show playing used to share a name, so this was an error.
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"}],
                                          "hours": {"on": True, "start": "00:00", "end": "23:59", "days": list(range(7))}})
    await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert await _until(lambda: client.app[server.RUNNER].public_now is not None)
    status, st, _ = await _visitor(client, f"/api/state?ticket={T2}")
    assert status == 200 and "hours" in st


async def _until(check, tries=100):
    for _ in range(tries):
        if check():
            return True
        await asyncio.sleep(0.05)
    return False


async def test_shows_in_progress_are_never_offered(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"},
                                                                {"kind": "playlist", "id": "eve"}]})
    assert (await client.post("/api/shows/quiet/mark", json={"in_progress": True})).status == 200
    public._CHOICES.clear()
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert [c["id"] for c in st["choices"]] == ["party", "eve"]
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    assert status == 404
    assert public.choices(client.app[server.STORAGE])[1]["shows"] == ["party"]
    # Finished again, it's back, bake and all.
    assert (await client.post("/api/shows/quiet/mark", json={"in_progress": False})).status == 200
    public._CHOICES.clear()
    assert [c["id"] for c in public.choices(client.app[server.STORAGE])] == ["party", "quiet", "eve"]


def test_the_visitors_page_wraps_long_words():
    # A phone zooms the whole page out when one line is wider than the screen, as a show named with
    # underscores did in "On now: …". Every line wraps instead.
    css = (public.PAGE / "public.css").read_text()
    assert ".pp { overflow-wrap: anywhere; }" in css


async def test_visitors_see_each_shows_cover_art(client, tmp_path):
    import struct
    st = client.app[server.STORAGE]
    frame = b"\0image/jpeg\0\x03\0" + PHOTO
    body = b"APIC" + struct.pack(">I", len(frame)) + b"\0\0" + frame
    n = len(body)
    tag = b"ID3\x03\0\0" + bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F]) + body
    (tmp_path / "media").mkdir(exist_ok=True)
    (tmp_path / "media" / "art.mp3").write_bytes(tag + b"\xff\xfb" * 50)
    st.save_show("party", {"name": "Party", "tracks": [], "audio": {"source": "media", "path": "art.mp3"}})
    st.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"},
                                                                {"kind": "playlist", "id": "eve"}]})
    public._CHOICES.clear()
    _, view, _ = await _visitor(client, f"/api/state?ticket={T1}")
    covers = {c["id"]: c["cover"] for c in view["choices"]}
    assert covers["party"] and covers["eve"] and not covers["quiet"]  # the playlist uses its first show's
    status, pic, headers = await _visitor(client, "/cover?kind=show&id=party")
    assert status == 200 and headers["Content-Type"] == "image/jpeg" and pic == PHOTO
    assert (await _visitor(client, "/cover?kind=show&id=party", code=False))[0] == 404
    assert (await _visitor(client, "/cover?kind=show&id=quiet"))[0] == 404
    # The show's own picture wins over its song's cover art.
    own = PHOTO[:-2] + b"\x56\x78\xff\xd9"
    st.save_show_picture("party", own)
    public._CHOICES.clear()
    assert (await _visitor(client, "/cover?kind=show&id=party"))[1] == own
    # Turned off, there are none.
    p = await (await client.get("/api/public")).json()
    await client.put("/api/public", json={**p, "look": {**p["look"], "covers": False}})
    public._CHOICES.clear()
    _, view, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert not any(c["cover"] for c in view["choices"])
    assert (await _visitor(client, "/cover?kind=show&id=party"))[0] == 404


async def test_headings_group_shows_for_visitors(client):
    items = [{"kind": "show", "id": "quiet"}, {"kind": "heading", "name": "  Christmas   favourites "},
             {"kind": "show", "id": "party"}, {"kind": "playlist", "id": "eve"}, {"kind": "heading", "name": " "},
             {"kind": "heading", "name": "Christmas favourites"}]
    await client.put("/api/public", json={"on": True, "items": items})
    saved = (await (await client.get("/api/public")).json())["items"]
    assert [i.get("name") or i["id"] for i in saved] == ["quiet", "Christmas favourites", "party", "eve", "Christmas favourites"]
    public._CHOICES.clear()
    _, view, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert [(c["id"], c["group"]) for c in view["choices"]] == [
        ("quiet", ""), ("party", "Christmas favourites"), ("eve", "Christmas favourites")]


# Listening on visitors' phones ---------------------------------------------------------------------
def _song(tmp_path, name="song.wav", seconds=1.0):
    import struct
    rate, n = 8000, int(8000 * seconds)
    data = b"".join(struct.pack("<h", (i * 37) % 2000 - 1000) for i in range(n))
    head = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)))
    (tmp_path / "media").mkdir(exist_ok=True)
    (tmp_path / "media" / name).write_bytes(head + data)


@pytest.fixture
def song_show(client, tmp_path):
    client.app[server.PUBLIC].copies.folder = tmp_path / "copies"
    _song(tmp_path)
    st = client.app[server.STORAGE]
    st.save_show("party", {"name": "Party", "tracks": [], "audio": {"source": "media", "path": "song.wav"}})
    st.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    return st


async def test_listening_settings_are_cleaned():
    assert public.clean(None)["listen"] is False and public.clean(None)["listen_pin"] == ""
    p = public.clean({"listen": True, "listen_pin": " 2468 "})
    assert p["listen"] is True and p["listen_pin"] == "2468"
    for bad in ("12", "123456789", "12a4", None):
        assert public.clean({"listen_pin": bad})["listen_pin"] == ""


async def test_visitors_only_see_listen_when_it_is_on_and_never_the_pin(client):
    await client.put("/api/public", json={"on": True})
    _, st, _ = await _visitor(client, "/api/state")
    assert st["listen"] is None
    status, _, _ = await _visitor(client, "/api/listen", {})
    assert status == 409
    await client.put("/api/public", json={"on": True, "listen": True, "listen_pin": "4321"})
    _, st, _ = await _visitor(client, "/api/state")
    assert st["listen"] == {"pin": True} and "4321" not in str(st)
    view = await (await client.get("/api/public")).json()
    assert view["listen_pin"] == "4321" and "can_shrink_songs" in view
    status, _, _ = await _visitor(client, "/api/listen", {}, code=False)
    assert status == 403


async def test_the_pin_is_checked_remembered_and_slowed_down(client):
    await client.put("/api/public", json={"on": True, "listen": True, "listen_pin": "4321"})
    status, text, headers = await _visitor(client, "/api/listen", {})
    assert status == 403 and "Type the PIN" in text and headers["X-Listen"] == "pin"
    status, text, _ = await _visitor(client, "/api/listen", {"pin": "1111"})
    assert status == 403 and "isn't right" in text
    status, ok, _ = await _visitor(client, "/api/listen", {"pin": "4321"})
    assert status == 200 and ok["token"] and ok["pass"]
    # The pass works instead of the PIN next time...
    status, again, _ = await _visitor(client, "/api/listen", {"pass": ok["pass"]})
    assert status == 200 and again["pass"] == ok["pass"]
    status, _, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}")
    assert status == 200
    # ...until the PIN changes, which also ends listening passes already given out.
    await client.put("/api/public", json={"listen_pin": "9999"})
    status, _, headers = await _visitor(client, "/api/listen", {"pass": ok["pass"]})
    assert status == 403 and headers["X-Listen"] == "pin"
    status, _, headers = await _visitor(client, f"/api/listen/now?token={ok['token']}")
    assert status == 403 and headers["X-Listen"] == "renew"
    # Wrong guesses: a few, then a wait, even for the right one.
    for _ in range(public.MAX_PIN_TRIES):
        status, _, _ = await _visitor(client, "/api/listen", {"pin": "0000"})
        assert status == 403
    status, text, _ = await _visitor(client, "/api/listen", {"pin": "9999"})
    assert status == 429 and "10 minutes" in text


async def test_no_pin_means_no_pin_needed(client):
    await client.put("/api/public", json={"on": True, "listen": True})
    status, ok, _ = await _visitor(client, "/api/listen", {})
    assert status == 200 and "pass" not in ok and ok["seconds"] == public.LISTEN_FOR_S


async def test_listening_through_a_tunnel_needs_the_pin_and_to_be_nearby(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={"on": True, "listen": True, "listen_pin": "4321"})
    status, text, _ = await _visitor(client, "/api/listen", {"pin": "4321"}, headers=FAR)
    assert status == 403 and "Turn on location" in text
    status, text, _ = await _visitor(client, "/api/listen", {"pin": "4321", "lat": 51.5097, "lon": -0.1246},
                                     headers=FAR)
    assert status == 403 and "too far away" in text
    status, _, _ = await _visitor(client, "/api/listen", {"lat": 51.5008, "lon": -0.1246}, headers=FAR)
    assert status == 403  # nearby, but no PIN
    status, _, _ = await _visitor(client, "/api/listen", {"pin": "4321", "lat": 51.5008, "lon": -0.1246}, headers=FAR)
    assert status == 200


async def test_passes_run_out(client):
    await client.put("/api/public", json={"on": True, "listen": True})
    st = client.app[server.STORAGE]
    p = public.load(st)
    old = public.listen_token(st, p, int(public.time.time()) - 5)
    status, _, headers = await _visitor(client, f"/api/listen/now?token={old}")
    assert status == 403 and headers["X-Listen"] == "renew"
    for bad in ("", "x", "9999999999.zz"):
        status, _, _ = await _visitor(client, f"/api/listen/now?token={bad}")
        assert status == 403


@pytest.mark.skipif(public.songcopy.converter() is None, reason="needs ffmpeg")
async def test_a_listening_phone_gets_the_playing_song_and_where_it_is(client, song_show):
    await client.put("/api/public", json={"on": True, "listen": True})
    _, ok, _ = await _visitor(client, "/api/listen", {})
    status, now, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}")
    assert status == 200 and now == {"playing": False}
    runner = client.app[server.RUNNER]
    await runner.play("party")  # from the editor, with no speaker: phones still hear it
    for _ in range(100):
        _, now, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}")
        if now["ready"]:
            break
        await asyncio.sleep(0.1)
    assert now["playing"] and now["ready"] and now["name"] == "Party" and 0 <= now["position"] < 5
    status, body, headers = await _visitor(client, "/" + now["src"])
    assert status == 200 and headers["Content-Type"] == "audio/mp4" and len(body) > 100
    # Ranges work, as phones ask for the song in pieces.
    async with ClientSession() as s:
        async with s.get(f"http://127.0.0.1:{client.public_port}/{now['src']}", headers={"Range": "bytes=0-9"}) as r:
            assert r.status == 206 and len(await r.read()) == 10
    # Only that song, with its own signature.
    bad = now["src"].replace("sig=", "sig=0")[:-1]
    status, _, _ = await _visitor(client, "/" + bad, code=False)
    assert status == 403
    await runner.stop()
    status, _, _ = await _visitor(client, "/" + now["src"], code=False)
    assert status == 404
    status, silence, headers = await _visitor(client, "/listen/silence.wav", code=False)
    assert status == 200 and silence[:4] == b"RIFF"


async def test_without_a_converter_the_song_goes_as_it_is(client, song_show, monkeypatch):
    monkeypatch.setattr(public.songcopy, "converter", lambda: None)
    await client.put("/api/public", json={"on": True, "listen": True})
    _, ok, _ = await _visitor(client, "/api/listen", {})
    await client.app[server.RUNNER].play("party")
    _, now, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}")
    assert now["ready"]
    status, body, headers = await _visitor(client, "/" + now["src"], code=False)
    assert status == 200 and headers["Content-Type"] == "audio/wav" and body[:4] == b"RIFF"
    await client.app[server.RUNNER].stop()


@pytest.mark.skipif(public.songcopy.converter() is None, reason="needs ffmpeg")
async def test_a_song_ffmpeg_cant_read_goes_as_it_is(tmp_path):
    copies = public.songcopy.SongCopies(tmp_path / "copies")
    bad = tmp_path / "bad.mp3"
    bad.write_bytes(b"not really a song" * 10)
    assert copies.ready(bad) is None
    copies.want(bad)
    for _ in range(100):
        if not copies.making:
            break
        await asyncio.sleep(0.05)
    assert copies.ready(bad) == (bad, "audio/mpeg")
    bad.write_bytes(b"saved over")  # a new file is tried afresh
    assert copies.ready(bad) is None


async def test_only_the_newest_copies_are_kept(tmp_path):
    copies = public.songcopy.SongCopies(tmp_path)
    for i in range(public.songcopy.KEEP + 3):
        (tmp_path / f"{i:03d}.m4a").write_bytes(b"x")
        public.os.utime(tmp_path / f"{i:03d}.m4a", (i, i))
    copies._tidy()
    left = sorted(p.name for p in tmp_path.glob("*.m4a"))
    assert len(left) == public.songcopy.KEEP and left[0] == "003.m4a"


async def test_the_page_asks_for_its_files_by_what_is_in_them(client):
    await client.put("/api/public", json={"on": True})
    status, html, headers = await _visitor(client, "/", code=False)
    assert status == 200 and headers["Cache-Control"] == "no-cache"
    stamp = public._STAMP
    assert f'src="public.js?v={stamp}"' in html and f'href="public.css?v={stamp}"' in html
    status, js, headers = await _visitor(client, f"/public.js?v={stamp}", code=False)
    assert status == 200 and headers["Content-Type"].startswith("text/javascript")
    assert f'"./listensync.js?v={stamp}"' in js and f'"./colours.js?v={stamp}"' in js
    for name in ("listensync.js", "colours.js", "public.css"):
        status, _, headers = await _visitor(client, f"/{name}?v={stamp}", code=False)
        assert status == 200 and "max-age" in headers["Cache-Control"], name
    # The editor's preview gets the same.
    resp = await client.get("/public-preview/")
    assert f"public.js?v={stamp}" in await resp.text()


async def test_admin_pin_is_cleaned_and_kept_from_visitors(client):
    assert public.clean(None)["admin_pin"] == ""
    assert public.clean({"admin_pin": " 8642 "})["admin_pin"] == "8642"
    for bad in ("12", "123456789", "12a4", None):
        assert public.clean({"admin_pin": bad})["admin_pin"] == ""
    await client.put("/api/public", json={"on": True, "admin_pin": "8642"})
    _, st, _ = await _visitor(client, "/api/state")
    assert "8642" not in str(st) and st["admin"] is False
    assert (await (await client.get("/api/public")).json())["admin_pin"] == "8642"


async def _unlock(client, pin="8642"):
    status, ok, _ = await _visitor(client, "/api/admin", {"pin": pin})
    assert status == 200 and ok["pass"]
    return {"X-Admin": ok["pass"]}


async def test_the_admin_pin_unlocks_only_with_the_right_pin_and_code(client):
    await client.put("/api/public", json={"on": True})
    status, _, _ = await _visitor(client, "/api/admin", {"pin": "8642"})
    assert status == 403  # no admin PIN set: nothing to unlock
    await client.put("/api/public", json={"admin_pin": "8642"})
    status, _, _ = await _visitor(client, "/api/admin", {"pin": "8642"}, code=False)
    assert status == 403
    status, text, _ = await _visitor(client, "/api/admin", {"pin": "1111"})
    assert status == 403 and "isn't right" in text
    me = await _unlock(client)
    _, st, _ = await _visitor(client, "/api/state", headers=me)
    assert st["admin"] is True
    # A made-up pass is no pass, and changing the PIN ends the old one.
    _, st, _ = await _visitor(client, "/api/state", headers={"X-Admin": "0" * 32})
    assert st["admin"] is False
    await client.put("/api/public", json={"admin_pin": "2222"})
    _, st, _ = await _visitor(client, "/api/state", headers=me)
    assert st["admin"] is False
    # Wrong guesses are slowed down, and don't hold up the listening PIN.
    for _ in range(public.MAX_PIN_TRIES):
        await _visitor(client, "/api/admin", {"pin": "0000"})
    status, _, _ = await _visitor(client, "/api/admin", {"pin": "2222"})
    assert status == 429
    await client.put("/api/public", json={"listen": True, "listen_pin": "4321"})
    status, _, _ = await _visitor(client, "/api/listen", {"pin": "4321"})
    assert status == 200


async def test_admin_skips_nearby_hours_limits_and_the_page_being_off(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={
        "on": False, "items": [{"kind": "show", "id": "party"}, {"kind": "show", "id": "quiet"},
                               {"kind": "show", "id": "carols"}],
        "per_phone": 1, "queue": 1, "admin_pin": "8642",
        "hours": {"on": True, "start": "03:00", "end": "03:01", "days": [0]}})
    me = await _unlock(client)
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}", headers=FAR)
    assert st["open"] is False and st["choices"] == []
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}", headers={**FAR, **me})
    assert st["open"] and st["admin"] and st["hours"] == {"open": True} and st["needs_location"] is False
    assert {c["id"] for c in st["choices"]} == {"party", "quiet", "carols"}
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"}, headers=FAR)
    assert status == 409
    runner = client.app[server.RUNNER]
    await runner.play("extra")  # something's on, so requests wait
    for show in ("party", "quiet", "carols"):  # past one per phone and a queue of one
        status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": show},
                                         headers={**FAR, **me})
        assert status == 200, text
    assert len(runner.requests) == 3
    _, near, _ = await _visitor(client, "/api/near", {}, headers={**FAR, **me})
    assert near == {"near": True}
    await runner.stop()


async def test_admin_listens_without_the_pin_or_being_nearby(client):
    client.app[server.SCHEDULER].where = lambda: (HOME, "you")
    await client.put("/api/public", json={"on": False, "listen": True, "listen_pin": "4321", "admin_pin": "8642"})
    me = await _unlock(client)
    status, _, _ = await _visitor(client, "/api/listen", {}, headers=FAR)
    assert status == 409  # visitors are off
    status, ok, _ = await _visitor(client, "/api/listen", {}, headers={**FAR, **me})
    assert status == 200 and ok["token"] and "pass" not in ok
    status, now, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}", headers={**FAR, **me})
    assert status == 200 and now == {"playing": False}
    status, _, _ = await _visitor(client, f"/api/listen/now?token={ok['token']}", headers=FAR)
    assert status == 409


def test_admin_song_links_only_work_with_their_own_signature(tmp_path):
    from halidayshow.storage import Storage
    st = Storage(tmp_path / "config", tmp_path / "media")
    p = public.clean({"code": "abcdef23", "admin_pin": "8642"})
    assert public.song_sig(st, p, "k", True) != public.song_sig(st, p, "k")


async def test_visitors_see_the_whole_queue_by_name_only(client):
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"}], "per_phone": 1})
    runner = client.app[server.RUNNER]
    await runner.play("carols")  # something's on, so requests wait
    await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "quiet"})
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert [(q["name"], q["yours"]) for q in st["queue"]] == [("Quiet", True), ("Party", False)]
    assert (st["queue"][0]["kind"], st["queue"][0]["ref"]) == ("show", "quiet")
    assert "id" in st["queue"][0] and "id" not in st["queue"][1]
    assert T2 not in str(st) and "ticket" not in str(st["queue"])
    assert st["now"]["name"] == "Carols" and 0 <= st["now"]["position"] <= st["now"]["duration"] == 10
    _, st, _ = await _visitor(client, "/api/state")  # no ticket: nothing is anyone's
    assert [q["yours"] for q in st["queue"]] == [False, False]
    await runner.stop()


async def test_the_same_show_cant_be_queued_twice(client):
    await client.put("/api/public", json={"on": True, "per_phone": 5, "admin_pin": "8642",
                                          "items": [{"kind": "show", "id": "party"}, {"kind": "show", "id": "quiet"},
                                                    {"kind": "show", "id": "carols"}]})
    runner = client.app[server.RUNNER]
    await runner.play("carols")  # on now, from the editor
    status, text, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "carols"})
    assert status == 409 and "playing now" in text
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"})
    assert status == 200
    # Already waiting, whoever picked it.
    for ticket in (T1, T2):
        status, text, _ = await _visitor(client, "/api/request", {"ticket": ticket, "kind": "show", "id": "party"})
        assert status == 409 and "already in the queue" in text
    _, st, _ = await _visitor(client, f"/api/state?ticket={T2}")
    assert {c["id"]: c["taken"] for c in st["choices"]} == {"party": "queued", "quiet": "", "carols": "playing"}
    # Not even your own phone with the admin PIN.
    me = await _unlock(client)
    status, _, _ = await _visitor(client, "/api/request", {"ticket": T1, "kind": "show", "id": "party"}, headers=me)
    assert status == 409
    await runner.stop()


async def test_visitors_are_told_which_shows_have_no_speaker(client):
    st = client.app[server.STORAGE]
    show = st.load_show("party")
    st.save_show("party", {**show, "media_player": "media_player.porch"})
    st.save_baked("party", baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\xff\x00"] * 400))
    await client.put("/api/public", json={"on": True, "items": [{"kind": "show", "id": "party"},
                                                                {"kind": "show", "id": "quiet"}]})
    _, state, _ = await _visitor(client, "/api/state")
    assert {c["id"]: c["speaker"] for c in state["choices"]} == {"party": True, "quiet": False}
    settings = st.load_settings()
    settings["show_speaker"] = "media_player.garden"  # a default speaker covers every show
    st.save_settings(settings)
    public._CHOICES.clear()
    _, state, _ = await _visitor(client, "/api/state")
    assert all(c["speaker"] for c in state["choices"])


async def test_the_page_can_be_installed_as_an_app_with_its_code(client):
    await client.put("/api/public", json={"on": True, "look": {"title": "Northampton Close Lights",
                                                               "theme": "christmas", "mode": "dark"}})
    code = public.load(client.app[server.STORAGE])["code"]
    status, _, _ = await _visitor(client, "/manifest.webmanifest", code=False)
    assert status == 404  # no code, no app (the title is only for people with the code)
    async with ClientSession() as s:
        async with s.get(f"http://127.0.0.1:{client.public_port}/manifest.webmanifest?c={code}") as r:
            assert r.status == 200 and r.content_type == "application/manifest+json"
            m = await r.json(content_type=None)
    assert m["name"] == "Northampton Close Lights" and m["start_url"] == f"./?c={code}"
    assert m["display"] == "standalone" and m["background_color"] == "#0e1913"
    assert {i["sizes"] for i in m["icons"]} == {"192x192", "512x512"}
    status, png, headers = await _visitor(client, "/icon.png?s=192", code=False)
    assert status == 200 and headers["Content-Type"] == "image/png" and png[:8] == b"\x89PNG\r\n\x1a\n"
    status, _, _ = await _visitor(client, "/icon.png?s=7", code=False)
    assert status == 404


async def test_your_admin_phone_can_skip_stop_and_remove(client):
    await client.put("/api/public", json={"on": True, "per_phone": 3, "admin_pin": "8642",
                                          "items": [{"kind": "show", "id": s} for s in ("party", "quiet", "extra")]})
    runner = client.app[server.RUNNER]
    for path in ("/api/admin/skip", "/api/admin/stop", "/api/admin/remove"):
        status, _, _ = await _visitor(client, path, {"ticket": T1})
        assert status == 403  # not unlocked
    await runner.play("carols")  # something's on, so picks wait
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "party"})
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "quiet"})
    me = await _unlock(client)
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}", headers=me)
    assert all("id" in q for q in st["queue"])  # admin sees ids to remove
    _, st, _ = await _visitor(client, f"/api/state?ticket={T1}")
    assert not any("id" in q for q in st["queue"])  # visitors don't
    rid = runner.requests[1]["id"]
    status, st, _ = await _visitor(client, "/api/admin/remove", {"ticket": T1, "id": rid}, headers=me)
    assert status == 200 and [q["name"] for q in st["queue"]] == ["Party"]
    await runner.stop()
    await _until(lambda: runner.public_now is not None)  # Party starts
    status, _, _ = await _visitor(client, "/api/admin/skip", {"ticket": T1}, headers=me)
    assert status == 200
    await _until(lambda: runner.public_now is None and not runner.player.playing)
    await _visitor(client, "/api/request", {"ticket": T2, "kind": "show", "id": "quiet"})
    status, st, _ = await _visitor(client, "/api/admin/stop", {"ticket": T1}, headers=me)
    assert status == 200 and runner.requests == []
