"""One-time import from the add-on's old name (Govee Light Show, slug govee_show).

A new slug is a new add-on to Home Assistant, with its own empty config folder. On first
start we copy the old add-on's saved data across (read-only map all_addon_configs), copy its
uploaded songs to the new media folder, and point shows at the copied songs. Nothing old is
changed or deleted, so the old add-on still works until the owner removes it.
"""
import contextlib
import hashlib
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path

from . import baked
from .storage import _write_atomic

log = logging.getLogger(__name__)

OLD_SLUG = "govee_show"
NEW_SLUG = "haliday_show"
MARKER = ".imported.json"
OLD_MQTT_CLEARED = ".old-mqtt-cleared"
ADDON_CONFIGS = Path(os.environ.get("HALIDAY_SHOW_ADDON_CONFIGS", "/addon_configs"))


def _has_data(config_dir: Path) -> bool:
    return (config_dir / "devices.json").exists() or any((config_dir / "shows").glob("*.json"))


def _find_old(root: Path) -> Path | None:
    try:
        found = sorted(p for p in root.glob(f"*_{OLD_SLUG}") if p.is_dir())
    except OSError:
        return None
    # The folder with the most recently changed shows wins if there are several.
    def newest(p: Path) -> float:
        return max((f.stat().st_mtime for f in p.rglob("*") if f.is_file()), default=0)
    return max(found, key=newest) if found else None


def _copy_missing(src: Path, dst: Path) -> int:
    n = 0
    for f in src.rglob("*"):
        rel = f.relative_to(src)
        target = dst / rel
        if f.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif f.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)  # keeps times: shows' "modified" and song-info stamps rely on them
            n += 1
    return n


def _repoint(text: str) -> str:
    return text.replace(f'"{OLD_SLUG}/', f'"{NEW_SLUG}/')


def _song_key(source: str, rel: str) -> str:
    return hashlib.sha1(f"{source}:{rel}".encode()).hexdigest()[:20]  # matches Storage


def _repoint_json(config_dir: Path):
    songs = config_dir / "songs"
    for f in config_dir.rglob("*.json"):
        if f.parent == songs or f.name == MARKER:
            continue
        text = f.read_text()
        new = _repoint(text)
        if new != text:
            st = f.stat()
            f.write_text(new)
            os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns))
    # Song info is filed under a hash of the song's path, so it moves to the new path's name.
    for f in list(songs.glob("*.json")) if songs.is_dir() else []:
        try:
            body = json.loads(f.read_text())
        except ValueError:
            continue
        path = body.get("path", "")
        if body.get("source") == "media" and path.startswith(f"{OLD_SLUG}/"):
            body["path"] = NEW_SLUG + path[len(OLD_SLUG):]
            dest = songs / f"{_song_key('media', body['path'])}.json"
            if not dest.exists():
                dest.write_text(json.dumps(body))
            f.unlink()


def import_old(config_dir: Path, media_dir: Path, configs_root: Path = ADDON_CONFIGS) -> dict | None:
    """Copy the old add-on's data in once. Returns what was done, or None if nothing to do."""
    marker = config_dir / MARKER
    if marker.exists():
        return None
    old = _find_old(configs_root)
    if old is None:
        return None
    config_dir.mkdir(parents=True, exist_ok=True)
    if _has_data(config_dir):
        # Already set up under the new name; don't mix in older data.
        marker.write_text(json.dumps({"from": str(old), "skipped": "already set up"}))
        return None
    files = _copy_missing(old, config_dir)
    songs = 0
    old_media, new_media = media_dir / OLD_SLUG, media_dir / NEW_SLUG
    if old_media.is_dir():
        songs = _copy_missing(old_media, new_media)
    _repoint_json(config_dir)
    done = {"from": str(old), "files": files, "songs": songs}
    marker.write_text(json.dumps(done))
    log.info("imported %d files and %d songs from %s", files, songs, old)
    return done


def imported(config_dir: Path) -> dict | None:
    try:
        return json.loads((config_dir / MARKER).read_text())
    except (OSError, ValueError):
        return None


