"""Home Assistant entities over MQTT discovery, when an MQTT broker is set up.

Creates a "HA-liday Show" device with:
  select.ha_liday_show_show    pick a show
  button.ha_liday_show_play    play the selected show (on its saved speaker)
  button.ha_liday_show_stop    stop
  select.ha_liday_show_playlist         pick a playlist
  button.ha_liday_show_play_playlist    play the selected playlist
  sensor.ha_liday_show_status  idle, or the name of the show playing
  light.ha_liday_show          your scenes as one light: on/off, brightness, and the scenes as effects
  scene.ha_liday_show_<name>   one per scene, so they're in HA's Scenes, automations and voice
  switch.ha_liday_show_<season>_props_out   one per season: on while its props are out (seasons.py)

Publishing a show id or name to haliday_show/play also plays it directly, and a playlist's to
haliday_show/playlist/play. A scene asked for while a
show or playlist is on waits for it to finish (runner.want_scene).
"""
import asyncio
import json
import logging

from . import __version__, migrate, playlists, seasons
from .commands import find_show
from .runner import Runner, RunnerError

log = logging.getLogger(__name__)

BASE = "haliday_show"
DISCOVERY = "homeassistant"
DEVICE = {"identifiers": ["haliday_show"], "name": "HA-liday Show",
          "manufacturer": "ha-liday-show", "model": "Light show sequencer", "sw_version": __version__}


def show_options(shows: list[dict]) -> dict[str, str]:
    """Option label -> show id. Names are used unless two shows share one."""
    names = [s["name"] for s in shows]
    return {(s["name"] if names.count(s["name"]) == 1 else f'{s["name"]} ({s["id"]})'): s["id"]
            for s in shows}


def discovery_configs(options: list[str], playlist_options: list[str] = ()) -> dict[str, dict]:
    avail = {"availability_topic": f"{BASE}/availability"}
    return {
        f"{DISCOVERY}/select/haliday_show/playlist/config": {
            "name": "Playlist", "unique_id": "haliday_show_playlist", "icon": "mdi:playlist-play",
            "command_topic": f"{BASE}/playlist/set", "state_topic": f"{BASE}/playlist/state",
            "options": list(playlist_options) or ["(no playlists yet)"], "device": DEVICE, **avail},
        f"{DISCOVERY}/button/haliday_show/play_playlist/config": {
            "name": "Play playlist", "unique_id": "haliday_show_play_playlist", "icon": "mdi:play-box-multiple",
            "command_topic": f"{BASE}/playlist/play", "payload_press": "PRESS", "device": DEVICE, **avail},
        f"{DISCOVERY}/select/haliday_show/show/config": {
            "name": "Show", "unique_id": "haliday_show_show", "icon": "mdi:playlist-music",
            "command_topic": f"{BASE}/show/set", "state_topic": f"{BASE}/show/state",
            "options": options or ["(no shows yet)"], "device": DEVICE, **avail},
        f"{DISCOVERY}/button/haliday_show/play/config": {
            "name": "Play", "unique_id": "haliday_show_play", "icon": "mdi:play",
            "command_topic": f"{BASE}/play", "payload_press": "PRESS", "device": DEVICE, **avail},
        f"{DISCOVERY}/button/haliday_show/stop/config": {
            "name": "Stop", "unique_id": "haliday_show_stop", "icon": "mdi:stop",
            "command_topic": f"{BASE}/stop", "payload_press": "PRESS", "device": DEVICE, **avail},
        f"{DISCOVERY}/sensor/haliday_show/status/config": {
            "name": "Status", "unique_id": "haliday_show_status", "icon": "mdi:string-lights",
            "state_topic": f"{BASE}/status", "device": DEVICE, **avail},
    }


def scene_options(scenes: list[dict]) -> dict[str, str]:
    """Effect name -> scene id. Scenes' names are unique (server.py), but stay safe."""
    return show_options(scenes)


