"""Export a show as a video (static/js/video.js): the editor draws the show on the house photo and
encodes the frames itself (H.264, or VP9 in IVF where a browser can't do H.264), sending them here in
pieces. ffmpeg, which is in the app's image, adds the song and makes an MP4: H.264 frames are copied
as they are, VP9 ones turned into H.264.

Nothing is kept: each export lives in the temporary folder (never in backups) and goes once it's been
downloaded a while, cancelled, or an hour old.
"""
import asyncio
import collections
import logging
import shutil
import tempfile
import time
from pathlib import Path

log = logging.getLogger(__name__)

MAX_BYTES = 2 * 1024 ** 3  # 20 minutes at the editor's 10 Mbit/s is about 1.5 GB
MAX_SECONDS = 20 * 60
KEEP_S = 3600  # the longest any export is kept
DONE_KEEP_S = 900  # a finished one, for downloading it again
IDLE_S = 600  # one that's stopped getting frames (its tab was closed, say)
MAX_AT_ONCE = 2
CODECS = ("h264", "ivf")


class VideoError(Exception):
    pass


class Export:
    def __init__(self, job_id: str, folder: Path, *, codec: str, fps: int, start: float, duration: float,
                 tail: float, song: Path | None, name: str):
        self.id, self.folder, self.codec, self.fps = job_id, folder, codec, fps
        self.start, self.duration, self.tail, self.song, self.name = start, duration, tail, song, name
        self.video = folder / ("frames.h264" if codec == "h264" else "frames.ivf")
        self.out = folder / "show.mp4"
        self.state, self.progress, self.error = "receiving", 0.0, ""
        self.bytes = 0
        self.created = self.touched = time.monotonic()
        self.task: asyncio.Task | None = None
        self.proc: asyncio.subprocess.Process | None = None

    def view(self) -> dict:
        return {"id": self.id, "state": self.state, "progress": round(self.progress, 3), "error": self.error}

    def command(self, ffmpeg: str) -> list[str]:
        total = self.duration + self.tail
        if self.codec == "h264":
            # -r (not -framerate) before the input: a browser's H.264 can carry timing that otherwise wins.
            cmd = [ffmpeg, "-y", "-fflags", "+genpts", "-f", "h264", "-r", str(self.fps), "-i", str(self.video)]
        else:
            cmd = [ffmpeg, "-y", "-f", "ivf", "-i", str(self.video)]
        if self.song:
            cmd += ["-ss", f"{self.start:.3f}", "-t", f"{self.duration:.3f}", "-i", str(self.song)]
        cmd += ["-map", "0:v:0"]
        cmd += ["-c:v", "copy"] if self.codec == "h264" else \
            ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
        if self.song:
            # The song fades out over its last second and a half, then silence under the closing card.
            fade = max(self.duration - 1.5, 0)
            # "?": a part that starts after the song has ended just has no sound, rather than failing.
            cmd += ["-map", "1:a:0?", "-c:a", "aac", "-b:a", "192k", "-af", f"afade=t=out:st={fade:.3f}:d=1.5,apad"]
        cmd += ["-t", f"{total:.3f}", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(self.out)]
        return cmd


