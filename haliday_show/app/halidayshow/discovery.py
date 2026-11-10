"""Find Govee devices with LAN Control enabled via the multicast scan."""
import asyncio
import json
import logging
import socket

from .protocol import CMD_PORT, GOVEE_MCAST, REPLY_PORT, SCAN_PORT, scan_msg, wrap

log = logging.getLogger(__name__)
_lock = asyncio.Lock()


class _Collector(asyncio.DatagramProtocol):
    def __init__(self, found=None, heard=None):
        self.found = {} if found is None else found
        self.heard = set() if heard is None else heard  # every address a Govee message came from

    def datagram_received(self, data, addr):
        try:
            d = json.loads(data)["msg"]["data"]
        except (ValueError, KeyError, TypeError):
            return
        if isinstance(d, dict):
            self.heard.add(addr[0])
            if d.get("ip"):
                self.found[d.get("device") or d["ip"]] = d


def _reply_socket() -> socket.socket | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):  # the packet lab may be listening there too
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        s.bind(("", REPLY_PORT))
    except OSError as e:
        log.warning("can't listen for Govee replies on port %d: %s", REPLY_PORT, e)
        s.close()
        return None
    s.setblocking(False)
    return s


async def _listening(proto: _Collector):
    """Endpoints that hear replies on Govee's reply port and on the sending socket itself (some lights
    answer the sender rather than the reply port). Returns (transports, the sending transport)."""
    loop = asyncio.get_running_loop()
    out = []
    if (rx := _reply_socket()) is not None:
        out.append((await loop.create_datagram_endpoint(lambda: proto, sock=rx))[0])
    tx, _ = await loop.create_datagram_endpoint(lambda: proto, local_addr=("0.0.0.0", 0))
    out.append(tx)
    return out, tx


async def scan(timeout: float = 3.0) -> list[dict]:
    """Return scan replies: dicts with ip, device, sku, bleVersionHard, ..."""
    return (await scan_heard(timeout))[0]


async def scan_heard(timeout: float = 3.0) -> tuple[list[dict], set[str]]:
    """Scan replies, and every address that answered (whatever IP a reply says)."""
    proto = _Collector()
    async with _lock:
        transports, tx = await _listening(proto)
        try:
            tx.get_extra_info("socket").setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            # Send twice: UDP multicast on busy Wi-Fi drops the odd packet.
            for _ in range(2):
                tx.sendto(scan_msg(), (GOVEE_MCAST, SCAN_PORT))
                await asyncio.sleep(timeout / 2)
        except OSError as e:
            log.warning("scan failed: %s", e)
        finally:
            for t in transports:
                t.close()
    return sorted(proto.found.values(), key=lambda d: socket.inet_aton(d["ip"])), proto.heard


async def ask(ips: list[str], timeout: float = 2.0) -> set[str]:
    """Ask lights one by one whether they're there, straight to each address (multicast isn't passed on
    by every router): a scan message to each, and a status request. Returns the addresses that answered."""
    if not ips:
        return set()
    proto = _Collector()
    async with _lock:
        transports, tx = await _listening(proto)
        try:
            for _ in range(2):
                for ip in ips:
                    if ip not in proto.heard:
                        tx.sendto(scan_msg(), (ip, SCAN_PORT))
                        tx.sendto(wrap("devStatus", {}), (ip, CMD_PORT))
                await asyncio.sleep(timeout / 2)
                if set(ips) <= proto.heard:
                    break
        except OSError as e:
            log.warning("asking lights failed: %s", e)
        finally:
            for t in transports:
                t.close()
    return proto.heard & set(ips)
