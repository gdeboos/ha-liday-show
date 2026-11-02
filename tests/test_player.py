import time

from halidayshow import player


class FakeOutput:
    devices = {}


class Running:
    def done(self):
        return False


def playing_player(position):
    p = player.Player(FakeOutput())
    p.start = time.monotonic() - position
    p._task = Running()
    return p


def test_small_drift_is_eased_not_jumped():
    p = playing_player(10.0)
    before = p.position()
    p.sync(before - 0.1)  # browser 100 ms behind, as network jitter can make it look
    assert before - 0.1 < p.position() < before - 0.01  # moved part of the way, no jump


def test_tiny_drift_is_ignored_and_a_seek_jumps():
    p = playing_player(10.0)
    start = p.start
    p.sync(p.position() - 0.01)
    assert p.start == start
    p.sync(30.0)
    assert abs(p.position() - 30.0) < 0.01


class ClaimingOutput:
    def __init__(self):
        self.devices, self.claims = {}, []

    def claim(self, ip, segments, **kw):
        self.claims.append((ip, segments))

    def release(self, ip):
        pass

    def release_all(self):
        pass


async def test_a_bake_longer_than_the_light_is_played_at_the_lights_length():
    # Baked when Pillars was on Per bulb with 300 segments; it's 44 now, on Realtime.
    from halidayshow import baked
    b = baked.decode(baked.encode(10, [{"device": "p", "segments": 300}, {"device": "w", "segments": 10}],
                                  [bytes(930)]))
    out = ClaimingOutput()
    p = player.Player(out)
    await p.play("x", b, {"p": {"ip": "10.0.0.2", "segments": 44}, "w": {"ip": "10.0.0.3", "segments": 60}})
    await p.stop()
    assert out.claims == [("10.0.0.2", 44), ("10.0.0.3", 10)]


def test_a_prop_packed_away_mid_show_is_let_go_and_sent_nothing_more():
    released = []

    class Output:
        devices = {}

        def release(self, ip):
            released.append(ip)

    p = player.Player(Output())
    p._task = Running()
    p.devices = {"tree": {"id": "tree", "ip": "192.168.1.10"}, "ghost": {"id": "ghost", "ip": "192.168.1.11"}}
    p.drop({"ghost", "nothing-here"})
    assert set(p.devices) == {"tree"}
    assert released == ["192.168.1.11"]



def test_a_light_sharing_an_address_keeps_it_and_nothing_is_let_go_when_stopped():
    released = []

    class Output:
        devices = {}

        def release(self, ip):
            released.append(ip)

    p = player.Player(Output())
    p._task = Running()
    p.devices = {"a": {"id": "a", "ip": "10.0.0.5"}, "b": {"id": "b", "ip": "10.0.0.5"}}
    p.drop({"a"})
    assert set(p.devices) == {"b"} and released == []  # b still uses that address
    p.drop({"b"})
    assert released == ["10.0.0.5"]
    stopped = player.Player(Output())
    stopped.devices = {"c": {"id": "c", "ip": "10.0.0.9"}}
    stopped.drop({"c"})
    assert released == ["10.0.0.5"]  # nothing playing: nothing to let go


class Light:
    def __init__(self):
        self.sent = []

    def update(self, frame):
        self.sent.append(frame)


class LightOutput(ClaimingOutput):
    def __init__(self):
        super().__init__()
        self.light = Light()

    def claim(self, ip, segments, **kw):
        self.devices[ip] = self.light


async def test_a_reacting_scene_is_dimmed_flashed_and_swapped_but_only_from_baked_frames():
    import asyncio
    from halidayshow import baked, react
    tracks = [{"device": "w", "segments": 1}]
    plain = baked.decode(baked.encode(20, tracks, [bytes([100, 0, 0])]))  # a still red, one frame
    bass = baked.decode(baked.encode(20, tracks, [bytes([0, 0, 200])]))
    out = LightOutput()
    p = player.Player(out)
    await p.play(None, plain, {"w": {"ip": "10.0.0.3", "segments": 1}}, length=float("inf"))
    p.set_level(50)
    looks = iter([react.Out("plain", 100, 0.0)] * 3 + [react.Out("plain", 50, 0.0)] * 3
                 + [react.Out("plain", 100, 0.5)] * 3 + [react.Out("bass", 100, 0.0)] * 50)
    p.react, p.variants = lambda: next(looks), {"bass": bass}
    await asyncio.sleep(0.35)  # a still loop still gets sent every frame while reacting
    await p.stop()
    sent = set(out.light.sent)
    assert bytes([50, 0, 0]) in sent  # the scenes' brightness
    assert bytes([25, 0, 0]) in sent  # and quieter music on top
    assert bytes([152, 128, 128]) in sent  # half way to white on a beat: 50 + 205*0.5, 0 + 255*0.5
    assert bytes([0, 0, 100]) in sent  # the strong bass scene's frame
    assert len(out.light.sent) >= 5


async def test_a_new_show_stops_reacting():
    from halidayshow import baked
    b = baked.decode(baked.encode(20, [{"device": "w", "segments": 1}], [bytes(3)]))
    p = player.Player(LightOutput())
    p.react, p.variants = (lambda: None), {"bass": b}
    await p.play("x", b, {"w": {"ip": "10.0.0.3", "segments": 1}})
    await p.stop()
    assert p.react is None and p.variants == {}
