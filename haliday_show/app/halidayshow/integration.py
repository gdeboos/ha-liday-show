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

from . import __version__, playlists, seasons
from .commands import handle
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


def snapshot(runner: Runner) -> dict:
    storage = runner.storage
    settings = storage.load_settings()
    shows = storage.list_shows()
    plays = playlists.load(storage)
    scenes = storage.list_scenes()
    st = runner.status()
    scene = runner.scene
    return {
        "api": API, "version": __version__, "claimed": settings.get(CLAIMED) is True,
        # Option labels as the MQTT selects had them, so automations choosing by name keep working.
        "shows": [{"id": i, "name": label} for label, i in show_options(shows).items()],
        "playlists": [{"id": i, "name": label} for label, i in show_options(plays).items()],
        "scenes": [{"id": i, "name": label} for label, i in scene_options(scenes).items()],
        "seasons": [{"id": s["id"], "name": s["name"], "out": s["out"]} for s in seasons.load(settings)],
        "selected_show": settings.get("selected_show"),
        "selected_playlist": settings.get("selected_playlist"),
        "status": (st["name"] or st["show"]) if st["playing"] else "idle",
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
    if action == "light":
        return await light(runner, cmd)
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


class Hub:
    """Pushes a snapshot to each connected integration when anything in it changes."""

    def __init__(self, runner: Runner):
        self.runner = runner
        self.clients: set = set()
        self._changed = asyncio.Event()
        self._last = None

    def refresh(self):
        self._changed.set()

    async def run(self):
        while True:
            try:
                await asyncio.wait_for(self._changed.wait(), 1)
            except asyncio.TimeoutError:
                pass
            self._changed.clear()
            if not self.clients:
                self._last = None
                continue
            try:
                text = json.dumps({"type": "state", "state": snapshot(self.runner)})
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
