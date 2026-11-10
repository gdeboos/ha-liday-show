"""What the HA-liday Show integration for Home Assistant (custom_components/haliday_show) talks to.

The integration reads one snapshot of everything its entities show, and is pushed a fresh one over a
websocket whenever it changes. Commands go through POST /api/integration/command. Home Assistant reaches
the app at 127.0.0.1:8099 (the app is on the host network), so the "this machine" rule in
server.ingress_only lets it in; Docker and pipx installs elsewhere use the password.

When the integration is set up it claims Home Assistant's entities: the MQTT bridge withdraws its
discovery entries so the same entity ids move across to the integration. Removing the integration
releases them and MQTT comes back.
"""
import asyncio
import json
import logging
import re
import time

from . import __version__, playlists, seasons, songtags, timingtest
from .commands import find_show, handle
from .mqtt import scene_options, show_options
from .runner import Runner, RunnerError

log = logging.getLogger(__name__)

API = 1  # bumped when the integration must be updated to keep working
CLAIMED = "ha_integration"  # settings key: true while the integration owns Home Assistant's entities
SERVICE = "haliday_show"    # Supervisor discovery service, the integration's domain


def claimed(storage) -> bool:
    return storage.load_settings().get(CLAIMED) is True


def set_claimed(storage, on: bool):
    settings = storage.load_settings()
    if on:
        settings[CLAIMED] = True
    else:
        settings.pop(CLAIMED, None)
    storage.save_settings(settings)


_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_COLOUR_KEYS = ["color"] + [f"color{n}" for n in range(2, 9)]


def _params_colours(params) -> list[str]:
    """An effect's colours, in order: color, color2... (as many as its colour list uses)."""
    if not isinstance(params, dict):
        return []
    count = params.get("count")
    keys = _COLOUR_KEYS[:count] if isinstance(count, int) and 1 <= count <= 8 else _COLOUR_KEYS
    return [params[k].lower() for k in keys if isinstance(params.get(k), str) and _HEX.match(params[k])]


def scene_colours(scene: dict, most: int = 4) -> list[str]:
    """Up to four of a scene's colours, for its button: from its lights' looks (Basic) or clips (Advanced)."""
    found: list[str] = []
    looks = [v.get("params") for v in (scene.get("lights") or {}).values() if isinstance(v, dict)] \
        if isinstance(scene.get("lights"), dict) else []
    for t in scene.get("tracks") or []:
        if isinstance(t, dict):
            looks += [c.get("params") for c in t.get("clips") or [] if isinstance(c, dict)]
    for params in looks:
        for c in _params_colours(params):
            if c not in found:
                found.append(c)
            if len(found) >= most:
                return found
    return found


def lists(storage) -> dict:
    """The slow part (reads every show): only remade when something changes (MqttBridge.refresh)."""
    scenes = storage.list_scenes()
    colours = {s["id"]: scene_colours(s) for s in scenes}
    # Option labels as the MQTT selects had them, so automations choosing by name keep working.
    return {
        "shows": [{"id": i, "name": label} for label, i in show_options(storage.list_shows()).items()],
        "playlists": [{"id": i, "name": label} for label, i in show_options(playlists.load(storage)).items()],
        "scenes": [{"id": i, "name": label, "colours": colours.get(i, [])} for label, i in scene_options(scenes).items()],
    }


def playing(runner: Runner, st: dict) -> dict | None:
    """What's on, for the media player: None when nothing is (a scene shows on the light instead)."""
    scene_on = bool(st.get("scene") and st["scene"].get("playing"))
    if not st["playing"] or scene_on:
        return None
    song = st.get("song")
    cover = False
    if song:
        path = runner.storage.audio_path(song["source"], song["path"])
        cover = bool(path is not None and songtags.cached_cover(path))  # read once per song file
    return {"show": st["show"], "name": st.get("name") or st["show"] or "",
            "playlist": (st.get("playlist") or {}).get("name"),
            "position": st["position"], "duration": st["duration"], "started": st.get("started"),
            "song": {"source": song["source"], "path": song["path"],
                     "title": song["path"].rsplit("/", 1)[-1].rsplit(".", 1)[0], "cover": cover} if song else None,
            "speaker": st.get("media_player"), "visitor": bool(getattr(runner, "public_now", None))}


