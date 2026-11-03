"""Small copies of songs for visitors listening on their phones (the public page's Listen button).

Songs made in the Music editor are WAVs of 30 MB or so, too slow over mobile data, so each song is
turned into AAC (about 4 MB for 3 minutes) with ffmpeg, which is in the app's image. Copies are kept
in a temporary folder rather than the config folder, so they never go into backups; they're made again
after a restart, when first wanted. Without ffmpeg (a pipx install without it), the song file itself
is sent.
"""
import asyncio
import hashlib
import logging
import os
import shutil
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

KEEP = 30  # copies kept at once; the oldest go first
MAKE_TIMEOUT_S = 180
TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
         ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
         ".webm": "audio/webm"}


def converter() -> str | None:
    return shutil.which("ffmpeg")


def key_of(path: Path) -> str:
    """Changes when the song file does (saved over in the Music editor, say), so phones load it again."""
    st = path.stat()
    return hashlib.sha1(f"{path}:{st.st_size}:{st.st_mtime_ns}".encode()).hexdigest()[:20]


class SongCopies:
    def __init__(self, folder: Path | None = None):
        self.folder = folder or Path(tempfile.gettempdir()) / "haliday-show-listen"
        self.making: dict[str, asyncio.Task] = {}
        self.failed: set[str] = set()
        self._one = asyncio.Lock()  # one at a time, so a Raspberry Pi isn't swamped

    def path_for(self, key: str) -> Path:
        return self.folder / f"{key}.m4a"

    def ready(self, song: Path) -> tuple[Path, str] | None:
        """The file to send for this song and its type, or None while the copy is being made."""
        if not converter():
            return song, TYPES.get(song.suffix.lower(), "application/octet-stream")
        key = key_of(song)
        if key in self.failed:  # ffmpeg couldn't read it: the song itself is better than nothing
            return song, TYPES.get(song.suffix.lower(), "application/octet-stream")
        p = self.path_for(key)
        return (p, "audio/mp4") if p.is_file() else None

    def want(self, song: Path):
        """Start making the copy if it isn't there or on its way."""
        if not converter():
            return
        try:
            key = key_of(song)
        except OSError:
            return
        if key in self.failed or key in self.making or self.path_for(key).is_file():
            return
        self.making[key] = asyncio.get_running_loop().create_task(self._make(song, key))

    async def _make(self, song: Path, key: str):
        try:
            async with self._one:
                self.folder.mkdir(parents=True, exist_ok=True)
                out = self.path_for(key)
                part = out.with_suffix(".part.m4a")
                proc = await asyncio.create_subprocess_exec(
                    converter(), "-nostdin", "-v", "error", "-y", "-i", str(song), "-vn", "-map", "0:a:0",
                    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart",
                    str(part), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
                try:
                    _, err = await asyncio.wait_for(proc.communicate(), MAKE_TIMEOUT_S)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                    err, proc.returncode = b"took too long", -1
                if proc.returncode != 0 or not part.is_file():
                    log.warning("listening: couldn't make a copy of %s for phones: %s", song.name,
                                (err or b"").decode(errors="replace").strip()[:200])
                    self.failed.add(key)
                    part.unlink(missing_ok=True)
                    return
                os.replace(part, out)
                self._tidy()
        finally:
            self.making.pop(key, None)

    def _tidy(self):
        files = sorted(self.folder.glob("*.m4a"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[KEEP:]:
            p.unlink(missing_ok=True)
