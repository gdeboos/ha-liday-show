import json

import pytest

from halidayshow import profiles, server


def light(i, **kw):
    return {"id": i, "name": i.title(), "kind": "govee", "segments": 10, **kw}


def test_one_profile_by_default():
    devices = [light("a"), light("b")]
    ps, live = profiles.load({}, devices)
    assert live == "now" and ps == [{"id": "now", "name": "Now", "lights": ["a", "b"]}]
    assert profiles.lights({}, devices) == devices
    # One profile: saving the lights is saving every light, as always.
    settings = {}
    assert profiles.save_lights(settings, devices, None, [light("b")]) == [light("b")]
    assert "profiles" not in settings


def test_new_profile_copies_and_keeps_its_own():
    devices = [light("a"), light("b")]
    settings = {"house": {"paths": {"a": [[0, 0]]}}, "light_groups": [{"id": "g", "name": "G", "members": ["a"]}]}
    pid = profiles.add(settings, devices, "Next year", None)
    assert settings["live_profile"] == "now"
    assert profiles.get(settings, devices, pid, "house") == settings["house"]
    profiles.put(settings, devices, pid, "house", {"paths": {"b": [[1, 1]]}})
    assert settings["house"] == {"paths": {"a": [[0, 0]]}}  # the live one is untouched
    # A planned light joins the plan only; dropping "a" from the plan keeps it in Now.
    everything = profiles.save_lights(settings, devices, pid, [light("b"), light("c")])
    assert [d["id"] for d in everything] == ["a", "b", "c"]
    assert [d["id"] for d in profiles.lights(settings, everything)] == ["a", "b"]
    assert [d["id"] for d in profiles.lights(settings, everything, pid)] == ["b", "c"]
    # A light's settings are shared: renamed in the plan, renamed in Now too.
    everything = profiles.save_lights(settings, everything, pid, [light("b", name="Porch"), light("c")])
    assert profiles.lights(settings, everything)[1]["name"] == "Porch"
    # Taken out of Now, "a" is in no profile, so it goes.
    everything = profiles.save_lights(settings, everything, None, [light("b", name="Porch")])
    assert [d["id"] for d in everything] == ["b", "c"]


def test_make_live_moves_the_house_across():
    devices = [light("a"), light("b")]
    settings = {"house": {"paths": {"a": [[0, 0]]}}, "light_roles": {"a": "kick"}}
    pid = profiles.add(settings, devices, "Next year", None)
    profiles.put(settings, devices, pid, "house", {"paths": {"b": [[1, 1]]}})
    profiles.put(settings, devices, pid, "light_roles", {"b": "snare"})
    assert profiles.make_live(settings, devices, pid) == "now"
    assert settings["live_profile"] == pid
    assert settings["house"] == {"paths": {"b": [[1, 1]]}} and settings["light_roles"] == {"b": "snare"}
    assert profiles.get(settings, devices, "now", "house") == {"paths": {"a": [[0, 0]]}}
    assert profiles.get(settings, devices, "now", "light_roles") == {"a": "kick"}
    # And back again.
    profiles.make_live(settings, devices, "now")
    assert settings["house"] == {"paths": {"a": [[0, 0]]}}


def test_orphan_lights_belong_to_the_live_profile():
    settings = {"profiles": [{"id": "now", "name": "Now", "lights": ["a"]}, {"id": "p1", "name": "Plan", "lights": []}],
                "live_profile": "now"}
    devices = [light("a"), light("z")]  # z added by an older version
    assert [d["id"] for d in profiles.lights(settings, devices)] == ["a", "z"]


def test_remove_drops_its_own_lights():
    devices = [light("a")]
    settings = {}
    pid = profiles.add(settings, devices, "Plan", None)
    everything = profiles.save_lights(settings, devices, pid, [light("a"), light("new")])
    with pytest.raises(ValueError):
        profiles.remove(settings, everything, "now")
    assert [d["id"] for d in profiles.remove(settings, everything, pid)] == ["a"]


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    return await aiohttp_client(app)


