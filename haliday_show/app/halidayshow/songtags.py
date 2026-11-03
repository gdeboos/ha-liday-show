"""A song file's cover art, read straight from the file.

Songs are kept byte for byte as they were added, so their tags (cover art among them) are still in
them; this finds the picture. MP3 (ID3v2 APIC), M4A (the covr atom), FLAC (a PICTURE block) and WAV
(an "id3 " chunk, which is how HA-liday Show's own WAVs from the Music editor keep the cover of the
song they were made from) are read. Ogg and Opus aren't. cover() gives (mime type, bytes) or None,
never an error, so a song without a picture, or one that can't be read, just has none.
"""
import struct
from pathlib import Path

MAX_PICTURE = 10 * 1024 * 1024
_MIMES = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png", b"GIF8": "image/gif", b"RIFF": "image/webp"}


def _mime_of(data: bytes, said: str = "") -> str | None:
    for magic, mime in _MIMES.items():
        if data.startswith(magic):
            return mime
    return said if said in ("image/jpeg", "image/png", "image/gif", "image/webp") else None


def _picture(data: bytes, said: str = ""):
    mime = _mime_of(data, said)
    return (mime, data) if mime and 0 < len(data) <= MAX_PICTURE else None


_CACHE: dict = {}  # path -> (mtime, size, cover): Library → Songs asks for every song each time


def cached_cover(path: Path):
    """cover(), remembered until the file changes."""
    try:
        st = path.stat()
    except OSError:
        return None
    known = _CACHE.get(str(path))
    if known and known[:2] == (st.st_mtime_ns, st.st_size):
        return known[2]
    found = cover(path)
    if len(_CACHE) > 512:
        _CACHE.clear()
    _CACHE[str(path)] = (st.st_mtime_ns, st.st_size, found)
    return found


def cover(path: Path):
    try:
        with path.open("rb") as f:
            head = f.read(12)
            f.seek(0)
            if head.startswith(b"ID3"):
                return _id3(f.read(10 + _syncsafe(head[6:10])))
            if head.startswith(b"fLaC"):
                return _flac(f)
            if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
                return _wav(f)
            if head[4:8] == b"ftyp":
                return _mp4(f, path.stat().st_size)
    except (OSError, ValueError, IndexError, struct.error):
        return None
    return None


def _syncsafe(b: bytes) -> int:
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _id3(tag: bytes):
    if len(tag) < 10 or not tag.startswith(b"ID3"):
        return None
    major, flags = tag[3], tag[5]
    body = tag[10:10 + _syncsafe(tag[6:10])]
    if flags & 0x80 and major < 4:
        body = body.replace(b"\xff\x00", b"\xff")  # the whole tag was "unsynchronised"
    pos = 0
    if flags & 0x40 and major >= 3:  # an extended header to skip
        pos = (_syncsafe(body[:4]) if major == 4 else struct.unpack(">I", body[:4])[0] + 4)
    found = None
    idlen, hdr = (3, 6) if major == 2 else (4, 10)
    while pos + hdr <= len(body):
        fid = body[pos:pos + idlen]
        if not fid.strip(b"\0"):
            break
        if major == 2:
            size = int.from_bytes(body[pos + 3:pos + 6], "big")
        elif major == 4:
            size = _syncsafe(body[pos + 4:pos + 8])
        else:
            size = struct.unpack(">I", body[pos + 4:pos + 8])[0]
        frame = body[pos + hdr:pos + hdr + size]
        if major == 4 and len(frame) and body[pos + 9] & 0x02:
            frame = frame.replace(b"\xff\x00", b"\xff")
        if fid in (b"APIC", b"PIC"):
            pic = _apic(frame, major)
            if pic and (pic[0] == 3 or found is None):  # the front cover wins
                found = pic
                if pic[0] == 3:
                    break
        pos += hdr + size
    return _picture(found[2], found[1]) if found else None


