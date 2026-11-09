"""Devices, shows and settings live in the add-on config folder; songs in /media.

/config is the add-on's own folder (addon_config:rw), so it is included in Home
Assistant backups. Uploaded songs go to /media/haliday_show so Home Assistant media
players can play them through the media source.
"""
import hashlib
import io
import json
import math
import os
import re
import shutil
import struct
import wave
from pathlib import Path

from . import seasons, songtags

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}
SPEAKER_TEST = "haliday-show-speaker-test.wav"  # the chime that tests a speaker; not listed as a song
SAMPLES = "Samples"  # short sounds for the Music editor's layers, kept out of the song lists
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"}
_SLUG = re.compile(r"[^a-z0-9]+")
SONG_EXTRAS = ("palette", "lyrics", "voice", "drums", "sounds")  # kept in a song's info file beside what Detect found
STAMPED_EXTRAS = ("voice", "drums", "sounds")  # measured from the file, so a file saved over is measured again
# A song's parts (stems), each a WAV kept under the hood with the song (Storage.song_parts). "music" is
# everything but the vocals, from Split vocals before the song had drums and bass parts.
PART_NAMES = ("vocals", "drums", "bass", "rest", "music")
PARTS_FOLDER = ".parts"  # in HA-liday Show's own songs folder; a dot-folder, so it's never listed as songs
_UNSAFE_NAME = re.compile(r"[^\w .()-]+")


def slugify(name: str) -> str:
    return _SLUG.sub("-", name.lower()).strip("-")[:64] or "show"


def valid_id(show_id: str) -> bool:
    return bool(show_id) and slugify(show_id) == show_id


