"""Hidden details taken out of a photo before strangers see it.

Phone photos carry the exact spot they were taken (GPS), the phone, the time and more. The public page
shows your house photo or your own picture to anyone with the code, so it gets a copy without them.
Only which way up the photo goes is kept, so a phone photo isn't shown on its side. The picture
itself is copied byte for byte. clean() gives None for anything it can't read, so the public page
leaves it out rather than show it with its details.

Many phones put more after a JPEG's picture: a second picture for HDR screens, or a short video, each
with its own details. Only the first picture is kept. Which way up is kept for JPEGs only; PNG and
WebP photos from phones are rare, and their browsers mostly ignore it anyway.
"""
import struct

_JPEG_DROP = {0xE1, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEF, 0xFE}
# Kept: APP0 (JFIF), APP2 (the colour profile), APP14 (Adobe: how the colours are stored).
_PNG_DROP = {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"}
_WEBP_DROP = {b"EXIF", b"XMP "}


def clean(data: bytes, ext: str) -> bytes | None:
    """The photo without its hidden details, or None if it can't be read well enough to be sure."""
    try:
        if ext == ".jpg":
            return _jpeg(data)
        if ext == ".png":
            return _png(data)
        if ext == ".webp":
            return _webp(data)
    except (ValueError, IndexError, struct.error):
        pass
    return None


def strip(data: bytes, ext: str) -> bytes:
    """As clean(), but anything that can't be read comes back as it was."""
    out = clean(data, ext)
    return data if out is None else out


def _orientation(exif: bytes) -> int:
    """The Orientation tag (1 to 8) from a JPEG's Exif block, or 1."""
    if not exif.startswith(b"Exif\0\0"):
        return 1
    t = exif[6:]
    end = {b"II": "<", b"MM": ">"}.get(t[:2])
    if end is None:
        return 1
    ifd = struct.unpack(end + "I", t[4:8])[0]
    for k in range(struct.unpack(end + "H", t[ifd:ifd + 2])[0]):
        tag, kind, _count = struct.unpack(end + "HHI", t[ifd + 2 + 12 * k:ifd + 10 + 12 * k])
        if tag == 0x0112 and kind == 3:
            value = struct.unpack(end + "H", t[ifd + 10 + 12 * k:ifd + 12 + 12 * k])[0]
            return value if 1 <= value <= 8 else 1
    return 1


def _orientation_only(value: int) -> bytes:
    """An Exif block holding nothing but which way up the photo goes."""
    tiff = b"MM\0*" + struct.pack(">I", 8) + struct.pack(">H", 1) + struct.pack(">HHIHH", 0x0112, 3, 1, value, 0) \
        + struct.pack(">I", 0)
    body = b"Exif\0\0" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(body) + 2) + body


def _jpeg(data: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    out, i, turn = [b"\xff\xd8"], 2, 1
    while True:
        if data[i] != 0xFF:
            raise ValueError("lost in the JPEG")
        marker = data[i + 1]
        if marker == 0xFF:  # padding
            i += 1
            continue
        if marker == 0xDA:  # start of the picture itself: copied as it is, up to its end
            if turn != 1:
                out.insert(1, _orientation_only(turn))
            out.append(data[i:_jpeg_end(data, i)])
            return b"".join(out)
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out.append(data[i:i + 2])
            i += 2
            continue
        size = struct.unpack(">H", data[i + 2:i + 4])[0]
        segment = data[i:i + 2 + size]
        if len(segment) != 2 + size:
            raise ValueError("cut short")
        if marker == 0xE1:
            turn = _orientation(segment[4:]) if turn == 1 else turn
        # APP2 is kept for the colour profile, but not the index of the extra pictures dropped below.
        if marker not in _JPEG_DROP and not (marker == 0xE2 and segment[4:8] == b"MPF\0"):
            out.append(segment)
        i += 2 + size


def _jpeg_end(data: bytes, i: int) -> int:
    """Where the first picture ends (just after its end marker), starting at its first scan."""
    n = len(data)
    while i < n - 1:
        if data[i] != 0xFF:
            i = data.find(b"\xff", i)  # the picture's own bytes: jump to the next marker
            if i < 0:
                break
            continue
        marker = data[i + 1]
        if marker == 0xD9:
            return i + 2
        if marker in (0x00, 0xFF) or 0xD0 <= marker <= 0xD7:  # a stuffed byte, padding, or a restart
            i += 1 if marker == 0xFF else 2
            continue
        # Another segment between scans (a progressive JPEG's tables and scans): skip its header.
        size = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + size
    raise ValueError("no end to the picture")


def _png(data: bytes) -> bytes:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    out, i = [data[:8]], 8
    while i < len(data):
        size = struct.unpack(">I", data[i:i + 4])[0]
        kind = data[i + 4:i + 8]
        chunk = data[i:i + 12 + size]
        if len(chunk) != 12 + size:
            raise ValueError("cut short")
        if kind not in _PNG_DROP:
            out.append(chunk)
        i += 12 + size
        if kind == b"IEND":
            break
    return b"".join(out)


def _webp(data: bytes) -> bytes:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("not a WebP")
    chunks, i = [], 12
    while i + 8 <= len(data):
        kind, size = data[i:i + 4], struct.unpack("<I", data[i + 4:i + 8])[0]
        body = data[i + 8:i + 8 + size]
        if len(body) != size:
            raise ValueError("cut short")
        if kind == b"VP8X":
            body = bytes([body[0] & ~0x0C]) + body[1:]  # no Exif (0x08) or XMP (0x04) any more
        if kind not in _WEBP_DROP:
            chunks.append(kind + struct.pack("<I", size) + body + (b"\0" if size % 2 else b""))
        i += 8 + size + size % 2
    payload = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(payload)) + payload
