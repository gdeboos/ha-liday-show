"""Archiving and deleting shows and songs, from Library → Shows and Library → Songs.

Shows: an archived show moves, with its bake, to shows/archived/, out of every list, playlist and
automation, but still in exports. Playlists keep its place (they already skip a show that isn't
there), so restoring it puts it back where it was. Deleting a show for good also takes it out of
playlists.

Songs: only songs in HA-liday Show's own folder (media/haliday_show) can be archived or deleted
here; the rest of the media folder may belong to other apps. An archived song moves to that
folder's Archived/ folder (hidden from HA-liday Show's song lists, still in Home Assistant's Media),
and archived-songs.json in the config folder remembers where it came from and which shows were
left without a song, so restoring it gives them their song back. Shows using a song that goes can
take another song instead, or be left without one. Shows keep their own beats either way.
"""
import json
import os
from pathlib import Path

from .storage import Storage, _write_atomic, safe_join, valid_id

ARCHIVED_SONGS = "archived-songs.json"
SONG_ARCHIVE = "Archived"


class ArchiveError(Exception):
    pass


# shows -------------------------------------------------------------------
def archived_dir(st: Storage) -> Path:
    return st.shows_dir / "archived"


def list_archived_shows(st: Storage) -> list[dict]:
    out = []
    folder = archived_dir(st)
    for p in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            show = json.loads(p.read_text())
        except ValueError:
            continue
        audio = show.get("audio")
        out.append({"id": p.stem, "name": show.get("name", p.stem), "duration": show.get("duration", 0),
                    "song": audio.get("path") if isinstance(audio, dict) else None,
                    "modified": int(p.stat().st_mtime)})
    return out


def _move_show(src_dir: Path, dest_dir: Path, show_id: str):
    if not valid_id(show_id) or not (src_dir / f"{show_id}.json").exists():
        raise ArchiveError("that show isn't there")
    if (dest_dir / f"{show_id}.json").exists():
        raise ArchiveError("a show with that id is already there")
    dest_dir.mkdir(parents=True, exist_ok=True)
    for ext in ("json", "gshow"):
        if (src_dir / f"{show_id}.{ext}").exists():
            os.replace(src_dir / f"{show_id}.{ext}", dest_dir / f"{show_id}.{ext}")


def archive_show(st: Storage, show_id: str):
    _move_show(st.shows_dir, archived_dir(st), show_id)


def restore_show(st: Storage, show_id: str) -> dict:
    """Puts an archived show back. If a live show has taken its name meanwhile, it's renamed
    "… (restored)", as two shows can't share a name. Returns {id, name}."""
    _move_show(archived_dir(st), st.shows_dir, show_id)
    show = st.load_show(show_id) or {}
    name = show.get("name", show_id)
    taken = {s["name"].lower() for s in st.list_shows() if s["id"] != show_id}
    if name.lower() in taken:
        base, n = f"{name} (restored)", 2
        name = base
        while name.lower() in taken:
            name, n = f"{base} {n}", n + 1
        st.rename_show(show_id, name)
    return {"id": show_id, "name": name}


def show_exists(st: Storage, show_id: str, archived: bool = False) -> bool:
    folder = archived_dir(st) if archived else st.shows_dir
    return valid_id(show_id) and (folder / f"{show_id}.json").exists()


def song_deletable(st: Storage, rel: str, archived: bool = False) -> bool:
    if archived:
        return rel in _records(st) and st.audio_path("media", rel) is not None
    return own_song(st, rel)


def delete_show(st: Storage, show_id: str, archived: bool = False):
    """Removes the show and its bake for good, and takes it out of every playlist."""
    folder = archived_dir(st) if archived else st.shows_dir
    if not valid_id(show_id) or not (folder / f"{show_id}.json").exists():
        raise ArchiveError("that show isn't there")
    for ext in ("json", "gshow"):
        (folder / f"{show_id}.{ext}").unlink(missing_ok=True)
    settings = st.load_settings()
    changed = False
    for p in settings.get("playlists", []):
        if isinstance(p, dict) and isinstance(p.get("shows"), list) and show_id in p["shows"]:
            p["shows"] = [s for s in p["shows"] if s != show_id]
            changed = True
    if changed:
        st.save_settings(settings)


# songs -------------------------------------------------------------------
def _own_prefix(st: Storage) -> str:
    return st.upload_dir.relative_to(st.media_dir).as_posix() + "/"


def own_song(st: Storage, rel: str) -> bool:
    """Whether a song (a path under the media folder) is in HA-liday Show's own folder and not
    already archived, so it may be archived or deleted here."""
    prefix = _own_prefix(st)
    return rel.startswith(prefix) and not rel.startswith(prefix + SONG_ARCHIVE + "/") \
        and st.audio_path("media", rel) is not None


