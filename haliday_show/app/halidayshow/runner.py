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
import json
import logging
import math
import time
from datetime import datetime, timezone

from . import liveeffects, livemusic, playlists, react, scenelib, wled
from .baked import decode
from . import latespeaker, timingtest
from .ha import HAError, HomeAssistant, media_content_id, position_now
from .output import linked
from .player import Player
from .storage import Storage

log = logging.getLogger(__name__)


def clock() -> float:
    """Seconds on a steady clock, for visitors' waits and rests (tests replace this, not time.monotonic,
    which the event loop itself runs on)."""
    return time.monotonic()

START_TIMEOUT_S = 20
# Before a visitor's show, phones listening get this long at most to load its song, so they start with the
# lights rather than catching up; a phone counts as listening if it asked where the song is this recently.
PREPARE_S = 3.0
LISTENER_FRESH_S = 5.0
SCENE_BACK_S = 2.0  # how long the lights rest after a show before the scene comes back
FOLLOW_EVERY_S = 1.0
RESYNC_S = 1.0  # media players report position coarsely; only correct big jumps
ENDING_S = 5.0  # a speaker that stops this close to the end of the show has just finished the song


LIVE_SETTINGS_EVERY_S = 2.0  # how often a scene reacting to music looks at Setup → Live music again


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
        self.item = 0  # which of its items is on, so a restart picks up there
        # The schedule entries that put the playlist and the scene on (set by the Scheduler), so a
        # restart doesn't bring back one whose time has ended meanwhile.
        self.scheduled: str | None = None
        self.scene_scheduled: str | None = None
        self._remembered = ""
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
        # Visitors' votes for what plays next, when the public page is set to Vote: one per phone (by its
        # ticket), {kind, ref, name, shows, gap, at}. Cleared once the winner starts.
        self.votes: dict[str, dict] = {}
        # Set by the public page: whether a vote's pick can still play now (still on the page, not just
        # played, would finish before closing). Votes that can't are dropped when the round ends.
        self.vote_ok = None
        # Visitors' picks that have played: {kind, ref, ticket, at} (time.monotonic() when it ended), for
        # the public page's cool-downs. Kept for two hours at most.
        self.public_played: list[dict] = []
        # For Tonight on the Public page's Queue tab (not saved, so a restart starts afresh): every
        # visitor pick {at: wall-clock datetime, name}, a day at most, and the listening passes seen
        # lately {pass: time.monotonic()}.
        self.public_log: list[dict] = []
        # Rest breaks for the neighbours: when the current run of back-to-back visitor picks began, when
        # the last one ended, and (while resting) when the rest is over, all time.monotonic().
        self._run_since: float | None = None
        self._last_public_end = 0.0
        self.resting_until = 0.0
        self.public_listeners: dict[str, float] = {}
        # The visitor's show about to start while listening phones load its song: {show, ready: {pass}}.
        self.coming: dict | None = None
        # Each speaker's volume before it was turned down for the night, put back by the next daytime show.
        self._day_volumes: dict[str, float] = {}
        self._public: asyncio.Task | None = None
        # Goes up whenever you play or stop something yourself, which ends a visitor's request part-way.
        self._yours = 0
        self._durations: dict[str, tuple[float, float]] = {}  # show id -> (baked file's mtime, seconds)
        self.scene: dict | None = None  # the scene on, or waiting to come back after a show: {id, name}
        self.live = None  # livemusic.LiveMusic, set by the server, for scenes with React to music
        self.seasons_changed = None  # set by the server: tells MQTT a season was switched by a command
        self.on_event = None  # set by the server: integration.Hub.emit, for Home Assistant's events
        self.scene_playing = False  # its frames are what the lights are showing now
        self._wled_tasks: set = set()  # WLEDs being told to play their own effect
        self._idle_since: float | None = None

    def status(self) -> dict:
        st = self.player.status()
        scene = {**self.scene, "playing": self.scene_playing and st["playing"]} if self.scene else None
        show = self.storage.load_show(st["show"]) if st["show"] else None
        playlist = self.playlist if self._playlist and not self._playlist.done() else None
        block = self.block if st["playing"] else None
        return {**st, "media_player": self.media_player if st["playing"] else None,
                "name": show.get("name") if show else timingtest.NAME if st["show"] == timingtest.TIMING_ID
                else self._block_name(block) if block
                else self.scene["name"] if scene and scene["playing"] else None,
                "playlist": {"id": playlist["id"], "name": playlist["name"], "finishing": self.finishing}
                if playlist else None,
                "song": self.song if st["playing"] else None, "started": self.started,
                "block": {k: block[k] for k in ("type", "id", "seconds", "effect", "scene") if k in block} if block else None,
                "scene": scene}

    def _block_name(self, block: dict) -> str:
        """A building block's name: a scene block's scene, otherwise its kind ("Colour block")."""
        if block["type"] == "scene":
            scene = self.storage.load_scene(block.get("scene") or "")
            if scene and scene.get("name"):
                return scene["name"]
        return f"{block['type'].title()} block"

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
        late = latespeaker.now_late(self.storage.load_settings())
        silent_late = bool(media_player and late and late["mode"] == "off")
        if silent_late:
            # Late at night, for the neighbours: lights only (phones can still listen).
            log.info("late: %s stays quiet for %s", media_player, show_id)
            media_player = None
        await self._stop()
        self.started += 1
        self.speaker_stopped = False
        devices = self.storage.devices_by_id()
        if not media_player:
            await self.player.play(show_id, baked, devices, position=position, offset=offset)
            audio = show.get("audio") or {}
            if (use_show_speaker or silent_late) and audio.get("source") and audio.get("path"):
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
        await self._late_volume(media_player, late)
        await self._start_speaker(media_player, audio["path"], position)
        await self.player.play(show_id, baked, devices, position=position, offset=self.delay)
        self._follow = asyncio.create_task(self._follow_speaker(media_player))
        log.info("playing %s on %s", show_id, media_player)

    async def play_timing_test(self):
        """The pre-show check's timing test (timingtest.py) on every light that isn't packed away, for
        phones listening to follow as they do a show. Stops whatever's playing first."""
        devices = self.storage.devices_by_id()  # packed-away props are left out
        lights = [d for d in devices.values() if linked(d)]
        if not lights:
            raise RunnerError("there are no lights to flash")
        test = decode(timingtest.baked(lights))
        # As play() does, so a playlist (or the schedule) can't start its next show over it.
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
                self.started += 1
                self.speaker_stopped = False
                await self.player.play(timingtest.TIMING_ID, test, devices)

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

    async def _late_volume(self, entity: str, late: dict | None):
        """Late at night, turn the speaker down to the late volume, remembering how loud it was; the first
        show after that time puts it back. Never stops the show: a speaker that won't say or change its
        volume just plays as it is."""
        try:
            if late and late["mode"] == "quieter":
                if entity not in self._day_volumes:
                    st = await self.ha.state(entity)
                    level = st.get("attributes", {}).get("volume_level")
                    if isinstance(level, (int, float)):
                        self._day_volumes[entity] = float(level)
                await self.ha.call("media_player", "volume_set",
                                   {"entity_id": entity, "volume_level": late["volume"] / 100})
            elif entity in self._day_volumes:
                await self.ha.call("media_player", "volume_set",
                                   {"entity_id": entity, "volume_level": self._day_volumes.pop(entity)})
        except HAError as e:
            log.warning("late volume on %s: %s", entity, e)

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
        self.votes.clear()
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
        self.votes.clear()
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
                self.player.set_level(self.scene_level())  # before the first frame goes out
                devices, own = self._scene_devices(scene)
                await self.player.play(None, baked, devices, position=position, length=math.inf)
                self._wled_own(own)
                self._react(scene)
                self._live_effects(scene_id, own)
                self.scene = {"id": scene_id, "name": scene.get("name", scene_id)}
                self.scene_playing = True
        settings = self.storage.load_settings()
        if settings.get("last_scene") != scene_id:
            settings["last_scene"] = scene_id
            self.storage.save_settings(settings)
        log.info("playing scene %s", scene_id)

    def _scene_devices(self, scene: dict | None) -> tuple[dict, dict]:
        """The lights a scene's frames go to, and those left to WLED's own effects ({id: (device, look)}),
        which get no frames. Frames to any light on the same WLED would put it straight back into
        realtime, ending its own effect, so other lights on that WLED get none either: they show what
        WLED has set for their segments."""
        devices = self.storage.devices_by_id()
        own = {k: (scenelib.wled_device(k, devices), look) for k, look in scenelib.wled_looks(scene or {}, devices).items()}
        taken = {d["ip"] for d, _ in own.values() if d.get("ip")}
        return {k: d for k, d in devices.items() if k not in own
                and not (d.get("kind") == "wled" and d.get("ip") in taken)}, own

    def _wled_own(self, own: dict):
        """Tells each WLED on its own effect what to play (in the background: a WLED that doesn't
        answer just stays as it was)."""
        async def send(device: dict, look: dict):
            try:
                await wled.set_state(device["ip"], wled.own_effect_state(look, wled.own_segments(device)))
            except wled.WledError as e:
                log.warning("%s: couldn't start its own effect: %s", device.get("name") or device.get("id"), e)
        for device, look in own.values():
            if device.get("ip"):  # a planned light has nothing to tell
                self._wled_tasks.add(task := asyncio.create_task(send(device, look)))
                task.add_done_callback(self._wled_tasks.discard)

    def _live_effects(self, scene_id: str, own: dict):
        """Has the player show the scene's live music effects (liveeffects.py) at the level heard: just
        started, so a new show or scene (player.play) ends it."""
        live = liveeffects.load(self.storage.load_scene_live(scene_id))
        if live is None or self.live is None:
            return  # no live effects (or nothing listening): their idle look in the scene's bake plays
        follower = liveeffects.Follower()
        heard = {"at": -math.inf}

        def step():
            now = time.monotonic()
            if now - heard["at"] >= LIVE_SETTINGS_EVERY_S:  # Live music changed while it plays
                heard.update(livemusic.settings(self.storage), at=now)
                follower.threshold = heard["from"]
            return follower.step(self.live.now(heard["source"]), now)

        self.player.live = live
        self.player.live_tracks = {t.device: t for t in live.tracks
                                   if t.device not in own and t.device in self.player.devices}
        self.player.live_step = step

    def _react(self, scene: dict | None):
        """Has the player follow the live music for a scene with React to music switched on: just
        started, so a new show or scene (player.play) ends it."""
        cfg = (scene or {}).get("react")
        if not cfg or not cfg.get("on") or self.live is None:
            return
        variants = {}
        for look in ("bass", "treble"):
            blob = self.storage.load_scene_baked(cfg[look]) if cfg[look] else None
            try:
                if blob:
                    variants[look] = decode(blob)
                    # A light that scene hands to WLED's own effect gets none of its frames.
                    own = scenelib.wled_looks(self.storage.load_scene(cfg[look]) or {}, self.storage.devices_by_id())
                    taken = {k.partition("#")[0] for k in own}  # a part on it: its whole light
                    variants[look].tracks = [t for t in variants[look].tracks if t.device not in taken]
            except Exception as e:  # a broken bake just means no strong-bass or strong-treble look
                log.warning("scene %s: %s", cfg[look], e)
        reactor = react.Reactor(cfg)
        heard = {"at": -math.inf}

        def step():
            now = time.monotonic()
            if now - heard["at"] >= LIVE_SETTINGS_EVERY_S:  # Live music changed while it plays
                heard.update(livemusic.settings(self.storage), at=now)
                reactor.threshold = heard["from"]
            return reactor.step(self.live.now(heard["source"]), now)

        self.player.react = step
        self.player.variants = variants

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
                and not self.votes and not self.public_now and not self.player.output.devices)

    async def watch_scene(self):
        """Brings the scene back once whatever took the lights over has finished."""
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(0.5)
            self.remember()
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

    @property
    def _now_file(self):
        # Not one of the saved files backups carry (backup.py), as it only says what's on.
        return self.storage.config_dir / ".playing.json"

    def remember(self):
        """Note the playlist and scene that are on, so they carry on after a restart. Stopping them
        notes that nothing is (a playlist finishing at its scheduled end isn't noted)."""
        now = {}
        if self._playlist_running() and self.playlist and not self.finishing:
            now.update(playlist=self.playlist, item=self.item, scheduled=self.scheduled)
        if self.scene:
            now.update(scene=self.scene, scene_scheduled=self.scene_scheduled)
        text = json.dumps(now, sort_keys=True)
        if text == self._remembered:
            return
        try:
            self._now_file.write_text(text)
            self._remembered = text
        except OSError as e:
            log.warning("couldn't note what's playing: %s", e)

    def recall(self) -> dict:
        """What was on when HA-liday Show last stopped ({} if nothing, or it can't be read)."""
        try:
            now = json.loads(self._now_file.read_text())
        except (OSError, ValueError):
            return {}
        self._remembered = json.dumps(now, sort_keys=True) if isinstance(now, dict) else ""
        return now if isinstance(now, dict) else {}

    async def play_playlist(self, playlist: dict, start: int = 0):
        """Play a playlist (see playlists.py: its items, in order) until it's stopped. start: the item
        to begin at (picking up after a restart)."""
        if not self._playable(playlist):
            raise RunnerError("this playlist has nothing to play yet: add a saved show, a scene or a block")
        self._yours += 1
        async with self._control:
            await self._end_playlist()
            async with self._lock:
                await self._stop()
            self.playlist = playlist
            self.item = start
            self._playlist = asyncio.create_task(self._run_playlist(playlist, start))

    def _playable(self, playlist: dict) -> bool:
        """Whether a playlist has anything with frames: a saved show, or a scene, colour, off or effect
        block (a playlist of scenes needs no shows). Pauses alone light nothing."""
        if any(self.storage.load_baked(s) is not None for s in playlist.get("shows", [])):
            return True
        for item in playlist.get("items") or []:
            if item.get("type") == "scene" and self.storage.load_scene_baked(item.get("scene", "")) is not None:
                return True
            if item.get("type") in ("colour", "off", "effect") and self.storage.load_block(item.get("id", "")) is not None:
                return True
        return False

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
        if item["type"] == "pause":  # the lights as they normally are; a gap visitors wait for too
            await asyncio.sleep(item["seconds"])
            return False
        # A scene block plays the scene's own frames (baked by the Scene editor), dimmed as scenes are.
        scene = item["type"] == "scene"
        blob = self.storage.load_scene_baked(item["scene"]) if scene else self.storage.load_block(item["id"])
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
            devices, own = self._scene_devices(self.storage.load_scene(item["scene"])) if scene \
                else (self.storage.devices_by_id(), {})
            if scene:
                self.player.set_level(self.scene_level())
            await self.player.play(None, baked, devices, length=item["seconds"])
            if scene:
                self._wled_own(own)
                self._react(self.storage.load_scene(item["scene"]))
                self._live_effects(item["scene"], own)
        # A block doesn't hold a visitor's pick back, as a scene doesn't: the pick plays now and the
        # playlist carries on with its next item after.
        while self.player.playing and self.block is item and not self._pick_waiting():
            await asyncio.sleep(0.1)
        return True

    def _pick_waiting(self) -> bool:
        return bool(self.requests or self.votes) and not self.finishing

    async def _visitors(self, playlist: dict) -> bool:
        """Play visitors' requests waiting, each followed by the playlist's pause. True if the playlist
        should end now."""
        while (self.requests or self.votes) and not self.finishing:
            request = self.requests.pop(0) if self.requests else self._take_winner()
            if request is None:
                break
            await self._play_request(request)
            if self.speaker_stopped:
                self.requests.clear()
                self.votes.clear()
                return True
            if self.finishing:  # its end time came during a visitor's show
                return True
            await asyncio.sleep(max(float(playlist.get("gap", 0)), 0.1))
        return False

    async def _run_playlist(self, playlist: dict, start: int = 0):
        items = playlist.get("items") or playlists.from_shows(playlist.get("shows", []), float(playlist.get("gap", 0)))
        skip = start % len(items) if items else 0
        # Visitors' requests slot in after a show, or after the pause that follows it (as they did
        # before blocks, when every show had its pause); the playlist then carries on.
        visitors_due = False
        try:
            while True:
                played = False
                for k, item in enumerate(items):
                    if skip:  # picking up after a restart: the first time round, from where it was
                        skip -= 1
                        continue
                    self.item = k
                    if item["type"] != "show":
                        played = await self._play_block(item) or played
                        # Visitors' picks waiting play after any block (a playlist of scenes has no
                        # shows to wait for).
                        if await self._visitors(playlist):
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
                        self.votes.clear()
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
        for task in list(self._wled_tasks):  # a slow WLED mustn't drop out of the next show's realtime
            task.cancel()
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

    def _event(self, name: str, data: dict):
        """Tell Home Assistant's integration (integration.Hub) something happened."""
        if self.on_event:
            self.on_event(name, data)

    def add_request(self, request: dict):
        """Queue a visitor's request: {id, ticket, kind, ref, name, shows: [show ids], gap}."""
        self.requests.append(request)
        self._event("visitor_pick", {"name": request.get("name"), "kind": request.get("kind"),
                                     "waiting": len(self.requests)})
        if not self._public or self._public.done():
            self._public = asyncio.create_task(self._run_requests())

    def cancel_request(self, request_id: str, ticket: str) -> bool:
        before = len(self.requests)
        self.requests = [r for r in self.requests if not (r["id"] == request_id and r["ticket"] == ticket)]
        return len(self.requests) < before

    def clear_requests(self):
        self.requests.clear()
        self.votes.clear()

    def cast_vote(self, ticket: str, pick: dict):
        """A phone's vote for what plays next ({kind, ref, name, shows, gap}), replacing any it had.
        With nothing playing, the first vote starts at once."""
        old = self.votes.get(ticket)
        if old and (old["kind"], old["ref"]) == (pick["kind"], pick["ref"]):
            return
        self.votes[ticket] = {**pick, "at": clock()}
        self._event("visitor_vote", {"name": pick.get("name"), "kind": pick.get("kind"), "votes": len(self.votes)})
        if not self._public or self._public.done():
            self._public = asyncio.create_task(self._run_requests())

    def drop_vote(self, ticket: str) -> bool:
        return self.votes.pop(ticket, None) is not None

    def vote_counts(self) -> list[dict]:
        """Each show or playlist voted for: {kind, ref, name, count}, the winner first. A tie goes to the
        one that reached that number of votes first."""
        by: dict[tuple, dict] = {}
        for v in self.votes.values():
            k = (v["kind"], v["ref"])
            row = by.setdefault(k, {"kind": v["kind"], "ref": v["ref"], "name": v["name"], "count": 0, "reached": 0.0,
                                    "pick": v})
            row["count"] += 1
            row["reached"] = max(row["reached"], v["at"])
        rows = sorted(by.values(), key=lambda r: (-r["count"], r["reached"]))
        return [{k: r[k] for k in ("kind", "ref", "name", "count")} | {"pick": r["pick"]} for r in rows]

    def _take_winner(self) -> dict | None:
        """The round's winner as a request to play, starting a new round."""
        if self.vote_ok:
            self.votes = {t: v for t, v in self.votes.items() if self.vote_ok(v)}
        counts = self.vote_counts()
        self.votes.clear()
        if not counts:
            return None
        w = counts[0]["pick"]
        self.public_log = [x for x in self.public_log if (datetime.now() - x["at"]).total_seconds() < 86400]
        self.public_log.append({"at": datetime.now(), "name": w["name"]})
        log.info("visitors' vote: %s %s won with %d", w["kind"], w["ref"], counts[0]["count"])
        return {"id": f"vote-{self.started}", "ticket": "", "kind": w["kind"], "ref": w["ref"], "name": w["name"],
                "shows": w["shows"], "gap": w.get("gap", 0)}

    def remove_request(self, request_id: str) -> bool:
        """Take anyone's pick out of the queue (yours, from the public page as admin)."""
        before = len(self.requests)
        self.requests = [r for r in self.requests if r["id"] != request_id]
        return len(self.requests) < before

    async def skip_request(self) -> bool:
        """End the visitor's pick that's playing now; the next one waiting starts as usual. Nothing
        else is stopped (a scene that was waiting comes back if no one else is queued)."""
        if not self.public_now:
            return False
        self._yours += 1  # ends _play_request after this show, rather than going on to its next
        async with self._lock:
            await self._stop()
        return True

    async def close(self):
        """On shutdown: stop everything, visitors' requests included."""
        await self.stop()
        if self._public and not self._public.done():
            self._public.cancel()
            try:
                await self._public
            except asyncio.CancelledError:
                pass

    def _rest_settings(self) -> tuple[float, float]:
        """(minutes of back-to-back visitor picks before a rest, minutes of rest), in seconds; 0 = never."""
        p = self.storage.load_settings().get("public") or {}
        try:
            after, rest = float(p.get("rest_after", 30)), float(p.get("rest_for", 5))
        except (TypeError, ValueError):
            after, rest = 30.0, 5.0
        return max(after, 0) * 60, max(rest, 0) * 60

    async def _rest_if_due(self):
        """Before a visitor's pick: after a long enough run of them, the lights rest for a while."""
        after, rest = self._rest_settings()
        now = clock()
        if self._run_since is None or now - self._last_public_end > max(rest, 60):
            self._run_since = now  # a fresh run: there was a natural break
            return
        if not after or not rest or now - self._run_since < after:
            return
        self.resting_until = now + rest
        log.info("visitors' picks: resting for %d minutes", round(rest / 60))
        try:
            while clock() < self.resting_until and (self.requests or self.votes):
                await asyncio.sleep(0.5)
        finally:
            self.resting_until = 0.0
            self._run_since = clock()

    async def _run_requests(self):
        """Play visitors' requests whenever nothing else is on. A playlist plays them itself."""
        try:
            while self.requests or self.votes:
                # A scene doesn't hold a pick back: the pick takes the lights over and the scene comes back after.
                showing = self.player.playing and not self.scene_playing
                if self._playlist_running() or showing or self._lock.locked():
                    await asyncio.sleep(0.25)
                    continue
                await self._rest_if_due()
                if not (self.requests or self.votes) or self._playlist_running() or (
                        self.player.playing and not self.scene_playing):
                    continue
                # Your admin phone's picks go first; otherwise the round's most-voted.
                request = self.requests.pop(0) if self.requests else self._take_winner()
                if request is None:
                    continue
                await self._play_request(request)
                self._last_public_end = clock()
                if self.speaker_stopped:  # paused or stopped on the speaker: the house wants quiet
                    self.requests.clear()
                    self.votes.clear()
        except asyncio.CancelledError:
            pass

    async def _play_request(self, request: dict):
        """Play a request's shows once each. Anything else started meanwhile ends it."""
        self.public_now = request
        yours = self._yours
        played = False
        try:
            for k, show_id in enumerate(request["shows"]):
                if k:
                    await asyncio.sleep(max(float(request.get("gap", 0)), 0.1))
                if self._yours != yours:  # you played or stopped something meanwhile
                    return
                await self._ready_phones(show_id)
                if self._yours != yours:
                    return
                try:
                    async with self._lock:
                        await self._play(show_id, use_show_speaker=True)
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # a damaged or missing show is skipped
                    log.warning("visitor request %s: skipping %s: %s", request.get("name"), show_id, e)
                    continue
                played = True
                mine = self.started
                while self.player.playing and self.started == mine:
                    await asyncio.sleep(0.25)
                if self.started != mine or self.speaker_stopped or self._yours != yours:
                    return
        finally:
            self.public_now = None
            if played:
                now = clock()
                self.public_played = [p for p in self.public_played if now - p["at"] < 7200]
                self.public_played.append({"kind": request["kind"], "ref": request["ref"],
                                           "ticket": request["ticket"], "at": now})

    def listeners(self) -> set[str]:
        """The phones listening now (their passes)."""
        now = clock()
        return {t for t, at in self.public_listeners.items() if now - at < LISTENER_FRESH_S}

    async def _ready_phones(self, show_id: str):
        """Phones listening load the song first, so everyone hears it from the start, in time with the
        lights: the show starts once each says it has the song (public.py), or after PREPARE_S."""
        if not self.listeners():
            return
        self.coming = {"show": show_id, "ready": set()}
        end = clock() + PREPARE_S
        try:
            while clock() < end and not self.listeners() <= self.coming["ready"]:
                await asyncio.sleep(0.05)
        finally:
            self.coming = None

    def next_show(self) -> str | None:
        """The show likely to play next, for listening phones to load its song early: the one about to
        start, the next in the visitor's pick that's on, else the first in the queue (or the vote's lead)."""
        if self.coming:
            return self.coming["show"]
        req = self.public_now
        if req and self.player.show_id in req["shows"]:
            k = req["shows"].index(self.player.show_id)
            if k + 1 < len(req["shows"]):
                return req["shows"][k + 1]
        if self.requests and self.requests[0].get("shows"):
            return self.requests[0]["shows"][0]
        counts = self.vote_counts() if self.votes else []
        return (counts[0]["pick"].get("shows") or [None])[0] if counts else None

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
        if self.scene_playing or (self.player.playing and self.block):
            pass  # a pick takes over from a scene, or a playlist's block, at once
        elif self.player.playing and self.player.baked:
            now_left = max(self.player.baked.duration - self.player.position(), 0)
        if self.public_now:  # the rest of a visitor's playlist still to come
            shows = self.public_now["shows"]
            if self.player.show_id in shows:
                after = shows[shows.index(self.player.show_id) + 1:]
                now_left += sum(self.show_duration(s) for s in after)
        now_left += max(self.resting_until - clock(), 0)
        gap = float((self.playlist or {}).get("gap", 0)) if self._playlist_running() else 0.0
        waits, t = [], now_left + gap
        for r in self.requests:
            waits.append(round(t))
            t += self.request_seconds(r) + gap
        self._queue_end = t
        return waits

    def wait_for_new(self) -> float:
        """Roughly how many seconds until a pick added now would start (after everything waiting)."""
        self.queue_waits()
        return self._queue_end
