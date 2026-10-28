"""Live music (livemusic.py): reading WLED's sound sync and keeping what each WLED hears."""
import asyncio
import socket
import struct

import pytest

from halidayshow import livemusic, server
from halidayshow.livemusic import LiveMusic, parse


def packet(loud=128.0, peak=0, bands=None, header=b"00002\x00"):
    bands = bands or [0] * 16
    return livemusic.PACKET_V2.pack(header, loud, loud, peak, bytes(bands), 0, 50.0, 440.0)


def test_a_sound_sync_packet_is_read_as_levels():
    lv = parse(packet(255.0, 1, [255] * 4 + [102] * 6 + [0] * 6))
    assert lv["loudness"] == 100 and lv["beat"] is True
    assert (lv["bass"], lv["mid"], lv["treble"]) == (100, 40, 0)
    assert len(lv["bands"]) == 16 and lv["peak_hz"] == 440
    assert livemusic.PACKET_V2.size == 44


def test_other_packets_are_left_out():
    assert parse(b"hello") is None
    assert parse(packet(header=b"00001\x00")) is None
    assert parse(packet()[:40]) is None


def test_the_loudest_wled_is_used_unless_one_is_chosen():
    live = LiveMusic(lambda: {"10.0.0.5": "Garden mic"})
    live.heard(packet(50.0), "10.0.0.5", now=100)
    live.heard(packet(200.0), "10.0.0.6", now=100)
    live.heard(packet(header=b"00001\x00"), "10.0.0.7", now=100)
    assert live.now("any", now=100.5)["source"] == "10.0.0.6"
    assert live.now("10.0.0.5", now=100.5)["loudness"] == 20
    assert live.now("10.0.0.9", now=100.5) is None
    assert [s["ip"] for s in live.sending(now=100.5)] == ["10.0.0.6", "10.0.0.5", "10.0.0.7"]
    assert live.sending(now=100.5)[1]["name"] == "Garden mic" and live.sending(now=100.5)[2]["old"]
    assert live.now("any", now=110) is None and live.sending(now=110) == []  # gone quiet on the network


def test_a_beat_stays_lit_for_a_moment():
    live = LiveMusic()
    live.heard(packet(peak=1), "10.0.0.5", now=100)
    live.heard(packet(peak=0), "10.0.0.5", now=100.05)
    assert live.now(now=100.1)["beat"] is True
    assert live.now(now=100.3)["beat"] is False


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    return await aiohttp_client(app)


async def test_the_settings_card_sees_what_a_wled_sends(client):
    view = await (await client.get("/api/live-music")).json()
    assert view["settings"] == {"source": "any", "from": 15} and view["now"] is None
    if not view["listening"]:
        pytest.skip(f"can't listen here: {view['error']}")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.sendto(packet(200.0, 1), ("127.0.0.1", livemusic.PORT))
    s.close()
    for _ in range(40):
        view = await (await client.get("/api/live-music")).json()
        if view["now"]:
            break
        await asyncio.sleep(0.05)
    assert view["now"]["loudness"] == 78 and view["music"] and view["sending"][0]["ip"] == "127.0.0.1"


async def test_live_music_settings_are_checked(client):
    view = await (await client.put("/api/live-music", json={"source": "192.168.2.60", "from": 30})).json()
    assert view["settings"] == {"source": "192.168.2.60", "from": 30}
    assert (await client.put("/api/live-music", json={"source": "garden"})).status == 400
    assert (await client.put("/api/live-music", json={"from": 300})).status == 400
    view = await (await client.put("/api/live-music", json={"source": "any"})).json()
    assert view["settings"]["source"] == "any"