def _records(st: Storage) -> dict:
    try:
        data = json.loads((st.config_dir / ARCHIVED_SONGS).read_text())
    except (FileNotFoundError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_records(st: Storage, records: dict):
    path = st.config_dir / ARCHIVED_SONGS
    if records:
        _write_atomic(path, json.dumps(records, indent=1).encode())
    else:
        path.unlink(missing_ok=True)


def users_of(st: Storage, rel: str) -> list[dict]:
    """The shows (not archived ones) whose song is this one: [{id, name}]."""
    out = []
    for s in st.list_shows():
        show = st.load_show(s["id"]) or {}
        audio = show.get("audio")
        if isinstance(audio, dict) and audio.get("source") == "media" and audio.get("path") == rel:
            out.append({"id": s["id"], "name": s["name"]})
    return out


def _set_audio(st: Storage, show_id: str, ref: dict | None):
    """Changes a show's song without touching its bake (the song isn't in it)."""
    show = st.load_show(show_id)
    if show is None:
        return
    if ref:
        show["audio"] = {"source": ref["source"], "path": ref["path"]}
    else:
        show.pop("audio", None)
    _write_atomic(st.shows_dir / f"{show_id}.json", json.dumps(show, indent=1).encode())


def check_replacement(st: Storage, rel: str, replacement) -> dict | None:
    if replacement is None:
        return None
    if not isinstance(replacement, dict) or replacement.get("source") != "media" \
            or not isinstance(replacement.get("path"), str):
        raise ArchiveError("that isn't a song")
    path = replacement["path"]
    if path == rel or path.startswith(_own_prefix(st) + SONG_ARCHIVE + "/") or st.audio_path("media", path) is None:
        raise ArchiveError("pick another song that's in your songs folder")
    return {"source": "media", "path": path}


def _rehome(st: Storage, rel: str, replacement: dict | None) -> tuple[list[dict], list[str]]:
    """Gives every show using the song the replacement, or no song. Returns the shows changed
    ({id, audio}) and the ids left without a song."""
    changed, songless = [], []
    for s in users_of(st, rel):
        _set_audio(st, s["id"], replacement)
        changed.append({"id": s["id"], "audio": replacement})
        if replacement is None:
            songless.append(s["id"])
    return changed, songless


def _tidy(st: Storage, folder: Path):
    """Removes empty folders left in the archive, up to and including Archived itself."""
    top = (st.upload_dir / SONG_ARCHIVE).resolve()
    folder = folder.resolve()
    while folder == top or top in folder.parents:
        try:
            folder.rmdir()  # only if empty
        except OSError:
            return
        if folder == top:
            return
        folder = folder.parent


def _free_name(path: Path) -> Path:
    """path, or "name (2).ext", "name (3).ext"… if it's taken."""
    if not path.exists():
        return path
    for n in range(2, 1000):
        p = path.with_name(f"{path.stem} ({n}){path.suffix}")
        if not p.exists():
            return p
    raise ArchiveError("too many songs with that name")


def archive_song(st: Storage, rel: str, replacement=None) -> dict:
    if not own_song(st, rel):
        raise ArchiveError("only songs in HA-liday Show's own folder can be archived")
    replacement = check_replacement(st, rel, replacement)
    src = st.audio_path("media", rel)
    inner = rel[len(_own_prefix(st)):]
    dest = _free_name(safe_join(st.upload_dir / SONG_ARCHIVE, inner) or st.upload_dir / SONG_ARCHIVE / Path(inner).name)
    changed, songless = _rehome(st, rel, replacement)
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dest)
    archived = dest.relative_to(st.media_dir).as_posix()
    records = _records(st)
    records[archived] = {"path": rel, "songless": songless}
    _save_records(st, records)
    return {"archived": archived, "shows": changed}


def list_archived_songs(st: Storage) -> list[dict]:
    """Archived songs whose files are still there: [{path, from, size, songless: [names]}]."""
    records, out = _records(st), []
    names = {s["id"]: s["name"] for s in st.list_shows()}
    for archived, rec in sorted(records.items()):
        p = st.audio_path("media", archived)
        if p is None or not isinstance(rec, dict):
            continue
        out.append({"path": archived, "from": rec.get("path", archived), "size": p.stat().st_size,
                    "songless": [names[i] for i in rec.get("songless", []) if i in names]})
    return out


def restore_song(st: Storage, archived: str) -> dict:
    """Moves an archived song back where it was (or beside it, "… (2)", if that's taken), and gives
    it back to the shows that were left without a song and still have none."""
    records = _records(st)
    rec = records.get(archived)
    src = st.audio_path("media", archived)
    if not isinstance(rec, dict) or src is None:
        raise ArchiveError("that song isn't in the archive")
    target = safe_join(st.media_dir, rec.get("path", ""))
    if target is None or not own_song_path(st, target):
        target = st.upload_dir / src.name
    target = _free_name(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, target)
    _tidy(st, src.parent)
    rel = target.relative_to(st.media_dir).as_posix()
    ref = {"source": "media", "path": rel}
    back = []
    for show_id in rec.get("songless", []):
        show = st.load_show(show_id)
        if show is not None and not show.get("audio"):
            _set_audio(st, show_id, ref)
            back.append({"id": show_id, "audio": ref})
    del records[archived]
    _save_records(st, records)
    return {"path": rel, "shows": back}


def own_song_path(st: Storage, p: Path) -> bool:
    try:
        rel = p.resolve().relative_to(st.upload_dir.resolve()).as_posix()
    except ValueError:
        return False
    return not rel.startswith(SONG_ARCHIVE + "/")


def delete_song(st: Storage, rel: str, archived: bool = False, replacement=None) -> dict:
    """Removes a song file for good. A song still in use gives its shows the replacement, or no song."""
    if archived:
        records = _records(st)
        p = st.audio_path("media", rel)
        if rel not in records or p is None:
            raise ArchiveError("that song isn't in the archive")
        p.unlink()
        _tidy(st, p.parent)
        del records[rel]
        _save_records(st, records)
        return {"shows": []}
    if not own_song(st, rel):
        raise ArchiveError("only songs in HA-liday Show's own folder can be deleted")
    replacement = check_replacement(st, rel, replacement)
    changed, _ = _rehome(st, rel, replacement)
    st.audio_path("media", rel).unlink()
    st._song_info_file("media", rel).unlink(missing_ok=True)
    return {"shows": changed}