def fill_device_kinds(storage) -> int:
    """Saved lights from before WLED support have no kind. Mark them Govee, which they are, so every
    saved light says what it is. Only the missing field is added; nothing else in the file changes."""
    devices = storage.load_devices()
    missing = [d for d in devices if isinstance(d, dict) and not d.get("kind")]
    for d in missing:
        d["kind"] = "govee"
    if missing:
        storage.save_devices(devices)
        log.info("marked %d saved light(s) as Govee", len(missing))
    return len(missing)


# 0.2.206 took out the experimental Govee protocols (App segments, Per bulb) and the two realtime
# variants that never helped (Razer, v2), and Govee scenes. Lights on those go to Realtime, and scene
# clips come out of shows. What changed is kept in RETIRED so the editor can say so once.
RETIRED = ".retired-govee.json"
REALTIME_MAX = 255  # the realtime packet holds the segment count in one byte


def stretch_parts(parts: list[dict], old: int, new: int) -> list[dict]:
    """A light's parts moved from `old` segments to `new`, each keeping its share of the light
    (segment numbers count from 1). A part squeezed out by those before it is dropped."""
    if not parts or old == new or old < 1:
        return parts or []
    out, after = [], 0
    for p in sorted(parts, key=lambda p: p["from"]):
        start = max(round((p["from"] - 1) * new / old) + 1, after + 1)
        end = min(max(round(p["to"] * new / old), start), new)
        if start > new:
            continue
        out.append({**p, "from": start, "to": end})
        after = end
    return out


def _model_reach(models_file: Path) -> dict[str, int]:
    """Bulbs a model lights in realtime, where it doesn't reach them all (static/models.json)."""
    try:
        models = json.loads(models_file.read_text()).get("models") or []
    except (OSError, ValueError, AttributeError):
        return {}
    return {m["sku"]: int(m["reach"]) for m in models if isinstance(m, dict) and m.get("reach")}


def retire_govee_protocols(storage, models_file: Path | None = None) -> list[str]:
    """Switches Govee lights on a protocol that's gone to Realtime. Realtime takes at most 255 segments,
    or as many as the model lights in realtime (44 on the H70C5: more and it ignores the frame), so a
    light with more is cut down and its parts stretched to fit. Returns the lights' names."""
    from .protocol import RETIRED_PROTOCOLS
    models_file = models_file or Path(__file__).parent / "static" / "models.json"
    devices = storage.load_devices()
    moved, reach = [], None
    for d in devices:
        if not isinstance(d, dict) or d.get("kind", "govee") != "govee" or d.get("protocol") not in RETIRED_PROTOCOLS:
            continue
        if reach is None:
            reach = _model_reach(models_file)
        d["protocol"] = "standard"
        old = int(d.get("segments") or 1)
        most = reach.get(str(d.get("sku") or "").strip().split(" ")[0].upper(), REALTIME_MAX)
        if old > most:
            d["segments"] = most
            d["parts"] = stretch_parts(d.get("parts") or [], old, most)
        moved.append(str(d.get("name") or d.get("id") or ""))
    if moved:
        storage.save_devices(devices)
        log.info("moved %d light(s) to Realtime: %s", len(moved), ", ".join(moved))
    return moved


def _blank_scenes(blob: bytes) -> bytes | None:
    """A baked file with its Govee scene stretches dark, or None if it has none. Those frames held only
    a placeholder shimmer, as the light was handed to the scene."""
    if blob[:4] != baked.MAGIC:
        return None
    hlen = int.from_bytes(blob[5:9], "big")
    try:
        header = json.loads(blob[9: 9 + hlen])
        scenes = header.pop("scenes", None)
        if not scenes:
            return None
        sizes = [int(t["segments"]) * 3 for t in header["tracks"]]
        data = bytearray(blob[9 + hlen:])
        stride, frames = sum(sizes), int(header["frames"])
        for s in scenes:
            k = int(s["track"])
            off = sum(sizes[:k])
            for f in range(max(0, int(s["start"])), min(frames, int(s["end"]))):
                at = f * stride + off
                data[at: at + sizes[k]] = bytes(sizes[k])
    except (ValueError, KeyError, TypeError, IndexError):
        return None
    head = json.dumps(header).encode()
    return baked.MAGIC + blob[4:5] + len(head).to_bytes(4, "big") + head + bytes(data)