def _apic(frame: bytes, major: int):
    """(picture type, mime, data) from an APIC (or v2.2 PIC) frame."""
    enc = frame[0]
    if major == 2:
        mime, i = {b"JPG": "image/jpeg", b"PNG": "image/png"}.get(frame[1:4], ""), 4
    else:
        end = frame.index(b"\0", 1)
        mime, i = frame[1:end].decode("latin-1").lower(), end + 1
    kind = frame[i]
    i += 1
    # The description ends in one zero byte, or two (on an even boundary) in UTF-16.
    if enc in (1, 2):
        while i + 1 < len(frame) and frame[i:i + 2] != b"\0\0":
            i += 2
        i += 2
    else:
        i = frame.index(b"\0", i) + 1
    return kind, ("image/jpeg" if mime == "image/jpg" else mime), frame[i:]


def _flac(f):
    f.seek(4)
    while True:
        h = f.read(4)
        if len(h) < 4:
            return None
        last, kind, size = h[0] & 0x80, h[0] & 0x7F, int.from_bytes(h[1:4], "big")
        if kind == 6 and size <= MAX_PICTURE + 4096:
            b = f.read(size)
            mlen = struct.unpack(">I", b[4:8])[0]
            mime = b[8:8 + mlen].decode("latin-1").lower()
            i = 8 + mlen
            dlen = struct.unpack(">I", b[i:i + 4])[0]
            i += 4 + dlen + 16
            n = struct.unpack(">I", b[i:i + 4])[0]
            return _picture(b[i + 4:i + 4 + n], mime)
        f.seek(size, 1)
        if last:
            return None


def _wav(f):
    f.seek(12)
    while True:
        h = f.read(8)
        if len(h) < 8:
            return None
        cid, size = h[:4], struct.unpack("<I", h[4:])[0]
        if cid in (b"id3 ", b"ID3 ") and size <= MAX_PICTURE + 65536:
            return _id3(f.read(size))
        f.seek(size + (size & 1), 1)


def _mp4(f, total: int):
    """Down moov > udta > meta > ilst > covr > data."""
    def atoms(start, end):
        pos = start
        while pos + 8 <= end:
            f.seek(pos)
            h = f.read(8)
            size, kind = struct.unpack(">I", h[:4])[0], h[4:]
            head = 8
            if size == 1:
                size, head = struct.unpack(">Q", f.read(8))[0], 16
            elif size == 0:
                size = end - pos
            if size < head:
                return
            yield kind, pos + head, pos + size
            pos += size

    def find(path, start, end):
        for kind, a, b in atoms(start, end):
            if kind == path[0]:
                if len(path) == 1:
                    return a, b
                # meta is a "full" atom: four bytes of version and flags before its children.
                return find(path[1:], a + 4 if kind == b"meta" else a, b)
        return None

    found = find([b"moov", b"udta", b"meta", b"ilst", b"covr", b"data"], 0, total)
    if not found:
        return None
    a, b = found
    if b - a - 8 > MAX_PICTURE:
        return None
    f.seek(a)
    data = f.read(b - a)
    kind = struct.unpack(">I", data[:4])[0] & 0xFFFFFF
    return _picture(data[8:], {13: "image/jpeg", 14: "image/png"}.get(kind, ""))


def id3_chunk(mime: str, data: bytes) -> bytes:
    """A WAV "id3 " chunk holding just a front cover (ID3v2.3 APIC), for a WAV made from a song."""
    frame = b"\0" + mime.encode("latin-1") + b"\0" + b"\x03" + b"\0" + data
    body = b"APIC" + struct.pack(">I", len(frame)) + b"\0\0" + frame
    n = len(body)
    tag = b"ID3\x03\x00\x00" + bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F]) + body
    chunk = b"id3 " + struct.pack("<I", len(tag)) + tag
    return chunk + (b"\0" if len(tag) & 1 else b"")


def add_cover(wav: Path, pic) -> bool:
    """Puts a cover (mime, data) at the end of a WAV, as an "id3 " chunk, and fixes its size."""
    if not pic:
        return False
    with wav.open("r+b") as f:
        if f.read(4) != b"RIFF":
            return False
        f.seek(8)
        if f.read(4) != b"WAVE":
            return False
        f.seek(0, 2)
        f.write(id3_chunk(*pic))
        size = f.tell()
        f.seek(4)
        f.write(struct.pack("<I", size - 8))
    return True
