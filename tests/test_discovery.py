import asyncio
import json
import socket

import pytest

from halidayshow import discovery
from halidayshow.protocol import CMD_PORT, REPLY_PORT


class FakeLight(asyncio.DatagramProtocol):
    """A Govee light on this machine answering a status request, at the sender or at the reply port."""
    def __init__(self, to_sender):
        self.to_sender = to_sender

    def connection_made(self, transport):
        self.t = transport

    def datagram_received(self, data, addr):
        if json.loads(data)["msg"]["cmd"] == "devStatus":
            reply = json.dumps({"msg": {"cmd": "devStatus", "data": {"onOff": 1}}}).encode()
            self.t.sendto(reply, addr if self.to_sender else ("127.0.0.1", REPLY_PORT))


@pytest.mark.parametrize("to_sender", [True, False])
async def test_a_light_is_asked_straight_at_its_address(to_sender):
    loop = asyncio.get_running_loop()
    try:
        t, _ = await loop.create_datagram_endpoint(lambda: FakeLight(to_sender), local_addr=("127.0.0.1", CMD_PORT))
    except OSError:
        pytest.skip("Govee's command port is in use here")
    try:
        assert await discovery.ask(["127.0.0.1"], timeout=1.0) == {"127.0.0.1"}
    finally:
        t.close()


async def test_a_light_that_says_nothing_isnt_heard():
    assert await discovery.ask(["127.0.0.2"], timeout=0.4) == set()
    assert await discovery.ask([]) == set()