class Exports:
    def __init__(self, converter=lambda: shutil.which("ffmpeg")):
        self.jobs: dict[str, Export] = {}
        self.converter = converter
        self._sweeper: asyncio.Task | None = None

    def tidy(self, now: float | None = None):
        """Lets go of exports nobody's coming back for: an hour old, finished a while ago, or stopped
        getting frames. Runs every minute while there are any, and before each new one."""
        now = time.monotonic() if now is None else now
        for job in list(self.jobs.values()):
            if (now - job.created > KEEP_S or (job.state in ("done", "failed") and now - job.touched > DONE_KEEP_S)
                    or (job.state == "receiving" and now - job.touched > IDLE_S)):
                log.info("video: letting go of %s (%s)", job.name, job.state)
                self.drop(job.id)

    async def _sweep(self):
        while self.jobs:
            await asyncio.sleep(60)
            self.tidy()
        self._sweeper = None

    def start(self, job_id: str, **kw) -> Export:
        if not self.converter():
            raise VideoError("making a video needs ffmpeg, which isn't installed here (the Home Assistant app and "
                             "Docker image have it)")
        self.tidy()
        # Finished ones are let go once a new one starts, so at most two are ever on disk.
        for old in [j for j in self.jobs.values() if j.state in ("done", "failed")]:
            self.drop(old.id)
        if len(self.jobs) >= MAX_AT_ONCE:
            raise VideoError("another video is being made: wait for it to finish, or cancel it")
        folder = Path(tempfile.mkdtemp(prefix="haliday-video-"))
        job = Export(job_id, folder, **kw)
        self.jobs[job_id] = job
        if self._sweeper is None:
            self._sweeper = asyncio.get_running_loop().create_task(self._sweep())
        return job

    def get(self, job_id: str) -> Export | None:
        return self.jobs.get(job_id)

    def add(self, job: Export, data: bytes):
        if job.state != "receiving":
            raise VideoError("this video isn't taking frames any more")
        if job.bytes + len(data) > MAX_BYTES:
            self.drop(job.id)
            raise VideoError("this video is too big: try a shorter part")
        try:
            with job.video.open("ab") as f:
                f.write(data)
        except OSError as e:  # the disk is full, say
            self.drop(job.id)
            raise VideoError(f"couldn't keep the video's frames: {e.strerror or e}")
        job.bytes += len(data)
        job.touched = time.monotonic()

    def finish(self, job: Export):
        if job.state != "receiving":
            return
        if not job.bytes:
            raise VideoError("no frames arrived")
        job.state = "making"
        job.task = asyncio.get_running_loop().create_task(self._make(job))

    async def _make(self, job: Export):
        total = job.duration + job.tail
        errors: collections.deque = collections.deque(maxlen=20)  # ffmpeg's last words, if it fails

        async def progress():
            async for raw in job.proc.stdout:
                line = raw.decode(errors="replace").strip()
                if line.startswith("out_time_us=") and line[12:].isdigit():
                    job.progress = min(int(line[12:]) / 1e6 / total, 0.99)
                    job.touched = time.monotonic()

        async def warnings():  # read as it goes, so a chatty ffmpeg never fills its pipe and stalls
            async for raw in job.proc.stderr:
                errors.append(raw.decode(errors="replace").strip())

        try:
            job.proc = await asyncio.create_subprocess_exec(
                *job.command(self.converter()), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                await asyncio.wait_for(asyncio.gather(progress(), warnings(), job.proc.wait()), 600 + total * 3)
            except asyncio.TimeoutError:
                job.proc.kill()
                job.state, job.error = "failed", "making the video took too long"
                return
            if job.proc.returncode != 0 or not job.out.is_file():
                log.warning("video: ffmpeg failed: %s", errors[-1] if errors else "?")
                job.state, job.error = "failed", "ffmpeg couldn't make the video"
                return
            job.state, job.progress = "done", 1.0
            job.touched = time.monotonic()
            job.video.unlink(missing_ok=True)
            log.info("video: %s made (%.1f MB)", job.name, job.out.stat().st_size / 1e6)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never leave it "making" for ever
            log.warning("video: %s", e)
            job.state, job.error = "failed", str(e)[:200]

    def drop(self, job_id: str):
        job = self.jobs.pop(job_id, None)
        if not job:
            return
        if job.proc and job.proc.returncode is None:
            job.proc.kill()
        if job.task and not job.task.done():
            job.task.cancel()
        shutil.rmtree(job.folder, ignore_errors=True)

    def close(self):
        for job_id in list(self.jobs):
            self.drop(job_id)
        if self._sweeper:
            self._sweeper.cancel()
            self._sweeper = None
