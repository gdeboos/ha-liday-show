"""Govee LAN protocol: JSON over UDP, plus the undocumented "razer" realtime mode.

The official LAN API (scan/turn/brightness/colorwc) only sets whole-device colour
and fades every change. The razer command, used by Razer Chroma and Govee Desktop,
gives per-segment realtime control and is what the player streams.

Razer packet: BB <len hi> <len lo> <cmd> <data...> <xor checksum of all preceding bytes>
  0xB1 enable  data = 01 (on) / 00 (off)
  0xB0 colours data = <gradient off flag> <segment count> <r g b ...>
       The flag is 1 for crisp segments (what OpenRGB and SignalRGB send) and 0 to let
       the device blend between segments.

Each device picks a protocol:
  standard  Realtime: B0 with its true length (as OpenRGB sends)
  whole     Whole light: no realtime mode, the official colorwc command with the average colour

Earlier versions also had razer, v2, segments (App segments) and pixels (Per bulb); lights saved
with those are switched to standard on start-up (migrate.retire_govee_protocols). What was learned
about them is in docs/govee-protocols.md.
"""
import base64
import json
import struct

GOVEE_MCAST = "239.255.255.250"
SCAN_PORT, REPLY_PORT, CMD_PORT = 4001, 4002, 4003

CMD_COLORS = 0xB0
CMD_ENABLE = 0xB1

PROTOCOLS = ("standard", "whole")
RETIRED_PROTOCOLS = ("razer", "v2", "segments", "pixels")
# Protocols that don't pack the segment count into one byte, so a light can have more segments.
LONG_PROTOCOLS = ("whole",)


def frame(cmd: int, data: bytes) -> bytes:
    body = bytes([0xBB]) + struct.pack(">H", len(data)) + bytes([cmd]) + data
    cs = 0
    for b in body:
        cs ^= b
    return body + bytes([cs])


def razer_enable(on: bool = True) -> bytes:
    return frame(CMD_ENABLE, bytes([1 if on else 0]))  # on = BB 00 01 B1 01 0A


def razer_colors(rgb: bytes, gradient: bool = False) -> bytes:
    n = min(len(rgb) // 3, 255)  # the count is one byte
    flag = 0 if gradient else 1
    return frame(CMD_COLORS, bytes([flag, n]) + bytes(rgb[: n * 3]))


def wrap(cmd: str, data: dict) -> bytes:
    return json.dumps({"msg": {"cmd": cmd, "data": data}}, separators=(",", ":")).encode()


def razer_msg(pkt: bytes) -> bytes:
    return wrap("razer", {"pt": base64.b64encode(pkt).decode()})


def colorwc_msg(r: int, g: int, b: int) -> bytes:
    return wrap("colorwc", {"color": {"r": r, "g": g, "b": b}, "colorTemInKelvin": 0})


def average(rgb: bytes) -> tuple[int, int, int]:
    n = len(rgb) // 3
    if not n:
        return 0, 0, 0
    return tuple(sum(rgb[c::3][:n]) // n for c in range(3))


def scan_msg() -> bytes:
    return wrap("scan", {"account_topic": "reserve"})


# The packet lab can send the 20-byte packets the Govee app sends over Bluetooth, wrapped in the
# unofficial "ptReal" command (docs/govee-protocols.md): up to 19 bytes padded with zeros, then their XOR.
def _ble_packet(data: bytes) -> bytes:
    cs = 0
    for b in data:
        cs ^= b
    return bytes(data).ljust(19, b"\0") + bytes([cs])


def ptreal_msg(packets: list[bytes]) -> bytes:
    return wrap("ptReal", {"command": [base64.b64encode(p).decode() for p in packets]})
