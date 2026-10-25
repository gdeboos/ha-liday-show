"""Start and stop shows, with the song on a Home Assistant media player or in the browser.

Every way of playing a show goes through here: the editor, automations (add-on
stdin), the MQTT entities and playlists. A playlist plays its shows in order, each on its own
show speaker, with a pause between them, round and round until it's stopped. Playing or stopping
anything else ends it.
"""
import asyncio
import logging
from datetime import datetime, timezone

from .baked import decode
from .ha import HAError, HomeAssistant, media_content_id, position_now
from .player import Player
from .storage import Storage

log = logging.getLogger(__name__)

START_TIMEOUT_S = 20
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
        self._lock = asyncio.Lock()  # one show starting or stopping at a time
        # Play, stop and play-a-playlist one at a time, so two at once can't leave a playlist
        # running that nothing tracks. The playlist's own task never takes it.
        self._control = asyncio.Lock()

    def status(self) -> dict:
        st = self.player.status()
        show = self.storage.load_show(st["show"]) if st["show"] else None
        playlist = self.playlist if self._playlist and not self._playlist.done() else None
        return {**st, "media_player": self.media_player if st["playing"] else None,
                "name": show.get("name") if show else None,
                "playlist": {"id": playlist["id"], "name": playlist["name"]} if playlist else None}

    async def play(self, show_id: str, *, media_player: str | None = None, use_show_speaker=False,
                   position: float = 0.0, offset: float = 0.0):
        """Play a baked show.

        media_player plays the song on that HA entity and follows it. With
        use_show_speaker the show's own speaker, or else the default show speaker from
        Settings, is used when none is given.
        Without a speaker only the lights run (the browser plays the song itself).
        """
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
        devices = self.storage.devices_by_id()
        if not media_player:
            await self.player.play(show_id, baked, devices, position=position, offset=offset)
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

    async def stop(self):
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()

    async def play_playlist(self, playlist: dict):
        """Play a playlist ({id, name, shows: [show ids], gap: seconds}) until it's stopped."""
        shows = [s for s in playlist.get("shows", []) if self.storage.load_baked(s) is not None]
        if not shows:
            raise RunnerError("this playlist has no saved shows to play")
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
            self.playlist = playlist
            self._playlist = asyncio.create_task(self._run_playlist(playlist))

    async def _run_playlist(self, playlist: dict):
        gap = float(playlist.get("gap", 0))
        try:
            while True:
                played = False
                for show_id in playlist.get("shows", []):
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
                        return
                    await asyncio.sleep(max(gap, 0.1))
                if not played:  # every show failed; don't spin
                    log.error("playlist %s has nothing it can play; stopping", playlist.get("name"))
                    return
        except asyncio.CancelledError:
            pass
        finally:
            if self._playlist is asyncio.current_task():  # ended by itself, not by _end_playlist
                self.playlist = None

    async def _end_playlist(self):
        task, self._playlist = self._playlist, None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.playlist = None

    async def _stop(self):
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
