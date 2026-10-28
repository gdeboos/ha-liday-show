"""Start and stop shows, with the song on a Home Assistant media player or in the browser.

Every way of playing a show goes through here: the editor, automations (add-on
stdin), the MQTT entities and playlists. A playlist plays its shows in order, each on its own
show speaker, with a pause between them, round and round until it's stopped. Playing or stopping
anything else ends it.

A scene (scenelib.py) plays round and round until something else is chosen. A show or playlist
started while a scene is on takes the lights over, and the scene comes back once nothing else is
playing. Stopping while the scene itself is on turns it off.

Visitors on the public page add requests (a show, or a playlist to play through once) to a queue.
A request plays once nothing else is on; during a playlist it slots in after the show that's on, and
the playlist carries on afterwards. Stopping from the editor, an automation or the speaker clears
the queue.
"""
import asyncio
import logging
import math
from datetime import datetime, timezone

from . import playlists
from .baked import decode
from .ha import HAError, HomeAssistant, media_content_id, position_now
from .player import Player
from .storage import Storage

log = logging.getLogger(__name__)

START_TIMEOUT_S = 20
SCENE_BACK_S = 2.0  # how long the lights rest after a show before the scene comes back
FOLLOW_EVERY_S = 1.0
RESYNC_S = 1.0  # media players report position coarsely; only correct big jumps
ENDING_S = 5.0  # a speaker that stops this close to the end of the show has just finished the song


class RunnerError(Exception):
    pass


