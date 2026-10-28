"""Live music: what a WLED with a microphone hears, from WLED's AudioReactive sound sync.

A WLED with a microphone and its AudioReactive usermod set to send ("Sync" mode Send) multicasts
what it hears about 50 times a second to 239.0.0.1, UDP port 11988. Version 2 of that packet is
44 bytes, little-endian (WLED 0.14 and later, audio_reactive.h `audioSyncPacket`):

  0  char[6]   "00002\\0"
  6  u8[2]     reserved
  8  f32       sampleRaw       loudness now
  12 f32       sampleSmth      loudness, smoothed (0-255 or so)
  16 u8        samplePeak      non-zero on a beat
  17 u8        reserved / frame counter
  18 u8[16]    fftResult       16 frequency bands, low to high, 0-255
  34 u16       reserved
  36 f32       FFT_Magnitude
  40 f32       FFT_MajorPeak   the loudest frequency, Hz

Only that version is read; older WLEDs (the "00001" packet) are listed as heard but too old.
Nothing is sent. Scenes with React to music read `now()` (a later release); the Live music card in
Setup → Settings shows it. See docs/wled.md, "Live music".
"""
import asyncio
import logging
import socket
import struct
import time

log = logging.getLogger(__name__)

GROUP = "239.0.0.1"
PORT = 11988
PACKET_V2 = struct.Struct("<6s2xffBx16sHff")
HEADER_V2 = b"00002"
HEADER_V1 = b"00001"
GONE_S = 5.0  # a WLED not heard for this long is no longer listed as sending
BEAT_HOLD_S = 0.3  # longer than the Settings card's 250 ms poll, so it never misses a beat


def parse(data: bytes) -> dict | None:
    """One sound sync packet as levels from 0 to 100, or None if it isn't one we can read."""
    if len(data) < PACKET_V2.size or not data.startswith(HEADER_V2):
        return None
    _, raw, smooth, peak, fft, _, magnitude, major = PACKET_V2.unpack_from(data)
    bands = list(fft)
    pct = lambda v: max(0, min(100, round(v * 100 / 255)))  # noqa: E731
    mean = lambda xs: sum(xs) / len(xs)  # noqa: E731
    return {"loudness": pct(smooth), "beat": peak > 0, "bands": [pct(b) for b in bands],
            "bass": pct(mean(bands[0:4])), "mid": pct(mean(bands[4:10])), "treble": pct(mean(bands[10:16])),
            "peak_hz": round(major) if major == major else 0}  # NaN-safe


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self, owner: "LiveMusic"):
        self.owner = owner

    def datagram_received(self, data, addr):
        self.owner.heard(data, addr[0])


class LiveMusic:
    """Listens for sound sync from every WLED on the network and keeps what each last heard."""

    def __init__(self, names=lambda: {}):
        self.names = names  # ip -> the light's name in Setup → Devices, for the list
        self.transport = None
        self.error: str | None = None
        self.senders: dict[str, dict] = {}  # ip -> {"at", "levels", "old"}
        self._beat_at: dict[str, float] = {}

    @property
    def listening(self) -> bool:
        return self.transport is not None

    async def start(self):
        loop = asyncio.get_running_loop()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):  # another listener on the machine may have it too
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except OSError:
                    pass
            sock.bind(("", PORT))
            try:
                mreq = struct.pack("4s4s", socket.inet_aton(GROUP), socket.inet_aton("0.0.0.0"))
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except OSError as e:  # no multicast route: unicast sync still arrives
                log.info("live music: couldn't join %s (%s); listening for direct packets only", GROUP, e)
            sock.setblocking(False)
            self.transport, _ = await loop.create_datagram_endpoint(lambda: _Protocol(self), sock=sock)
            self.error = None
            log.info("live music: listening for WLED sound sync on UDP %s", PORT)
        except OSError as e:
            self.error = f"couldn't listen on UDP port {PORT}: {e.strerror or e}"
            log.warning("live music: %s", self.error)

    def close(self):
        if self.transport:
            self.transport.close()
            self.transport = None

    def heard(self, data: bytes, ip: str, now: float | None = None):
        now = time.monotonic() if now is None else now
        levels = parse(data)
        if levels is None:
            if data.startswith(HEADER_V1):
                self.senders[ip] = {"at": now, "levels": None, "old": True}
            return
        if levels["beat"]:
            self._beat_at[ip] = now
        self.senders[ip] = {"at": now, "levels": levels, "old": False}

    def sending(self, now: float | None = None) -> list[dict]:
        """WLEDs heard lately, loudest first: [{ip, name, old}]."""
        now = time.monotonic() if now is None else now
        names = self.names()
        live = [(ip, s) for ip, s in self.senders.items() if now - s["at"] < GONE_S]
        live.sort(key=lambda x: -(x[1]["levels"] or {}).get("loudness", -1))
        return [{"ip": ip, "name": names.get(ip) or ip, "old": s["old"]} for ip, s in live]

    def now(self, source: str = "any", now: float | None = None) -> dict | None:
        """What the chosen WLED (or, with "any", the loudest one sending) hears now, or None."""
        now = time.monotonic() if now is None else now
        live = {ip: s for ip, s in self.senders.items() if now - s["at"] < GONE_S and s["levels"]}
        if source != "any":
            live = {ip: s for ip, s in live.items() if ip == source}
        if not live:
            return None
        ip, s = max(live.items(), key=lambda x: x[1]["levels"]["loudness"])
        beat = now - self._beat_at.get(ip, -1e9) < BEAT_HOLD_S
        return {**s["levels"], "beat": beat, "source": ip}