def scene_configs(scenes: list[dict]) -> dict[str, dict]:
    """The light and a scene entity for each scene, for MQTT discovery."""
    avail = {"availability_topic": f"{BASE}/availability"}
    effects = list(scene_options(scenes))
    out = {
        f"{DISCOVERY}/light/haliday_show/scenes/config": {
            # No name of its own: it's the device's main light, light.ha_liday_show.
            "name": None, "unique_id": "haliday_show_light", "icon": "mdi:string-lights", "schema": "json",
            "command_topic": f"{BASE}/light/set", "state_topic": f"{BASE}/light/state",
            "brightness": True, "brightness_scale": 100, "supported_color_modes": ["brightness"],
            "effect": bool(effects), **({"effect_list": effects} if effects else {}),
            "device": DEVICE, **avail},
    }
    for s in scenes:
        out[f"{DISCOVERY}/scene/haliday_show/{s['id']}/config"] = {
            "name": s["name"], "unique_id": f"haliday_show_scene_{s['id']}", "icon": "mdi:creation",
            "command_topic": f"{BASE}/scene/{s['id']}/set", "payload_on": "ON", "device": DEVICE, **avail}
    return out


def season_configs(season_list: list[dict]) -> dict[str, dict]:
    """A switch for each season: on while its props are out, off while they're packed away."""
    avail = {"availability_topic": f"{BASE}/availability"}
    return {f"{DISCOVERY}/switch/haliday_show/season_{s['id']}/config": {
        "name": f"{s['name']} props out", "unique_id": f"haliday_show_season_{s['id']}", "icon": "mdi:calendar-star",
        "command_topic": f"{BASE}/season/{s['id']}/set", "state_topic": f"{BASE}/season/{s['id']}/state",
        "payload_on": "ON", "payload_off": "OFF", "device": DEVICE, **avail} for s in season_list}


