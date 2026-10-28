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
