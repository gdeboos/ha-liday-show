import struct

from halidayshow import songtags

JPEG = b"\xff\xd8\xff\xe0" + b"picture" * 10
PNG = b"\x89PNG\r\n\x1a\n" + b"png" * 10


def _id3(major, frames: bytes, flags=0):
    n = len(frames)
    size = bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])
    return b"ID3" + bytes([major, 0, flags]) + size + frames


def _apic(major, kind, data, mime=b"image/jpeg", enc=0, desc=b"cover"):
    end = b"\0\0" if enc in (1, 2) else b"\0"
    body = bytes([enc]) + mime + b"\0" + bytes([kind]) + desc + end + data
    n = len(body)
    size = struct.pack(">I", n) if major == 3 else bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])
    return b"APIC" + size + b"\0\0" + body


def _write(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_mp3_covers_prefer_the_front(tmp_path):
    tag = _id3(3, _apic(3, 0, PNG, b"image/png") + _apic(3, 3, JPEG))
    assert songtags.cover(_write(tmp_path, "a.mp3", tag + b"\xff\xfb" * 100)) == ("image/jpeg", JPEG)
    tag4 = _id3(4, _apic(4, 3, PNG, b"image/png", enc=1, desc="Cover".encode("utf-16-le")))
    assert songtags.cover(_write(tmp_path, "b.mp3", tag4)) == ("image/png", PNG)
    assert songtags.cover(_write(tmp_path, "c.mp3", _id3(3, b"TIT2\0\0\0\x03\0\0\0ab"))) is None
    assert songtags.cover(_write(tmp_path, "d.mp3", b"\xff\xfb" * 100)) is None


def test_flac_picture_block(tmp_path):
    mime = b"image/png"
    pic = struct.pack(">II", 3, len(mime)) + mime + struct.pack(">I", 0) + b"\0" * 16 + struct.pack(">I", len(PNG)) + PNG
    info = bytes([0]) + (34).to_bytes(3, "big") + b"\0" * 34
    block = bytes([0x80 | 6]) + len(pic).to_bytes(3, "big") + pic
    assert songtags.cover(_write(tmp_path, "a.flac", b"fLaC" + info + block)) == ("image/png", PNG)


def test_m4a_covr_atom(tmp_path):
    def atom(kind, body):
        return struct.pack(">I", 8 + len(body)) + kind + body
    data = atom(b"data", struct.pack(">II", 13, 0) + JPEG)
    moov = atom(b"moov", atom(b"udta", atom(b"meta", b"\0\0\0\0" + atom(b"ilst", atom(b"covr", data)))))
    f = atom(b"ftyp", b"M4A \0\0\0\0") + atom(b"mdat", b"\0" * 50) + moov
    assert songtags.cover(_write(tmp_path, "a.m4a", f)) == ("image/jpeg", JPEG)


def test_a_wav_carries_a_cover_it_was_given(tmp_path):
    wav = b"RIFF" + struct.pack("<I", 36 + 4) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + b"\1\0\1\0" \
        + struct.pack("<II", 8000, 16000) + b"\2\0\x10\0" + b"data" + struct.pack("<I", 4) + b"\0\0\0\0"
    p = _write(tmp_path, "edit.wav", wav)
    assert songtags.cover(p) is None
    assert songtags.add_cover(p, ("image/jpeg", JPEG))
    assert songtags.cover(p) == ("image/jpeg", JPEG)
    assert struct.unpack("<I", p.read_bytes()[4:8])[0] == p.stat().st_size - 8