def _write_atomic(path: Path, data: bytes):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _chime(seconds: float = 2.0, rate: int = 22050) -> bytes:
    """A soft two-note chime as a mono 16-bit WAV."""
    frames = bytearray()
    n = int(seconds * rate)
    for i in range(n):
        t = i / rate
        f = 660 if t < seconds / 2 else 880
        env = min(1, t * 50) * max(0, 1 - (t % (seconds / 2)) / (seconds / 2)) ** 2
        frames += struct.pack("<h", int(9000 * env * math.sin(2 * math.pi * f * t)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def safe_join(root: Path, rel: str) -> Path | None:
    """Resolve rel inside root, or None if it escapes."""
    p = (root / rel).resolve()
    try:
        p.relative_to(root.resolve())
    except ValueError:
        return None
    return p



_HEX6 = re.compile(r"^#[0-9a-fA-F]{6}$")


def _colours_of(show: dict, most: int = 4) -> list[str]:
    """Up to four of a show's palette colours, for its tile."""
    pal = show.get("palette")
    cols = pal.get("colors") if isinstance(pal, dict) else None
    return [c.lower() for c in cols if isinstance(c, str) and _HEX6.match(c)][:most] if isinstance(cols, list) else []


def _palette_of(show: dict) -> dict | None:
    """A show's palette for Library → Shows: its name and (up to 12) colours, or None without one."""
    pal = show.get("palette")
    cols = _colours_of(show, 12)
    if not cols:
        return None
    name = pal.get("name") if isinstance(pal.get("name"), str) else ""
    return {"name": name[:60], "colours": cols}

class Storage:
    def __init__(self, config_dir: Path, media_dir: Path):
        self.config_dir = config_dir
        self.media_dir = media_dir
        self.shows_dir = config_dir / "shows"
        self.songs_dir = config_dir / "songs"
        self.drafts_dir = config_dir / "drafts"
        self.pictures_dir = config_dir / "pictures"
        self.faces_dir = config_dir / "faces"
        self.blocks_dir = config_dir / "blocks"  # playlists' building blocks, baked (playlists.py)
        # Your scenes and their baked loops (scenelib.py). Not "scenes": that folder was the cache of
        # Govee's own scene library until 0.2.207 (migrate.drop_govee_scenes clears it).
        self.scenes_dir = config_dir / "house-scenes"
        self.upload_dir = media_dir / "haliday_show"
        self.devices_file = config_dir / "devices.json"
        self.settings_file = config_dir / "settings.json"
        self.shows_dir.mkdir(parents=True, exist_ok=True)
        self._move_scenes()

    def _move_scenes(self):
        """0.2.205 kept your scenes beside Govee's scene cache; they move to their own folder."""
        old = self.config_dir / "scenes"
        if not old.is_dir():
            return
        for p in old.glob("*.json"):
            try:
                scene = json.loads(p.read_text())
            except (OSError, ValueError):
                continue
            if not isinstance(scene, dict) or "lights" not in scene or "mode" not in scene:
                continue  # one of Govee's cached libraries
            self.scenes_dir.mkdir(parents=True, exist_ok=True)
            for f in (p, p.with_suffix(".gshow")):
                if f.exists() and not (self.scenes_dir / f.name).exists():
                    f.replace(self.scenes_dir / f.name)

    # devices -------------------------------------------------------------
    def load_devices(self) -> list[dict]:
        try:
            return json.loads(self.devices_file.read_text())
        except (FileNotFoundError, ValueError):
            return []

    def save_devices(self, devices: list[dict]):
        _write_atomic(self.devices_file, json.dumps(devices, indent=2).encode())

    def devices_by_id(self) -> dict[str, dict]:
        """The lights shows, scenes and blocks play on, by id: every light but packed-away props."""
        devices = self.load_devices()
        gone = seasons.away(devices, seasons.load(self.load_settings()))
        return {d["id"]: d for d in devices if d["id"] not in gone}

    # settings ------------------------------------------------------------
    def load_settings(self) -> dict:
        try:
            settings = json.loads(self.settings_file.read_text())
        except (FileNotFoundError, ValueError):
            settings = {}
        settings.setdefault("speaker_delays", {})  # media_player entity -> ms
        return settings

    def save_settings(self, settings: dict):
        _write_atomic(self.settings_file, json.dumps(settings, indent=2).encode())

    # house photo ---------------------------------------------------------
    # One photo of the house for the editor's House view; where each light runs on it is a
    # setting. Kept in the config folder so it is backed up with everything else.
    def house_photo(self) -> Path | None:
        for ext in PHOTO_EXT:
            p = self.config_dir / f"house{ext}"
            if p.exists():
                return p
        return None

    def save_house_photo(self, data: bytes, ext: str):
        self.delete_house_photo()
        _write_atomic(self.config_dir / f"house{ext}", data)

    def delete_house_photo(self):
        while (p := self.house_photo()):
            p.unlink()

    # the public page's own picture (Public page tab → How the page looks) ----------------
    # Dated looks (public.clean_looks) each keep their own, as public-picture-<look id>.
    def public_picture(self, row: str | None = None) -> Path | None:
        name = f"public-picture-{row}" if row and valid_id(row) else "public-picture"
        for ext in PHOTO_EXT:
            p = self.config_dir / f"{name}{ext}"
            if p.exists():
                return p
        return None

    def save_public_picture(self, data: bytes, ext: str, row: str | None = None):
        self.delete_public_picture(row)
        name = f"public-picture-{row}" if row and valid_id(row) else "public-picture"
        _write_atomic(self.config_dir / f"{name}{ext}", data)

    def delete_public_picture(self, row: str | None = None):
        while (p := self.public_picture(row)):
            p.unlink()

    def public_picture_rows(self) -> set[str]:
        """The dated looks that have a picture of their own."""
        return {p.stem[len("public-picture-"):] for p in self.config_dir.glob("public-picture-*")
                if p.suffix.lower() in PHOTO_EXT}

    # shows ---------------------------------------------------------------
    def list_shows(self) -> list[dict]:
        out = []
        for p in sorted(self.shows_dir.glob("*.json")):
            try:
                show = json.loads(p.read_text())
            except ValueError:
                continue
            audio = show.get("audio")
            song = self.audio_path(audio.get("source", ""), audio.get("path", "")) if isinstance(audio, dict) else None
            out.append({"id": p.stem, "name": show.get("name", p.stem),
                        "duration": show.get("duration", 0),
                        "song": audio.get("path") if isinstance(audio, dict) else None,
                        "song_source": audio.get("source") if isinstance(audio, dict) else None,
                        # Whether its song has cover art (api/audio/cover), to show beside it.
                        "cover": bool(song and songtags.cached_cover(song)),
                        "baked": (self.shows_dir / f"{p.stem}.gshow").exists(),
                        "in_progress": show.get("in_progress") is True,
                        # Whether visitors' phones join it (unless it opted out), and if it has a Phones lane.
                        "phones": show.get("phones") is not False,
                        "phones_lane": any(isinstance(t, dict) and t.get("device") == "@phones"
                                           for t in show.get("tracks") or []),
                        # Its own picture (a number that changes with it, 0 for none), and its
                        # palette's colours, for a tile when it has no picture or cover art.
                        "picture": self.show_picture_version(p.stem),
                        "colours": _colours_of(show),
                        "palette": _palette_of(show),
                        "season": show.get("season") if isinstance(show.get("season"), str) else None,
                        "modified": int(p.stat().st_mtime)})
        return out

    # A show's own picture, shown instead of its song's cover art: shows/<id>.jpg ----------------
    def show_picture(self, show_id: str) -> Path | None:
        p = self.shows_dir / f"{show_id}.jpg"
        return p if p.is_file() else None

    def show_picture_version(self, show_id: str) -> int:
        p = self.show_picture(show_id)
        try:
            return 1 + (p.stat().st_mtime_ns // 1_000_000) % 2_000_000_000 if p else 0
        except OSError:
            return 0

    def save_show_picture(self, show_id: str, data: bytes):
        _write_atomic(self.shows_dir / f"{show_id}.jpg", data)

    def delete_show_picture(self, show_id: str):
        (self.shows_dir / f"{show_id}.jpg").unlink(missing_ok=True)

    def load_show(self, show_id: str) -> dict | None:
        try:
            return json.loads((self.shows_dir / f"{show_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def save_show(self, show_id: str, show: dict):
        _write_atomic(self.shows_dir / f"{show_id}.json", json.dumps(show, indent=1).encode())
        # The bake is stale until the editor uploads a new one.
        (self.shows_dir / f"{show_id}.gshow").unlink(missing_ok=True)
        (self.shows_dir / f"{show_id}.bakekey").unlink(missing_ok=True)

    def save_baked(self, show_id: str, blob: bytes, key: str | None = None, version: str = ""):
        """key: what the editor baked it for (its lights and their places), so opening the show again
        needn't bake it again. Kept beside the bake with the bake's own hash and the app's version,
        so a bake replaced some other way (or made by older effects) isn't taken for it."""
        _write_atomic(self.shows_dir / f"{show_id}.gshow", blob)
        note = self.shows_dir / f"{show_id}.bakekey"
        if key:
            info = {"key": key, "version": version, "sha1": hashlib.sha1(blob).hexdigest()}
            _write_atomic(note, json.dumps(info).encode())
        else:
            note.unlink(missing_ok=True)

    def baked_key(self, show_id: str, version: str = "") -> str | None:
        """The key the show's bake was made for, if that bake is still the one there."""
        try:
            info = json.loads((self.shows_dir / f"{show_id}.bakekey").read_text())
            blob = (self.shows_dir / f"{show_id}.gshow").read_bytes()
        except (OSError, ValueError):
            return None
        if not isinstance(info, dict) or info.get("version") != version:
            return None
        if info.get("sha1") != hashlib.sha1(blob).hexdigest():
            return None
        key = info.get("key")
        return key if isinstance(key, str) else None

    def load_baked(self, show_id: str) -> bytes | None:
        try:
            return (self.shows_dir / f"{show_id}.gshow").read_bytes()
        except FileNotFoundError:
            return None

    def save_block(self, block_id: str, blob: bytes):
        self.blocks_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(self.blocks_dir / f"{block_id}.gshow", blob)

    def load_block(self, block_id: str) -> bytes | None:
        try:
            return (self.blocks_dir / f"{block_id}.gshow").read_bytes()
        except FileNotFoundError:
            return None

    def baked_blocks(self) -> list[str]:
        return sorted(p.stem for p in self.blocks_dir.glob("*.gshow")) if self.blocks_dir.exists() else []

    def prune_blocks(self, keep: set[str]):
        """Deletes the frames of blocks no playlist has any more."""
        for block_id in self.baked_blocks():
            if block_id not in keep:
                (self.blocks_dir / f"{block_id}.gshow").unlink(missing_ok=True)

    # scenes --------------------------------------------------------------
    def list_scenes(self) -> list[dict]:
        out = []
        for p in sorted(self.scenes_dir.glob("*.json")) if self.scenes_dir.exists() else []:
            try:
                scene = json.loads(p.read_text())
            except ValueError:
                continue
            if not isinstance(scene, dict):
                continue
            out.append({"id": p.stem, "name": scene.get("name", p.stem), "mode": scene.get("mode", "basic"),
                        "lights": scene.get("lights", {}), "all": scene.get("all"),
                        "loop": scene.get("loop"), "tracks": scene.get("tracks"), "schedule": scene.get("schedule"),
                        "baked": (self.scenes_dir / f"{p.stem}.gshow").exists(),
                        "modified": int(p.stat().st_mtime)})
        return out

    def load_scene(self, scene_id: str) -> dict | None:
        try:
            return json.loads((self.scenes_dir / f"{scene_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def save_scene(self, scene_id: str, scene: dict):
        self.scenes_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(self.scenes_dir / f"{scene_id}.json", json.dumps(scene, indent=1).encode())
        # The bake (and live set) is stale until the editor uploads a new one.
        (self.scenes_dir / f"{scene_id}.gshow").unlink(missing_ok=True)
        (self.scenes_dir / f"{scene_id}.live.gshow").unlink(missing_ok=True)

    def save_scene_baked(self, scene_id: str, blob: bytes):
        _write_atomic(self.scenes_dir / f"{scene_id}.gshow", blob)

    def load_scene_baked(self, scene_id: str) -> bytes | None:
        try:
            return (self.scenes_dir / f"{scene_id}.gshow").read_bytes()
        except FileNotFoundError:
            return None

    def save_scene_live(self, scene_id: str, blob: bytes | None):
        """A scene's live set (liveeffects.py), or None for a scene without live effects."""
        if blob is None:
            (self.scenes_dir / f"{scene_id}.live.gshow").unlink(missing_ok=True)
        else:
            _write_atomic(self.scenes_dir / f"{scene_id}.live.gshow", blob)

    def load_scene_live(self, scene_id: str) -> bytes | None:
        try:
            return (self.scenes_dir / f"{scene_id}.live.gshow").read_bytes()
        except FileNotFoundError:
            return None

    def delete_scene(self, scene_id: str) -> bool:
        found = (self.scenes_dir / f"{scene_id}.json").exists()
        (self.scenes_dir / f"{scene_id}.json").unlink(missing_ok=True)
        (self.scenes_dir / f"{scene_id}.gshow").unlink(missing_ok=True)
        (self.scenes_dir / f"{scene_id}.live.gshow").unlink(missing_ok=True)
        return found

    def new_scene_id(self, name: str) -> str:
        base = slugify(name)
        scene_id, n = base, 2
        while (self.scenes_dir / f"{scene_id}.json").exists():
            scene_id, n = f"{base}-{n}", n + 1
        return scene_id

    def new_show_id(self, name: str) -> str:
        base = slugify(name)
        show_id, n = base, 2
        # Archived shows keep their ids, so a new show can't take one and be played in its place.
        while (self.shows_dir / f"{show_id}.json").exists() or (self.shows_dir / "archived" / f"{show_id}.json").exists():
            show_id, n = f"{base}-{n}", n + 1
        return show_id

    def duplicate_show(self, show_id: str, name: str) -> str | None:
        """A copy of the show under a new name, with its bake, so it plays straight away."""
        show = self.load_show(show_id)
        if show is None:
            return None
        new_id = self.new_show_id(name)
        show["name"] = name
        # A copy is something to work on, so it starts in progress.
        show["in_progress"] = True
        _write_atomic(self.shows_dir / f"{new_id}.json", json.dumps(show, indent=1).encode())
        baked = self.load_baked(show_id)
        if baked is not None:
            self.save_baked(new_id, baked)
        if (pic := self.show_picture(show_id)) is not None:
            self.save_show_picture(new_id, pic.read_bytes())
        return new_id

    def rename_show(self, show_id: str, name: str) -> bool:
        """Changes only the name, so the bake stays (the name isn't in it)."""
        show = self.load_show(show_id)
        if show is None:
            return False
        show["name"] = name
        _write_atomic(self.shows_dir / f"{show_id}.json", json.dumps(show, indent=1).encode())
        return True

    def mark_show(self, show_id: str, in_progress: bool) -> bool:
        """In progress or finished. Shows saved before this existed have no mark and count as finished.
        Like a rename, the bake stays."""
        show = self.load_show(show_id)
        if show is None:
            return False
        if in_progress:
            show["in_progress"] = True
        else:
            show.pop("in_progress", None)
        _write_atomic(self.shows_dir / f"{show_id}.json", json.dumps(show, indent=1).encode())
        return True

    def delete_show(self, show_id: str):
        for ext in ("json", "gshow", "bakekey", "jpg"):
            (self.shows_dir / f"{show_id}.{ext}").unlink(missing_ok=True)

    # song drafts: Music editor edits kept as recipes (which parts of which songs), no audio --------
    def list_drafts(self) -> list[dict]:
        out = []
        for p in sorted(self.drafts_dir.glob("*.json")):
            try:
                d = json.loads(p.read_text())
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            # Every song it uses, so replacing one can say which drafts would change.
            parts = [*(d.get("pieces") or []),
                     *(c for layer in d.get("layers") or [] if isinstance(layer, dict) for c in layer.get("clips") or [])]
            uses = sorted({(x.get("song") or {}).get("path") for x in parts
                           if isinstance(x, dict) and isinstance(x.get("song"), dict)} - {None})
            out.append({"id": p.stem, "name": d.get("name", p.stem), "base": d.get("base"),
                        "made": d.get("made"), "length": d.get("length", 0), "uses": uses,
                        "modified": int(p.stat().st_mtime)})
        return out

    def load_draft(self, draft_id: str) -> dict | None:
        try:
            return json.loads((self.drafts_dir / f"{draft_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def new_draft_id(self, name: str) -> str:
        base = slugify(name)
        draft_id, n = base, 2
        while (self.drafts_dir / f"{draft_id}.json").exists():
            draft_id, n = f"{base}-{n}", n + 1
        return draft_id

    def save_draft(self, draft_id: str, draft: dict):
        self.drafts_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(self.drafts_dir / f"{draft_id}.json", json.dumps(draft, indent=1).encode())

    def rename_draft(self, draft_id: str, name: str) -> bool:
        """Changes only the name, so an edit saved from another tab meanwhile isn't undone."""
        d = self.load_draft(draft_id)
        if not isinstance(d, dict):
            return False
        d["name"] = name
        self.save_draft(draft_id, d)
        return True

    def delete_draft(self, draft_id: str) -> bool:
        p = self.drafts_dir / f"{draft_id}.json"
        if not p.exists():
            return False
        p.unlink()
        return True

    # pictures for matrices: small images and GIFs, already shrunk to fit, as RGBA frames ----------
    def list_pictures(self) -> list[dict]:
        out = []
        for p in sorted(self.pictures_dir.glob("*.json")):
            d = self.load_picture(p.stem)
            # A damaged or hand-edited file is left out rather than breaking the whole list.
            if not isinstance(d, dict) or not isinstance(d.get("delays"), list) \
                    or not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in d["delays"]):
                continue
            out.append({"id": p.stem, "name": d.get("name", p.stem), "w": d.get("w"), "h": d.get("h"),
                        "frames": len(d["delays"]), "ms": sum(d["delays"]), "phone": isinstance(d.get("phone"), dict)})
        return sorted(out, key=lambda d: str(d["name"]).lower())

    def load_picture(self, picture_id: str) -> dict | None:
        try:
            return json.loads((self.pictures_dir / f"{picture_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def count_pictures(self) -> int:
        return len(list(self.pictures_dir.glob("*.json"))) if self.pictures_dir.is_dir() else 0

    def save_picture(self, picture: dict) -> str:
        """A new picture, under a new random id (pictures are added, renamed and deleted, never changed)."""
        self.pictures_dir.mkdir(parents=True, exist_ok=True)
        while True:
            picture_id = "p" + os.urandom(5).hex()
            if not (self.pictures_dir / f"{picture_id}.json").exists():
                break
        _write_atomic(self.pictures_dir / f"{picture_id}.json", json.dumps(picture).encode())
        return picture_id

    def rename_picture(self, picture_id: str, name: str) -> bool:
        d = self.load_picture(picture_id)
        if not isinstance(d, dict):
            return False
        d["name"] = name
        _write_atomic(self.pictures_dir / f"{picture_id}.json", json.dumps(d).encode())
        return True

    def delete_picture(self, picture_id: str) -> bool:
        p = self.pictures_dir / f"{picture_id}.json"
        if not p.exists():
            return False
        p.unlink()
        return True

    # your Singing faces (Library → Faces): small recipes {name, recipe} -------------------------
    def list_faces(self) -> list[dict]:
        out = []
        for p in sorted(self.faces_dir.glob("*.json")):
            d = self.load_face(p.stem)
            if isinstance(d, dict) and isinstance(d.get("recipe"), dict):  # a damaged file is left out
                out.append({"id": p.stem, "name": str(d.get("name") or p.stem), "recipe": d["recipe"]})
        return sorted(out, key=lambda d: d["name"].lower())

    def load_face(self, face_id: str) -> dict | None:
        try:
            return json.loads((self.faces_dir / f"{face_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def count_faces(self) -> int:
        return len(list(self.faces_dir.glob("*.json"))) if self.faces_dir.is_dir() else 0

    def save_face(self, face: dict, face_id: str | None = None) -> str:
        """A face under its id, or a new random one ("f" and hex, so never a built-in's name)."""
        self.faces_dir.mkdir(parents=True, exist_ok=True)
        while face_id is None:
            face_id = "f" + os.urandom(5).hex()
            if (self.faces_dir / f"{face_id}.json").exists():
                face_id = None
        _write_atomic(self.faces_dir / f"{face_id}.json", json.dumps(face).encode())
        return face_id

    def delete_face(self, face_id: str) -> bool:
        p = self.faces_dir / f"{face_id}.json"
        if not p.exists():
            return False
        p.unlink()
        return True

    # audio ---------------------------------------------------------------
    def audio_roots(self) -> dict[str, Path]:
        return {"media": self.media_dir}

    def list_audio(self, limit: int = 2000) -> list[dict]:
        out = []
        for source, root in self.audio_roots().items():
            if not root.is_dir():
                continue
            # archive.py: archived songs stay out of the lists, and so do samples (they have their own)
            hidden = {self.upload_dir / "Archived", self.samples_dir}
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and Path(dirpath, d) not in hidden)
                for f in sorted(filenames):
                    if Path(f).suffix.lower() in AUDIO_EXT and f != SPEAKER_TEST:
                        rel = os.path.relpath(os.path.join(dirpath, f), root)
                        entry = {"source": source, "path": rel}
                        parts = self.song_parts(source, rel)
                        if parts:  # its stems (vocals, drums…), for shows and the Music editor
                            entry["parts"] = parts
                            # Whether what can be heard in it has been found (static/js/sounds.js), so
                            # Split all songs into parts knows which still need it.
                            if self.load_song_extra(source, rel, "sounds") is not None:
                                entry["sounds"] = True
                        out.append(entry)
                        if len(out) >= limit:
                            return out
        return out

    def list_songs(self, limit: int = 2000) -> dict:
        """Every song with what Library → Songs shows: its size, when it changed, and what Detect found.
        `more` says the list stopped at `limit`. Walks the media folder, so run it off the event loop."""
        refs = self.list_audio(limit + 1)
        out = []
        for ref in refs[:limit]:
            p = self.audio_path(ref["source"], ref["path"])
            if p is None:
                continue
            st = p.stat()
            info = self.load_song_info(ref["source"], ref["path"])
            out.append({**ref, "size": st.st_size, "modified": int(st.st_mtime), "cover": songtags.cached_cover(p) is not None,
                        # Marks alone (put on before Detect) don't make it detected.
                        "detected": bool(info and (info.get("beats") or info.get("sections"))),
                        "tempo": (info or {}).get("tempo"),
                        "key": (info or {}).get("key"),
                        "sections": len((info or {}).get("sections") or []),
                        # Whether it has words (for the Lyrics badge); kept beside what Detect found.
                        "lyrics": bool((self.load_song_extra(ref["source"], ref["path"], "lyrics") or {}).get("text", "").strip())})
        return {"songs": out, "more": len(refs) > limit}

    def speaker_test_path(self) -> str:
        """Writes the test chime into the uploads folder if needed; returns its path under /media."""
        dest = self.upload_dir / SPEAKER_TEST
        if not dest.exists():
            self.upload_dir.mkdir(parents=True, exist_ok=True)
            _write_atomic(dest, _chime())
        return str(dest.relative_to(self.media_dir))

    def audio_path(self, source: str, rel: str) -> Path | None:
        root = self.audio_roots().get(source)
        if root is None or Path(rel).suffix.lower() not in AUDIO_EXT:
            return None
        p = safe_join(root, rel)
        return p if p and p.is_file() else None

    # A song's parts (its stems: vocals, drums, bass, the rest), made in the browser and kept with the
    # song: <uploads>/.parts/<song key>/<part>.wav, with parts.json saying which song they're of and
    # stamped with its size and time, so a song file saved over (an edit made again) has none until
    # it's made them again. A part's path is an ordinary song path under the media folder, so it plays,
    # layers and Detects like any song; it's just never listed as one.
    @property
    def parts_root(self) -> Path:
        return self.upload_dir / PARTS_FOLDER

    def parts_dir(self, source: str, rel: str) -> Path:
        return self.parts_root / hashlib.sha1(f"{source}:{rel}".encode()).hexdigest()[:20]

    def song_parts(self, source: str, rel: str) -> dict[str, str]:
        """{part: its path under the media folder} for the song's current file."""
        p = self.audio_path(source, rel)
        folder = self.parts_dir(source, rel)
        try:
            meta = json.loads((folder / "parts.json").read_text())
        except (OSError, ValueError):
            return {}
        if p is None or not isinstance(meta, dict) or meta.get("stamp") != self._stamp(p):
            return {}
        return {name: (folder / f"{name}.wav").relative_to(self.media_dir).as_posix()
                for name in PART_NAMES if (folder / f"{name}.wav").is_file()}

    def save_part(self, source: str, rel: str, name: str, src: Path) -> str | None:
        """Moves the WAV at `src` in as the song's `name` part. Parts of an older file of the song go.
        Returns the part's path, or None (src left alone) for no such song or part."""
        p = self.audio_path(source, rel)
        if p is None or name not in PART_NAMES:
            return None
        folder = self.parts_dir(source, rel)
        folder.mkdir(parents=True, exist_ok=True)
        stamp = self._stamp(p)
        try:
            meta = json.loads((folder / "parts.json").read_text())
        except (OSError, ValueError):
            meta = {}
        if not isinstance(meta, dict) or meta.get("stamp") != stamp:
            for old in PART_NAMES:
                (folder / f"{old}.wav").unlink(missing_ok=True)
        os.replace(src, folder / f"{name}.wav")
        _write_atomic(folder / "parts.json", json.dumps({"source": source, "path": rel, "stamp": stamp}).encode())
        return (folder / f"{name}.wav").relative_to(self.media_dir).as_posix()

    def move_parts(self, rel: str, new_rel: str, copy: bool = False) -> dict[str, str]:
        """The song's parts follow it to new_rel (or are copied there). {old part path: new part path}."""
        old, new = self.parts_dir("media", rel), self.parts_dir("media", new_rel)
        if not old.is_dir() or old == new:
            return {}
        shutil.rmtree(new, ignore_errors=True)
        (shutil.copytree if copy else os.replace)(old, new)
        try:
            meta = json.loads((new / "parts.json").read_text())
            meta["path"] = new_rel
            _write_atomic(new / "parts.json", json.dumps(meta).encode())
        except (OSError, ValueError, TypeError):
            pass
        return {(old / f"{n}.wav").relative_to(self.media_dir).as_posix(): (new / f"{n}.wav").relative_to(self.media_dir).as_posix()
                for n in PART_NAMES if (new / f"{n}.wav").is_file()}

    def delete_parts(self, rel: str):
        shutil.rmtree(self.parts_dir("media", rel), ignore_errors=True)

    # What Detect found in a song (tempo, beats, bars, sections), kept per file so every show
    # using the song can start from it. Stamped with the file's size and time, so replacing
    # the file (saving over an edit, say) drops the old results.
    def _song_info_file(self, source: str, rel: str) -> Path:
        key = hashlib.sha1(f"{source}:{rel}".encode()).hexdigest()[:20]
        return self.songs_dir / f"{key}.json"

    @staticmethod
    def _stamp(p: Path) -> list[int]:
        st = p.stat()
        return [st.st_size, st.st_mtime_ns]

    def load_song_info(self, source: str, rel: str) -> dict | None:
        p = self.audio_path(source, rel)
        if p is None:
            return None
        try:
            info = json.loads(self._song_info_file(source, rel).read_text())
        except (OSError, ValueError):
            return None
        if info.get("stamp") != self._stamp(p):
            return None
        return info.get("analysis")

    def save_song_info(self, source: str, rel: str, analysis: dict) -> bool:
        p = self.audio_path(source, rel)
        if p is None:
            return False
        self.songs_dir.mkdir(parents=True, exist_ok=True)
        body = {"source": source, "path": rel, "stamp": self._stamp(p), "analysis": analysis}
        # What's kept beside what Detect found (its colours, lyrics, the singer) stays.
        try:
            old = json.loads(self._song_info_file(source, rel).read_text())
        except (OSError, ValueError):
            old = {}
        for key in SONG_EXTRAS:
            if isinstance(old, dict) and old.get(key):
                body[key] = old[key]
        _write_atomic(self._song_info_file(source, rel), json.dumps(body).encode())
        return True

    # A song's colours, picked from its cover art or by the AI. Kept in the same file as what Detect
    # found but not tied to the file's size and time, so they outlive a re-detect or the file being
    # saved over.
    def load_song_palette(self, source: str, rel: str) -> dict | None:
        if self.audio_path(source, rel) is None:
            return None
        try:
            pal = json.loads(self._song_info_file(source, rel).read_text()).get("palette")
        except (OSError, ValueError, AttributeError):
            return None
        return pal if isinstance(pal, dict) else None

    def save_song_palette(self, source: str, rel: str, palette: dict | None) -> bool:
        p = self.audio_path(source, rel)
        if p is None:
            return False
        f = self._song_info_file(source, rel)
        try:
            body = json.loads(f.read_text())
            if not isinstance(body, dict):
                raise ValueError
        except (OSError, ValueError):
            body = {"source": source, "path": rel}
        if palette:
            body["palette"] = palette
        else:
            body.pop("palette", None)
        self.songs_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(f, json.dumps(body).encode())
        return True

    # Beside what Detect found, a song keeps its lyrics (for Singing faces; lyrics.js) and the singer's
    # level measured from it (show.voice). The singer is stamped with the file's size and time, as
    # Detect's results are; the lyrics outlive the file being saved over, as the colours do.
    def load_song_extra(self, source: str, rel: str, key: str):
        p = self.audio_path(source, rel)
        if p is None or key not in SONG_EXTRAS:
            return None
        try:
            value = json.loads(self._song_info_file(source, rel).read_text()).get(key)
        except (OSError, ValueError, AttributeError):
            return None
        if key in STAMPED_EXTRAS:
            if not isinstance(value, dict) or value.get("stamp") != self._stamp(p):
                return None
            value = value.get("value")
        return value if isinstance(value, dict) else None

    def save_song_extra(self, source: str, rel: str, key: str, value: dict | None) -> bool:
        p = self.audio_path(source, rel)
        if p is None or key not in SONG_EXTRAS:
            return False
        f = self._song_info_file(source, rel)
        try:
            body = json.loads(f.read_text())
            if not isinstance(body, dict):
                raise ValueError
        except (OSError, ValueError):
            body = {"source": source, "path": rel}
        if value:
            body[key] = {"stamp": self._stamp(p), "value": value} if key in STAMPED_EXTRAS else value
        else:
            body.pop(key, None)
        self.songs_dir.mkdir(parents=True, exist_ok=True)
        _write_atomic(f, json.dumps(body).encode())
        return True

    def upload_path(self, filename: str, sample: bool = False) -> Path | None:
        name = _UNSAFE_NAME.sub("_", Path(filename).name).strip(" .")
        if not name or Path(name).suffix.lower() not in AUDIO_EXT:
            return None
        folder = self.samples_dir if sample else self.upload_dir
        folder.mkdir(parents=True, exist_ok=True)
        return folder / name

    # samples: short sounds for the Music editor's layers -------------------------------------------
    @property
    def samples_dir(self) -> Path:
        return self.upload_dir / SAMPLES

    def list_samples(self) -> list[dict]:
        out = []
        if not self.samples_dir.is_dir():
            return out
        for p in sorted(self.samples_dir.rglob("*"), key=lambda p: str(p).lower()):
            if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in AUDIO_EXT:
                st = p.stat()
                out.append({"source": "media", "path": p.relative_to(self.media_dir).as_posix(),
                            "size": st.st_size, "modified": int(st.st_mtime)})
        return out

    def delete_sample(self, rel: str) -> bool:
        """Deletes a sample, only from the Samples folder."""
        p = self.audio_path("media", rel)
        if p is None or not p.is_file() or self.samples_dir.resolve() not in p.resolve().parents:
            return False
        p.unlink()
        self._song_info_file("media", rel).unlink(missing_ok=True)
        return True