def snapshot(runner: Runner, listed: dict | None = None) -> dict:
    storage = runner.storage
    settings = storage.load_settings()
    st = runner.status()
    scene = runner.scene
    return {
        "api": API, "version": __version__, "claimed": settings.get(CLAIMED) is True,
        **(listed if listed is not None else lists(storage)),
        "seasons": [{"id": s["id"], "name": s["name"], "out": s["out"]} for s in seasons.load(settings)],
        "selected_show": settings.get("selected_show"),
        "selected_playlist": settings.get("selected_playlist"),
        "status": (st["name"] or st["show"]) if st["playing"] else "idle",
        "playing": playing(runner, st),
        "light": {"on": bool(scene), "brightness": runner.scene_level(), "scene": scene["id"] if scene else None},
    }


async def command(runner: Runner, cmd: dict, refresh) -> str:
    """One command from the integration. Raises ValueError or RunnerError with a message for the user."""
    storage = runner.storage
    action = cmd.get("action")
    if action in ("select_show", "select_playlist"):
        kind = "show" if action == "select_show" else "playlist"
        ref = str(cmd.get(kind) or "")
        items = storage.list_shows() if kind == "show" else playlists.load(storage)
        found = next((i for label, i in show_options(items).items() if ref in (i, label)), None) \
            or next((i["id"] for i in items if i["name"].strip().lower() == ref.strip().lower()), None)
        if not found:
            raise ValueError(f"no {kind} called '{ref}'")
        settings = storage.load_settings()
        settings[f"selected_{kind}"] = found
        storage.save_settings(settings)
        refresh()
        return f"selected {found}"
    if action == "play" and not cmd.get("show") and not cmd.get("playlist"):
        show_id = storage.load_settings().get("selected_show")
        if not show_id:
            raise ValueError("no show selected")
        cmd = {**cmd, "show": show_id}
    if action == "play_playlist":
        ref = cmd.get("playlist") or storage.load_settings().get("selected_playlist")
        if not ref:
            raise ValueError("no playlist selected")
        cmd = {"action": "play", "playlist": ref}
    # Check what's asked for is there before answering, since starting carries on in the background.
    if action in ("play", "play_playlist") and cmd.get("playlist") and not playlists.find(storage, cmd["playlist"]):
        raise ValueError(f"no playlist called '{cmd['playlist']}'")
    if action == "play" and cmd.get("show") and not find_show(storage, cmd["show"]):
        raise ValueError(f"no show called '{cmd['show']}'")
    if action == "light":
        return await light(runner, cmd)
    if action == "skip":
        if not await runner.skip_request():
            raise ValueError("nothing to skip: only a visitor's pick can be skipped")
        return "skipped"
    if action == "play" and cmd.get("show") and ("position" in cmd or "media_player" in cmd):
        # From the haliday_show.play action: a speaker of your choice, or part-way in.
        show_id = find_show(storage, cmd["show"])
        task = asyncio.create_task(runner.play(show_id, media_player=cmd.get("media_player"), use_show_speaker=True,
                                               position=cmd.get("position", 0.0)))
        task.add_done_callback(_log_failure)
        return "starting"
    if action in ("play", "play_playlist", "stop", "scene", "season"):
        # Starting a speaker can take seconds; answer straight away and let it start.
        if cmd.get("action") == "play" or cmd.get("playlist"):
            task = asyncio.create_task(handle(runner, cmd))
            task.add_done_callback(_log_failure)
            return "starting"
        done = await handle(runner, cmd)
        refresh()
        return done
    raise ValueError(f"unknown action '{action}'")


def _log_failure(task: asyncio.Task):
    if not task.cancelled() and (e := task.exception()):
        log.error("Home Assistant command failed: %s", e)


async def light(runner: Runner, cmd: dict) -> str:
    """The scenes light: {"on": bool, "brightness": 1-100, "scene": id or name}."""
    storage = runner.storage
    level = cmd.get("brightness")
    if isinstance(level, (int, float)) and not isinstance(level, bool):
        runner.set_scene_level(max(1, min(100, round(level))))
    if cmd.get("on") is False:
        await runner.stop_scene()
        return "scene off"
    options = scene_options(storage.list_scenes())
    ref = cmd.get("scene")
    scene_id = None
    if ref:
        scene_id = next((i for label, i in options.items() if ref in (i, label)), None)
        if not scene_id:
            raise ValueError(f"no scene called '{ref}'")
    elif cmd.get("on") and not runner.scene:
        last = storage.load_settings().get("last_scene")
        ids = list(options.values())
        scene_id = last if last in ids else (ids[0] if ids else None)
        if not scene_id:
            raise ValueError("there are no scenes yet; make one in the Scene editor")
    if scene_id and (not runner.scene or runner.scene["id"] != scene_id):
        await runner.want_scene(scene_id)
    return "ok"