class MqttBridge:
    def __init__(self, runner: Runner):
        self.runner = runner
        self.storage = runner.storage
        self.client = None
        self.options: dict[str, str] = {}
        self.playlist_options: dict[str, str] = {}
        self.scene_options: dict[str, str] = {}
        self._status = None
        self._light = None
        self._refresh = asyncio.Event()

    def refresh(self):
        """Call after shows or playlists change so the selects' options follow."""
        self._refresh.set()

    @property
    def selected(self) -> str | None:
        return self.storage.load_settings().get("selected_show")

    def _select(self, show_id: str):
        settings = self.storage.load_settings()
        settings["selected_show"] = show_id
        self.storage.save_settings(settings)

    @property
    def selected_playlist(self) -> str | None:
        return self.storage.load_settings().get("selected_playlist")

    def _select_playlist(self, playlist_id: str):
        settings = self.storage.load_settings()
        settings["selected_playlist"] = playlist_id
        self.storage.save_settings(settings)

    async def run(self, config: dict):
        import aiomqtt

        delay = 5
        while True:
            try:
                async with aiomqtt.Client(
                        hostname=config["host"], port=int(config.get("port", 1883)),
                        username=config.get("username"), password=config.get("password"),
                        identifier="haliday_show",
                        will=aiomqtt.Will(f"{BASE}/availability", "offline", retain=True)) as client:
                    self.client = client
                    delay = 5
                    log.info("connected to MQTT at %s", config["host"])
                    await client.subscribe(f"{BASE}/#")
                    await client.subscribe(f"{DISCOVERY}/status")
                    await self._publish_all()
                    tasks = [asyncio.create_task(self._watch())]
                    try:
                        async for msg in client.messages:
                            await self._on_message(str(msg.topic), msg.payload)
                    finally:
                        for t in tasks:
                            t.cancel()
            except aiomqtt.MqttError as e:
                log.warning("MQTT connection lost (%s); retrying in %ss", e, delay)
            self.client = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)

    async def _clear_old_entities(self):
        """After importing from Govee Light Show, remove its entities so they aren't left dangling."""
        cfg = self.storage.config_dir
        done = cfg / migrate.OLD_MQTT_CLEARED
        if done.exists() or not (migrate.imported(cfg) or {}).get("files"):
            return
        old = migrate.OLD_SLUG
        topics = [f"{DISCOVERY}/{kind}/{old}/{name}/config" for kind, name in
                  (("select", "show"), ("button", "play"), ("button", "stop"), ("sensor", "status"))]
        topics += [f"{old}/{t}" for t in ("availability", "status", "show/state")]
        for topic in topics:
            await self.client.publish(topic, b"", retain=True)
        done.touch()
        log.info("removed the old Govee Light Show entities")

    async def _publish_all(self):
        await self._clear_old_entities()
        self.options = show_options(self.storage.list_shows())
        self.playlist_options = show_options(playlists.load(self.storage))
        for topic, cfg in discovery_configs(list(self.options), list(self.playlist_options)).items():
            await self.client.publish(topic, json.dumps(cfg), retain=True)
        scenes = self.storage.list_scenes()
        self.scene_options = scene_options(scenes)
        for topic, cfg in scene_configs(scenes).items():
            await self.client.publish(topic, json.dumps(cfg), retain=True)
        # Scenes deleted since last time lose their entity in Home Assistant.
        settings = self.storage.load_settings()
        now, before = [s["id"] for s in scenes], settings.get("mqtt_scenes", [])
        for gone in set(before) - set(now):
            await self.client.publish(f"{DISCOVERY}/scene/haliday_show/{gone}/config", b"", retain=True)
        if sorted(before) != sorted(now):
            settings["mqtt_scenes"] = now
            self.storage.save_settings(settings)
        await self._publish_seasons(settings)
        await self.client.publish(f"{BASE}/availability", "online", retain=True)
        await self._publish_selected()
        self._status = None
        self._light = None
        await self._publish_status()

    async def _publish_seasons(self, settings: dict):
        """Each season's switch and its state; a deleted season's switch goes from Home Assistant."""
        now = seasons.load(settings)
        for topic, cfg in season_configs(now).items():
            await self.client.publish(topic, json.dumps(cfg), retain=True)
        for s in now:
            await self.client.publish(f"{BASE}/season/{s['id']}/state", "ON" if s["out"] else "OFF", retain=True)
        ids, before = [s["id"] for s in now], settings.get("mqtt_seasons", [])
        for gone in set(before) - set(ids):
            await self.client.publish(f"{DISCOVERY}/switch/haliday_show/season_{gone}/config", b"", retain=True)
        if sorted(before) != sorted(ids):
            settings = self.storage.load_settings()
            settings["mqtt_seasons"] = ids
            self.storage.save_settings(settings)

    async def _publish_selected(self):
        label = next((k for k, v in self.options.items() if v == self.selected), None)
        if label:
            await self.client.publish(f"{BASE}/show/state", label, retain=True)
        label = next((k for k, v in self.playlist_options.items() if v == self.selected_playlist), None)
        if label:
            await self.client.publish(f"{BASE}/playlist/state", label, retain=True)

    async def _publish_status(self):
        st = self.runner.status()
        status = st["name"] or st["show"] if st["playing"] else "idle"
        if status != self._status:
            self._status = status
            await self.client.publish(f"{BASE}/status", status, retain=True)
        # The light is on while a scene is on, or waiting to come back after a show.
        scene = self.runner.scene
        label = next((k for k, v in self.scene_options.items() if scene and v == scene["id"]), None)
        light = {"state": "ON" if scene else "OFF", "brightness": self.runner.scene_level(), "color_mode": "brightness",
                 **({"effect": label} if label else {})}
        if light != self._light:
            self._light = light
            await self.client.publish(f"{BASE}/light/state", json.dumps(light), retain=True)

    async def _light_command(self, text: str):
        """{"state": "ON"|"OFF", "brightness": 1-100, "effect": scene name} from Home Assistant."""
        try:
            cmd = json.loads(text)
        except ValueError:
            cmd = {"state": text.upper()}
        if not isinstance(cmd, dict):
            raise ValueError("expected a light command")
        if isinstance(cmd.get("brightness"), (int, float)) and not isinstance(cmd["brightness"], bool):
            self.runner.set_scene_level(round(cmd["brightness"]))
        if cmd.get("state") == "OFF":
            await self.runner.stop_scene()
        elif cmd.get("effect") or cmd.get("state") == "ON":
            scene_id = self.scene_options.get(cmd.get("effect") or "")
            if cmd.get("effect") and not scene_id:
                raise ValueError(f"no scene called '{cmd['effect']}'")
            if not scene_id and not self.runner.scene:
                # On with no scene named: the last one, else the first.
                last = self.storage.load_settings().get("last_scene")
                ids = list(self.scene_options.values())
                scene_id = last if last in ids else (ids[0] if ids else None)
                if not scene_id:
                    raise ValueError("there are no scenes yet; make one in the Scene editor")
            if scene_id and (not self.runner.scene or self.runner.scene["id"] != scene_id):
                await self.runner.want_scene(scene_id)
        await self._publish_status()

    async def _watch(self):
        while True:
            try:
                await asyncio.wait_for(self._refresh.wait(), 1)
                self._refresh.clear()
                await self._publish_all()
            except asyncio.TimeoutError:
                await self._publish_status()

    async def _play(self, show_id: str):
        try:
            await self.runner.play(show_id, use_show_speaker=True)
        except RunnerError as e:
            log.error("couldn't play %s: %s", show_id, e)

    async def _play_playlist(self, playlist: dict):
        try:
            await self.runner.play_playlist(playlist)
        except RunnerError as e:
            log.error("couldn't play the playlist %s: %s", playlist["name"], e)

    async def _on_message(self, topic: str, payload: bytes):
        text = payload.decode(errors="replace").strip()
        try:
            if topic == f"{DISCOVERY}/status" and text == "online":
                await self._publish_all()  # Home Assistant restarted
            elif topic == f"{BASE}/show/set":
                show_id = self.options.get(text) or find_show(self.storage, text)
                if show_id:
                    self._select(show_id)
                    await self._publish_selected()
            elif topic == f"{BASE}/play":
                show_id = self.selected if text in ("", "PRESS") else find_show(self.storage, text)
                if not show_id:
                    raise ValueError(f"no show called '{text}'" if text != "PRESS" else "no show selected")
                # Starting a speaker can take seconds; keep handling messages meanwhile.
                asyncio.create_task(self._play(show_id))
            elif topic == f"{BASE}/playlist/set":
                playlist = playlists.find(self.storage, self.playlist_options.get(text) or text)
                if playlist:
                    self._select_playlist(playlist["id"])
                    await self._publish_selected()
            elif topic == f"{BASE}/playlist/play":
                ref = self.selected_playlist if text in ("", "PRESS") else text
                playlist = playlists.find(self.storage, ref) if ref else None
                if not playlist:
                    raise ValueError(f"no playlist called '{text}'" if text not in ("", "PRESS") else "no playlist selected")
                asyncio.create_task(self._play_playlist(playlist))
            elif topic == f"{BASE}/light/set":
                await self._light_command(text)
            elif topic.startswith(f"{BASE}/scene/") and topic.endswith("/set"):
                scene_id = topic[len(f"{BASE}/scene/"):-len("/set")]
                if scene_id not in self.scene_options.values():  # only one of yours, never a path
                    raise ValueError(f"no scene '{scene_id}'")
                await self.runner.want_scene(scene_id)
                await self._publish_status()
            elif topic.startswith(f"{BASE}/season/") and topic.endswith("/set"):
                season_id = topic[len(f"{BASE}/season/"):-len("/set")]
                if text.upper() not in ("ON", "OFF") or not seasons.set_out(self.storage, season_id, text.upper() == "ON"):
                    raise ValueError(f"no season '{season_id}', or not ON or OFF")
                # Packed away: its props go dark straight away, as from Setup → Devices.
                self.runner.player.drop(seasons.away(self.storage.load_devices(), seasons.load(self.storage.load_settings())))
                await self.client.publish(f"{BASE}/season/{season_id}/state", text.upper(), retain=True)
            elif topic == f"{BASE}/stop":
                await self.runner.stop()
                await self._publish_status()
        except (ValueError, RunnerError) as e:
            log.error("MQTT %s failed: %s", topic, e)
