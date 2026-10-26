import struct
import zlib

from halidayshow import imagemeta


def _exif(orientation, extra=b""):
    """A big-endian Exif block with Orientation and a pretend GPS entry."""
    entries = [(0x0112, 3, 1, orientation << 16), (0x8825, 4, 1, 0)]  # 0x8825: where the GPS details are
    ifd = struct.pack(">H", len(entries)) + b"".join(struct.pack(">HHII", *e) for e in entries) + b"\0\0\0\0"
    return b"Exif\0\0MM\0*" + struct.pack(">I", 8) + ifd + b"GPS 52.24N 0.89W" + extra


def _segment(marker, body):
    return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body


def _jpeg(*segments):
    picture = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00" + b"\x12\x34\xff\x00\x56" + b"\xff\xd9"
    return b"\xff\xd8" + b"".join(segments) + _segment(0xDB, b"\x00" + bytes(64)) + picture


def test_a_jpeg_loses_its_gps_and_comments_but_keeps_which_way_up():
    jfif, icc = _segment(0xE0, b"JFIF\0\1\1\0\0\1\0\1\0\0"), _segment(0xE2, b"ICC_PROFILE\0colours")
    data = _jpeg(jfif, _segment(0xE1, _exif(6)), _segment(0xE1, b"http://ns.adobe.com/xap/1.0/\0<xmp/>"), icc,
                 _segment(0xFE, b"Taken at 12 Holly Close"))
    out = imagemeta.strip(data, ".jpg")
    assert b"GPS" not in out and b"Holly" not in out and b"xmp" not in out
    assert jfif in out and icc in out and out.endswith(data[data.index(b"\xff\xda"):])  # the picture itself is untouched
    assert imagemeta._orientation(out[out.index(b"Exif"):]) == 6


def test_an_upright_jpeg_needs_no_exif_at_all():
    out = imagemeta.strip(_jpeg(_segment(0xE1, _exif(1))), ".jpg")
    assert b"Exif" not in out and out.startswith(b"\xff\xd8")


def _chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def test_a_png_loses_its_text_and_exif():
    head = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    data = b"\x89PNG\r\n\x1a\n" + head + _chunk(b"tEXt", b"Location\0Holly Close") + _chunk(b"eXIf", _exif(1)[6:]) \
        + _chunk(b"IDAT", zlib.compress(b"\0\0\0\0")) + _chunk(b"IEND", b"")
    out = imagemeta.strip(data, ".png")
    assert b"Holly" not in out and b"eXIf" not in out and head in out and out.endswith(_chunk(b"IEND", b""))


def test_a_webp_loses_its_exif_and_says_so():
    def chunk(kind, body):
        return kind + struct.pack("<I", len(body)) + body + (b"\0" if len(body) % 2 else b"")
    vp8x = chunk(b"VP8X", bytes([0x08 | 0x04]) + bytes(9))
    payload = b"WEBP" + vp8x + chunk(b"VP8L", b"\x2f\0\0\0\0") + chunk(b"EXIF", _exif(1)) + chunk(b"XMP ", b"<x/>")
    out = imagemeta.strip(b"RIFF" + struct.pack("<I", len(payload)) + payload, ".webp")
    assert b"GPS" not in out and b"XMP " not in out
    assert out[20] & 0x0C == 0 and struct.unpack("<I", out[4:8])[0] == len(out) - 8


def test_anything_that_doesnt_parse_comes_back_as_it_was():
    for data, ext in ((b"\xff\xd8\xffphoto", ".jpg"), (b"\x89PNGpic", ".png"), (b"RIFFxx", ".webp"), (b"x", ".gif")):
        assert imagemeta.strip(data, ext) == data
