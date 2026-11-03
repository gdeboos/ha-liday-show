"""The visitors' page's app icon: a string of coloured bulbs on your page's background, drawn as a PNG
with nothing but the standard library (there's no image library to crop your picture with)."""
import math
import struct
import zlib

BULBS = ("#e53935", "#43a047", "#fdd835", "#1e88e5", "#fb8c00")


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _mix(a, b, t: float):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def png(size: int, background: str, wire: str) -> bytes:
    """A square icon, `size` pixels a side. The bulbs sit well inside the middle 80%, so phones that cut
    icons to a circle or a rounded square (maskable icons) keep all of them."""
    bg, line = _rgb(background), _rgb(wire)
    s = size
    # The wire sags across the middle; five bulbs hang from it.
    sag = lambda x: s * 0.33 + s * 0.12 * math.sin(math.pi * (x - s * 0.18) / (s * 0.64))
    xs = [s * (0.22 + 0.14 * k) for k in range(5)]
    r = s * 0.065
    bulbs = [(x, sag(x) + r * 1.9, _rgb(c)) for x, c in zip(xs, BULBS)]
    glow = r * 2.6
    rows = []
    for y in range(s):
        row = bytearray(b"\x00")  # no filter
        for x in range(s):
            px = bg
            # A soft glow round each bulb, then the bulb.
            for bx, by, colour in bulbs:
                d = math.hypot(x + 0.5 - bx, y + 0.5 - by)
                if d < glow:
                    px = _mix(px, colour, 0.35 * (1 - d / glow) ** 2)
            if x > s * 0.14 and x < s * 0.86 and abs(y + 0.5 - sag(x + 0.5)) < max(1.0, s * 0.012):
                px = line
            for bx, by, colour in bulbs:
                # The cap the bulb hangs from.
                if abs(x + 0.5 - bx) < r * 0.45 and by - r * 1.9 <= y + 0.5 <= by - r * 0.8:
                    px = line
                d = math.hypot(x + 0.5 - bx, (y + 0.5 - by) * 0.85)
                if d < r:
                    px = colour
                elif d < r + 1:
                    px = _mix(px, colour, r + 1 - d)
            row += bytes(px)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))