async def test_profile_routes(client):
    lights = [{"id": "a", "name": "Pillars", "segments": 10}, {"id": "b", "name": "Eaves", "segments": 10}]
    assert (await client.put("/api/devices", json=lights)).status == 200
    await client.put("/api/house", json={"paths": {"a": [[0, 0], [1, 0]]}})
    await client.put("/api/house/photo", data=b"jpeg-now", headers={"Content-Type": "image/jpeg"})
    view = await (await client.get("/api/profiles")).json()
    assert view["live"] == "now" and [p["name"] for p in view["profiles"]] == ["Now"]

    resp = await client.post("/api/profiles", json={"name": "Next year"})
    assert resp.status == 200
    pid = (await resp.json())["id"]
    assert (await client.post("/api/profiles", json={"name": "next YEAR"})).status == 400
    q = f"?profile={pid}"
    # A copy: same lights, tracing and photo.
    assert [d["id"] for d in await (await client.get(f"/api/devices{q}")).json()] == ["a", "b"]
    assert (await (await client.get(f"/api/house{q}")).json())["paths"] == {"a": [[0, 0], [1, 0]]}
    assert await (await client.get(f"/api/house/photo{q}")).read() == b"jpeg-now"
    assert (await client.get("/api/devices?profile=nope")).status == 404

    # The plan changes without touching Now.
    plan = [{"id": "b", "name": "Eaves", "segments": 10}, {"id": "c", "name": "Tree", "segments": 20}]
    assert [d["id"] for d in await (await client.put(f"/api/devices{q}", json=plan)).json()] == ["b", "c"]
    await client.put(f"/api/house{q}", json={"paths": {"c": [[0.5, 0.5]]}})
    await client.put(f"/api/house/photo{q}", data=b"jpeg-plan", headers={"Content-Type": "image/jpeg"})
    await client.put(f"/api/light-groups{q}", json=[{"id": "g1", "name": "Tree and eaves", "members": ["b", "c"]}])
    await client.put(f"/api/light-roles{q}", json={"c": "kick"})
    assert [d["id"] for d in await (await client.get("/api/devices")).json()] == ["a", "b"]
    assert (await (await client.get("/api/house")).json())["paths"] == {"a": [[0, 0], [1, 0]]}
    assert await (await client.get("/api/house/photo")).read() == b"jpeg-now"
    assert await (await client.get("/api/light-groups")).json() == []
    assert await (await client.get("/api/light-roles")).json() == {}
    st = client.app[server.STORAGE]
    assert set(st.devices_by_id()) == {"a", "b"}

    # Make it live: everything that plays follows.
    resp = await client.post(f"/api/profiles/{pid}/live")
    assert (await resp.json())["live"] == pid
    assert set(st.devices_by_id()) == {"b", "c"}
    assert (await (await client.get("/api/house")).json())["paths"] == {"c": [[0.5, 0.5]]}
    assert await (await client.get("/api/house/photo")).read() == b"jpeg-plan"
    assert await (await client.get("/api/house/photo?profile=now")).read() == b"jpeg-now"
    assert (await (await client.get("/api/light-roles")).json()) == {"c": "kick"}
    settings = json.loads((st.config_dir / "settings.json").read_text())
    assert settings["house"]["paths"] == {"c": [[0.5, 0.5]]}  # older versions read the live one

    # The live one can't go; Now can, and its own light with it.
    assert (await client.delete(f"/api/profiles/{pid}")).status == 400
    assert (await client.put("/api/profiles/now", json={"name": "Last year"})).status == 200
    assert (await client.delete("/api/profiles/now")).status == 200
    assert [d["id"] for d in st.load_devices()] == ["b", "c"]
    assert st.house_photo("now") is None


async def test_saving_on_a_plan_keeps_the_frames(client):
    st = client.app[server.STORAGE]
    await client.put("/api/shows/s1", json={"name": "S", "tracks": []})
    st.save_baked("s1", b"frames")
    await client.put("/api/shows/s1?keep_bake=1", json={"name": "S2", "tracks": []})
    assert st.load_baked("s1") == b"frames"
    await client.put("/api/shows/s1", json={"name": "S3", "tracks": []})
    assert st.load_baked("s1") is None