def _parse_time(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


class Runner:
    def __init__(self, storage: Storage, player: Player, ha: HomeAssistant):
        self.storage = storage
        self.player = player
        self.ha = ha
        self.media_player: str | None = None
        self.delay = 0.0
        self._follow: asyncio.Task | None = None
        self._playlist: asyncio.Task | None = None
        self.playlist: dict | None = None  # the playlist playing, if any
        self.speaker_stopped = False  # the speaker stopped the lights (paused or stopped in HA)
        self.finishing = False  # the playlist stops once the show that's on ends
        # The song of a show started with no speaker (by a playlist, the schedule or an automation),
        # for a Show player page to play. None when the editor plays it, or a speaker does.
        self.song: dict | None = None
        self.block: dict | None = None  # the playlist's building block playing, if any
        self.started = 0  # counts show starts, so a Show player can tell a replay of the same show
        self._lock = asyncio.Lock()  # one show starting or stopping at a time
        # Play, stop and play-a-playlist one at a time, so two at once can't leave a playlist
        # running that nothing tracks. The playlist's own task never takes it.
        self._control = asyncio.Lock()
        self.requests: list[dict] = []  # visitors' requests waiting: {id, ticket, kind, ref, name, shows, gap}
        self.public_now: dict | None = None  # the visitor's request playing
        self._public: asyncio.Task | None = None
        # Goes up whenever you play or stop something yourself, which ends a visitor's request part-way.
        self._yours = 0
        self._durations: dict[str, tuple[float, float]] = {}  # show id -> (baked file's mtime, seconds)
        self.scene: dict | None = None  # the scene on, or waiting to come back after a show: {id, name}
        self.scene_playing = False  # its frames are what the lights are showing now
        self._idle_since: float | None = None

    def status(self) -> dict:
        st = self.player.status()
        scene = {**self.scene, "playing": self.scene_playing and st["playing"]} if self.scene else None
        show = self.storage.load_show(st["show"]) if st["show"] else None
        playlist = self.playlist if self._playlist and not self._playlist.done() else None
        block = self.block if st["playing"] else None
        return {**st, "media_player": self.media_player if st["playing"] else None,
                "name": show.get("name") if show else f"{block['type'].title()} block" if block
                else self.scene["name"] if scene and scene["playing"] else None,
                "playlist": {"id": playlist["id"], "name": playlist["name"], "finishing": self.finishing}
                if playlist else None,
                "song": self.song if st["playing"] else None, "started": self.started,
                "block": {k: block[k] for k in ("type", "id", "seconds", "effect") if k in block} if block else None,
                "scene": scene}

    async def play(self, show_id: str, *, media_player: str | None = None, use_show_speaker=False,
                   position: float = 0.0, offset: float = 0.0):
        """Play a baked show.

        media_player plays the song on that HA entity and follows it. With
        use_show_speaker the show's own speaker, or else the default show speaker from
        Settings, is used when none is given.
        Without a speaker only the lights run (the browser plays the song itself).
        """
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._play(show_id, media_player=media_player, use_show_speaker=use_show_speaker,
                                 position=position, offset=offset)

    async def _play(self, show_id: str, *, media_player: str | None = None, use_show_speaker=False,
                    position: float = 0.0, offset: float = 0.0):
        blob = self.storage.load_baked(show_id)
        show = self.storage.load_show(show_id)
        if blob is None or show is None:
            raise RunnerError(f"show '{show_id}' doesn't exist or hasn't been saved in the editor")
        baked = decode(blob)
        if use_show_speaker and not media_player:
            media_player = (show.get("media_player")
                            or self.storage.load_settings().get("show_speaker") or None)
        await self._stop()
        self.started += 1
        self.speaker_stopped = False
        devices = self.storage.devices_by_id()
        if not media_player:
            await self.player.play(show_id, baked, devices, position=position, offset=offset)
            audio = show.get("audio") or {}
            if use_show_speaker and audio.get("source") and audio.get("path"):
                self.song = {"source": audio["source"], "path": audio["path"]}
            return
        audio = show.get("audio")
        if not audio:
            raise RunnerError("this show has no song to play on a speaker")
        self.delay = self.storage.load_settings()["speaker_delays"].get(media_player, 0) / 1000
        # Set before starting it, so stopping part-way through (a playlist stopped while its next song
        # starts) still stops the speaker.
        self.media_player = media_player
        self.speaker_stopped = False
        await self._start_speaker(media_player, audio["path"], position)
        await self.player.play(show_id, baked, devices, position=position, offset=self.delay)
        self._follow = asyncio.create_task(self._follow_speaker(media_player))
        log.info("playing %s on %s", show_id, media_player)

    async def test_speaker(self, entity: str) -> float:
        """Play a short chime on a speaker the way a show would, then stop it.

        Returns how many seconds the speaker took to report it was playing. Raises RunnerError
        with Home Assistant's reason if it can't play the add-on's songs.
        """
        async with self._lock:
            if self.media_player == entity:
                await self._stop()
            loop = asyncio.get_running_loop()
            t0 = loop.time()
            await self._start_speaker(entity, self.storage.speaker_test_path(), 0)
            took = loop.time() - t0
            await asyncio.sleep(1)
            try:
                await self.ha.call("media_player", "media_stop", {"entity_id": entity})
            except HAError as e:
                log.warning("couldn't stop %s after its test: %s", entity, e)
            return took

    async def _start_speaker(self, entity: str, path: str, position: float):
        asked = datetime.now(timezone.utc)
        try:
            await self.ha.call("media_player", "play_media", {
                "entity_id": entity, "media_content_id": media_content_id(path),
                "media_content_type": "music"})
        except HAError as e:
            raise RunnerError(f"couldn't start {entity}: {e}") from e
        # Wait for the speaker to report it is playing the new song, not the old one.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + START_TIMEOUT_S
        while loop.time() < deadline:
            try:
                st = await self.ha.state(entity)
            except HAError:
                st = {}
            updated = _parse_time(st.get("last_updated"))
            pos = st.get("attributes", {}).get("media_position")
            if (st.get("state") == "playing" and updated and updated >= asked
                    and (pos is None or pos < 3)):
                break
            await asyncio.sleep(0.1)
        else:
            raise RunnerError(f"{entity} didn't start playing within {START_TIMEOUT_S} seconds")
        if position > 0:
            try:
                await self.ha.call("media_player", "media_seek",
                                   {"entity_id": entity, "seek_position": position})
            except HAError as e:
                log.warning("seek on %s failed: %s", entity, e)

    async def _follow_speaker(self, entity: str):
        """Stop the lights if the speaker stops; correct large drift."""
        try:
            while self.player.playing:
                await asyncio.sleep(FOLLOW_EVERY_S)
                try:
                    st = await self.ha.state(entity)
                except HAError:
                    continue
                if st.get("state") not in ("playing", "buffering"):
                    log.info("%s is %s; stopping the lights", entity, st.get("state"))
                    self.media_player = None
                    # A song ending as the show ends isn't someone stopping it.
                    left = (self.player.baked.duration if self.player.baked else 0) - self.player.position()
                    self.speaker_stopped = left > ENDING_S
                    await self.player.stop()
                    return
                est = position_now(st, datetime.now(timezone.utc))
                if est is not None and abs(self.player.position() - est) > RESYNC_S:
                    self.player.sync(est)
        except asyncio.CancelledError:
            pass

    async def stop(self, show: str | None = None, keep_scene: bool = False):
        """Stop whatever is on. With `show`, only if that show is what's playing (the editor
        stopping its own show mustn't turn off a scene that has come back since). Stopping while
        the scene itself is on turns it off; stopping a show over a scene lets the scene come back.
        keep_scene: the lights are wanted for a moment (a test, the lab, a preview), and the scene
        comes back once they're let go."""
        if show is not None and (self.player.show_id != show or self.scene_playing):
            return
        self.requests.clear()
        self._yours += 1
        async with self._control:
            if self.scene_playing and not keep_scene:
                self.scene = None
            await self._end_playlist()
            async with self._lock:
                await self._stop()

    # scenes ------------------------------------------------------------------------
    async def play_scene(self, scene_id: str, position: float = 0.0):
        """Play a scene round and round, in place of whatever is on (from `position` seconds in, for
        the Show editor playing an Advanced scene from its playhead)."""
        blob = self.storage.load_scene_baked(scene_id)
        scene = self.storage.load_scene(scene_id)
        if blob is None or scene is None:
            raise RunnerError("that scene doesn't exist or hasn't been saved in the editor")
        baked = decode(blob)
        self.requests.clear()
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
                self.player.set_level(self.scene_level())  # before the first frame goes out
                await self.player.play(None, baked, self.storage.devices_by_id(), position=position, length=math.inf)
                self.scene = {"id": scene_id, "name": scene.get("name", scene_id)}
                self.scene_playing = True
        settings = self.storage.load_settings()
        if settings.get("last_scene") != scene_id:
            settings["last_scene"] = scene_id
            self.storage.save_settings(settings)
        log.info("playing scene %s", scene_id)

    def scene_level(self) -> int:
        """Scenes' brightness, 1-100 (Home Assistant's HA-liday Show light). Shows aren't dimmed by it."""
        level = self.storage.load_settings().get("scene_brightness", 100)
        return level if isinstance(level, int) and 1 <= level <= 100 else 100

    def set_scene_level(self, level: int):
        level = max(1, min(100, int(level)))
        settings = self.storage.load_settings()
        if settings.get("scene_brightness") != level:
            settings["scene_brightness"] = level
            self.storage.save_settings(settings)
        if self.scene_playing:
            self.player.set_level(level)

    def busy(self) -> bool:
        """A show, playlist or visitor's request has the lights (not the scene itself)."""
        return ((self.player.playing and not self.scene_playing) or self._playlist_running()
                or bool(self.requests) or bool(self.public_now))

    async def want_scene(self, scene_id: str):
        """Home Assistant asked for a scene: now, or once the show that's on has finished."""
        scene = self.storage.load_scene(scene_id)
        if scene is None or self.storage.load_scene_baked(scene_id) is None:
            raise RunnerError("that scene doesn't exist or hasn't been saved in the editor")
        if self.busy():
            self.scene = {"id": scene_id, "name": scene.get("name", scene_id)}
            self.scene_playing = False
            settings = self.storage.load_settings()
            settings["last_scene"] = scene_id
            self.storage.save_settings(settings)
            log.info("scene %s waits for the show to finish", scene_id)
            return
        await self.play_scene(scene_id)

    async def stop_scene(self, scene_id: str | None = None):
        """Turn the scene off (only that one, with `scene_id`), whether it's on now or waiting."""
        if not self.scene or (scene_id and self.scene["id"] != scene_id):
            return
        playing = self.scene_playing
        self.scene = None
        if playing:
            async with self._control:
                async with self._lock:
                    if self.scene_playing:
                        await self._stop()

    def _idle(self) -> bool:
        """Nothing is using the lights: no show, block, playlist, visitor, test or preview."""
        return (not self.player.playing and not self._playlist_running() and not self.requests
                and not self.public_now and not self.player.output.devices)

    async def watch_scene(self):
        """Brings the scene back once whatever took the lights over has finished."""
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(0.5)
            if self.scene_playing and not self.player.playing:
                self.scene_playing = False
            if not self.scene or self.scene_playing or not self._idle():
                self._idle_since = None
                continue
            self._idle_since = self._idle_since or loop.time()
            if loop.time() - self._idle_since < SCENE_BACK_S:
                continue
            self._idle_since = None
            scene_id = self.scene["id"]
            try:
                await self.play_scene(scene_id)
            except Exception as e:  # deleted or not baked: give up on it
                log.warning("couldn't bring back scene %s: %s", scene_id, e)
                self.scene = None

    async def play_playlist(self, playlist: dict):
        """Play a playlist (see playlists.py: its items, in order) until it's stopped."""
        shows = [s for s in playlist.get("shows", []) if self.storage.load_baked(s) is not None]
        if not shows:
            raise RunnerError("this playlist has no saved shows to play")
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
            self.playlist = playlist
            self._playlist = asyncio.create_task(self._run_playlist(playlist))

    async def finish_playlist(self):
        """Stop the playlist once the show that's on has finished (now, if it's between shows)."""
        if not self._playlist or self._playlist.done():
            return
        if (self.player.playing and not self.block) or self.public_now:
            self.finishing = True
        else:  # between shows; visitors' requests still waiting play afterwards
            async with self._control:
                await self._end_playlist()
                async with self._lock:
                    await self._stop()

    async def _play_block(self, item: dict) -> bool:
        """Play one of a playlist's building blocks; False if there was nothing to play."""
        if item["type"] == "pause":  # the lights as they normally are
            await asyncio.sleep(item["seconds"])
            return False
        blob = self.storage.load_block(item["id"])
        if blob is None:  # not baked yet: the editor bakes it when the playlist's opened
            log.warning("playlist block %s (%s) has no frames yet; skipping it", item["id"], item["type"])
            return False
        try:
            baked = decode(blob)
        except Exception as e:
            log.warning("playlist block %s: %s", item["id"], e)
            return False
        async with self._lock:
            await self._stop()
            self.block = item
            await self.player.play(None, baked, self.storage.devices_by_id(), length=item["seconds"])
        while self.player.playing and self.block is item:
            await asyncio.sleep(0.1)
        return True

    async def _visitors(self, playlist: dict) -> bool:
        """Play visitors' requests waiting, each followed by the playlist's pause. True if the playlist
        should end now."""
        while self.requests and not self.finishing:
            await self._play_request(self.requests.pop(0))
            if self.speaker_stopped:
                self.requests.clear()
                return True
            if self.finishing:  # its end time came during a visitor's show
                return True
            await asyncio.sleep(max(float(playlist.get("gap", 0)), 0.1))
        return False

    async def _run_playlist(self, playlist: dict):
        items = playlist.get("items") or playlists.from_shows(playlist.get("shows", []), float(playlist.get("gap", 0)))
        # Visitors' requests slot in after a show, or after the pause that follows it (as they did
        # before blocks, when every show had its pause); the playlist then carries on.
        visitors_due = False
        try:
            while True:
                played = False
                for k, item in enumerate(items):
                    if item["type"] != "show":
                        played = await self._play_block(item) or played
                        if visitors_due and await self._visitors(playlist):
                            return
                        visitors_due = False
                        continue
                    show_id = item["id"]
                    try:
                        async with self._lock:
                            await self._play(show_id, use_show_speaker=True)
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:  # a damaged or missing show is skipped, not the whole playlist
                        log.warning("playlist %s: skipping %s: %s", playlist.get("name"), show_id, e)
                        continue
                    played = True
                    while self.player.playing:
                        await asyncio.sleep(0.25)
                    if self.speaker_stopped:  # paused or stopped on the speaker: stop the playlist too
                        log.info("playlist %s stopped with its speaker", playlist.get("name"))
                        self.requests.clear()
                        return
                    if self.finishing:
                        log.info("playlist %s finished its last show", playlist.get("name"))
                        return
                    await asyncio.sleep(0.1)
                    if items[(k + 1) % len(items)]["type"] == "pause":
                        visitors_due = True
                    elif await self._visitors(playlist):
                        return
                if not played:  # every show failed; don't spin
                    log.error("playlist %s has nothing it can play; stopping", playlist.get("name"))
                    return
        except asyncio.CancelledError:
            pass
        finally:
            if self._playlist is asyncio.current_task():  # ended by itself, not by _end_playlist
                self.playlist = None
                self.finishing = False

    async def _end_playlist(self):
        task, self._playlist = self._playlist, None
        self.finishing = False
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.playlist = None

    async def _stop(self):
        self.song = None
        self.block = None
        self.scene_playing = False
        self.player.set_level(100)
        if self._follow:
            self._follow.cancel()
            self._follow = None
        await self.player.stop()
        if self.media_player:
            try:
                await self.ha.call("media_player", "media_stop", {"entity_id": self.media_player})
            except HAError as e:
                log.warning("couldn't stop %s: %s", self.media_player, e)
            self.media_player = None

    # visitors' requests ---------------------------------------------------------------
    def _playlist_running(self) -> bool:
        return bool(self._playlist and not self._playlist.done())

    def add_request(self, request: dict):
        """Queue a visitor's request: {id, ticket, kind, ref, name, shows: [show ids], gap}."""
        self.requests.append(request)
        if not self._public or self._public.done():
            self._public = asyncio.create_task(self._run_requests())

    def cancel_request(self, request_id: str, ticket: str) -> bool:
        before = len(self.requests)
        self.requests = [r for r in self.requests if not (r["id"] == request_id and r["ticket"] == ticket)]
        return len(self.requests) < before

    def clear_requests(self):
        self.requests.clear()

    async def close(self):
        """On shutdown: stop everything, visitors' requests included."""
        await self.stop()
        if self._public and not self._public.done():
            self._public.cancel()
            try:
                await self._public
            except asyncio.CancelledError:
                pass

    async def _run_requests(self):
        """Play visitors' requests whenever nothing else is on. A playlist plays them itself."""
        try:
            while self.requests:
                if self._playlist_running() or self.player.playing or self._lock.locked():
                    await asyncio.sleep(0.25)
                    continue
                await self._play_request(self.requests.pop(0))
                if self.speaker_stopped:  # paused or stopped on the speaker: the house wants quiet
                    self.requests.clear()
        except asyncio.CancelledError:
            pass

    async def _play_request(self, request: dict):
        """Play a request's shows once each. Anything else started meanwhile ends it."""
        self.public_now = request
        yours = self._yours
        try:
            for k, show_id in enumerate(request["shows"]):
                if k:
                    await asyncio.sleep(max(float(request.get("gap", 0)), 0.1))
                if self._yours != yours:  # you played or stopped something meanwhile
                    return
                try:
                    async with self._lock:
                        await self._play(show_id, use_show_speaker=True)
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # a damaged or missing show is skipped
                    log.warning("visitor request %s: skipping %s: %s", request.get("name"), show_id, e)
                    continue
                mine = self.started
                while self.player.playing and self.started == mine:
                    await asyncio.sleep(0.25)
                if self.started != mine or self.speaker_stopped or self._yours != yours:
                    return
        finally:
            self.public_now = None

    def show_duration(self, show_id: str) -> float:
        """How long a saved show lasts, in seconds (0 if it can't be read)."""
        path = self.storage.shows_dir / f"{show_id}.gshow"
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return 0.0
        known = self._durations.get(show_id)
        if known and known[0] == mtime:
            return known[1]
        try:
            seconds = float(decode(path.read_bytes()).duration)
        except Exception:
            seconds = 0.0
        self._durations[show_id] = (mtime, seconds)
        return seconds

    def request_seconds(self, request: dict) -> float:
        shows = request["shows"]
        return sum(self.show_duration(s) for s in shows) + max(len(shows) - 1, 0) * float(request.get("gap", 0))

    def queue_waits(self) -> list[float]:
        """Roughly how many seconds until each waiting request starts."""
        now_left = 0.0
        if self.player.playing and self.block:
            now_left = max(self.block["seconds"] - self.player.position(), 0)
        elif self.player.playing and self.player.baked:
            now_left = max(self.player.baked.duration - self.player.position(), 0)
        if self.public_now:  # the rest of a visitor's playlist still to come
            shows = self.public_now["shows"]
            if self.player.show_id in shows:
                after = shows[shows.index(self.player.show_id) + 1:]
                now_left += sum(self.show_duration(s) for s in after)
        gap = float((self.playlist or {}).get("gap", 0)) if self._playlist_running() else 0.0
        waits, t = [], now_left + gap
        for r in self.requests:
            waits.append(round(t))
            t += self.request_seconds(r) + gap
        return waits