RELEASE_AFTER = 7 * 24 * 3600  # no integration for a week: hand the entities back to MQTT


class Hub:
    """Pushes a snapshot to each connected integration when anything in it changes.

    The lists (every show read from disk) are only remade after refresh(); the once-a-second check
    looks at what's playing, which is cheap, so playback isn't held up."""

    def __init__(self, runner: Runner):
        self.runner = runner
        self.clients: set = set()
        self._changed = asyncio.Event()
        self._last = None
        self._lists = None
        self.seen = time.monotonic()  # last time an integration was connected (or the app started)
        self._playing = None
        self._playing_data = {}
        self._sending: set = set()
        self.released = None  # called after handing the entities back
        self.extras = None  # set by the server: schedule, visitors and pre-show details (server._integration_extras)

    def refresh(self):
        self._lists = None
        self.__dict__.pop("_next_cache", None)  # a renamed or deleted show changes what's next
        self._changed.set()

    def emit(self, name: str, data: dict):
        """An event for Home Assistant (haliday_show_<name> on its event bus)."""
        if not self.clients:
            return
        text = json.dumps({"type": "event", "event": name, "data": data})
        for ws in list(self.clients):
            task = asyncio.get_running_loop().create_task(self._send(ws, text))
            self._sending.add(task)  # kept until sent, so it isn't dropped half-way
            task.add_done_callback(self._sending.discard)

    async def _send(self, ws, text: str):
        try:
            await ws.send_str(text)
        except (ConnectionError, RuntimeError):
            self.clients.discard(ws)

    def _watch_playing(self):
        """Show started and ended events, from what's playing (scenes are left out: the light shows them)."""
        st = self.runner.status()
        scene_on = bool(st.get("scene") and st["scene"].get("playing"))
        now = (st["show"], st["started"]) if st["playing"] and st["show"] and not scene_on \
            and st["show"] != timingtest.TIMING_ID else None
        if now == self._playing:
            return
        if self._playing:
            self.emit("show_ended", self._playing_data)
        self._playing = now
        if now:
            self._playing_data = {"show": st["show"], "name": st.get("name") or st["show"],
                                  "playlist": (st.get("playlist") or {}).get("name"),
                                  "visitor": bool(getattr(self.runner, "public_now", None))}
            self.emit("show_started", self._playing_data)

    def snapshot_lists(self) -> dict:
        if self._lists is None:
            self._lists = lists(self.runner.storage)
        return self._lists

    def snapshot(self) -> dict:
        out = snapshot(self.runner, self.snapshot_lists())
        if self.extras:
            try:
                out.update(self.extras())
            except Exception:
                log.exception("couldn't gather the extra details for Home Assistant")
        return out

    def _release_if_gone(self):
        """The integration was removed while the app was off (or unreachable), so it couldn't say so."""
        if time.monotonic() - self.seen > RELEASE_AFTER and claimed(self.runner.storage):
            log.warning("no Home Assistant integration for a week: bringing back the MQTT entities")
            set_claimed(self.runner.storage, False)
            if self.released:
                self.released()

    async def run(self):
        while True:
            try:
                await asyncio.wait_for(self._changed.wait(), 1)
            except asyncio.TimeoutError:
                pass
            self._changed.clear()
            if not self.clients:
                self._last = None
                self._release_if_gone()
                continue
            self.seen = time.monotonic()
            try:
                self._watch_playing()
            except Exception:
                log.exception("couldn't follow what's playing for Home Assistant")
            try:
                text = json.dumps({"type": "state", "state": self.snapshot()})
            except Exception:
                log.exception("couldn't make the Home Assistant snapshot")
                continue
            if text == self._last:
                continue
            self._last = text
            for ws in list(self.clients):
                try:
                    await ws.send_str(text)
                except (ConnectionError, RuntimeError):
                    self.clients.discard(ws)


async def announce(ha, port: int):
    """Tell Home Assistant (through the Supervisor) that HA-liday Show is here, so it offers the integration."""
    if not ha.supervisor:
        return
    try:
        await ha._request("POST", f"{ha.supervisor}/discovery",
                          json={"service": SERVICE, "config": {"host": "127.0.0.1", "port": port}})
        log.info("told Home Assistant HA-liday Show is here (for the integration)")
    except Exception as e:  # an older Supervisor, or discovery not allowed: adding it by hand still works
        log.info("couldn't announce HA-liday Show to Home Assistant: %s", e)


__all__ = ["API", "Hub", "announce", "claimed", "command", "set_claimed", "snapshot", "RunnerError"]