def drop_govee_scenes(storage) -> dict:
    """Takes Govee scene clips out of saved shows (archived ones too) and blanks them in baked files,
    so shows play on without them. Playlist blocks of a Govee scene become "off" blocks.
    Returns {"clips": n, "shows": [names]}."""
    clips, shows = 0, []
    folders = [storage.shows_dir, storage.shows_dir / "archived"]
    for folder in folders:
        for p in sorted(folder.glob("*.json")) if folder.is_dir() else []:
            try:
                show = json.loads(p.read_text())
            except (OSError, ValueError):
                continue
            gone = 0
            for tr in show.get("tracks") or [] if isinstance(show, dict) else []:
                if isinstance(tr, dict) and isinstance(tr.get("clips"), list):
                    kept = [c for c in tr["clips"] if not (isinstance(c, dict) and c.get("effect") == "scene")]
                    gone += len(tr["clips"]) - len(kept)
                    tr["clips"] = kept
            if gone:
                # Written in place: saving through storage would delete the baked frames, and the
                # show would stop playing until it's opened again.
                _write_atomic(p, json.dumps(show, indent=1).encode())
                clips += gone
                shows.append(str(show.get("name") or p.stem))
    for folder in folders + [storage.blocks_dir]:
        for p in sorted(folder.glob("*.gshow")) if folder.is_dir() else []:
            try:
                fixed = _blank_scenes(p.read_bytes())
            except OSError:
                continue
            if fixed is not None:
                _write_atomic(p, fixed)
    settings = storage.load_settings()
    blocks = 0
    for pl in settings.get("playlists") or []:
        for it in (pl.get("items") or []) if isinstance(pl, dict) else []:
            if isinstance(it, dict) and it.get("type") == "effect" and it.get("effect") == "scene":
                it["type"] = "off"
                it.pop("effect", None)
                it.pop("params", None)
                blocks += 1
    if blocks:
        storage.save_settings(settings)
    # Govee's scene lists were cached as scenes/<MODEL>.json, the folder your own scenes now use.
    # A cached list is a JSON list under an upper-case name, which no scene of yours can be.
    for p in storage.config_dir.glob("scenes/*.json"):
        if re.match(r"^[A-Z0-9]{3,12}$", p.stem):
            with contextlib.suppress(OSError, ValueError):
                if isinstance(json.loads(p.read_text()), list):
                    p.unlink()
    if clips or blocks:
        log.info("took %d Govee scene clip(s) out of %d show(s), %d playlist block(s)", clips, len(shows), blocks)
    return {"clips": clips, "shows": shows, "blocks": blocks}


def retire_govee_extras(storage) -> dict | None:
    """Both of the above. Anything they changed is added to RETIRED for the editor to mention once."""
    lights = retire_govee_protocols(storage)
    scenes = drop_govee_scenes(storage)
    if not (lights or scenes["clips"] or scenes["blocks"]):
        return None
    marker = storage.config_dir / RETIRED
    try:
        done = json.loads(marker.read_text())
    except (OSError, ValueError):
        done = {"lights": [], "clips": 0, "shows": [], "blocks": 0}
    done["lights"] = sorted(set(done.get("lights", [])) | set(lights))
    done["shows"] = sorted(set(done.get("shows", [])) | set(scenes["shows"]))
    done["clips"] = done.get("clips", 0) + scenes["clips"]
    done["blocks"] = done.get("blocks", 0) + scenes["blocks"]
    done["at"] = int(time.time())
    _write_atomic(marker, json.dumps(done).encode())
    return done


def retired(config_dir: Path) -> dict | None:
    try:
        return json.loads((config_dir / RETIRED).read_text())
    except (OSError, ValueError):
        return None
