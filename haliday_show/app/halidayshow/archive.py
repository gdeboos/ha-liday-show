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

from . import playlists
from .storage import AUDIO_EXT, Storage, _write_atomic, valid_id

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
    for ext in ("json", "gshow", "bakekey"):
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
    for ext in ("json", "gshow", "bakekey"):
        (folder / f"{show_id}.{ext}").unlink(missing_ok=True)
    settings = st.load_settings()
    changed = False
    for p in settings.get("playlists", []):
        if isinstance(p, dict) and isinstance(p.get("shows"), list) and show_id in p["shows"]:
            p["shows"] = [s for s in p["shows"] if s != show_id]
            changed = True
        if isinstance(p, dict) and isinstance(p.get("items"), list):
            items = playlists.without_show(p["items"], show_id)
            changed = changed or items != p["items"]
            p["items"] = items
    if changed:
        st.save_settings(settings)


# songs -------------------------------------------------------------------
# Every song path from a request or from archived-songs.json goes through _song_file, which only
# accepts a plain path (no "..", ".", empty parts or backslashes) to a real audio file, reached
# without following a link, inside HA-liday Show's own folder: outside its Archived folder, or
# inside it for archived songs. So nothing here can move or delete a file anywhere else.
def _plain(rel) -> bool:
    if not isinstance(rel, str) or not rel or rel.startswith("/") or "\\" in rel or "\0" in rel:
        return False
    return all(part not in ("", ".", "..") for part in rel.split("/"))


def _inside(p: Path, folder: Path) -> bool:
    return p == folder or folder in p.parents


def _song_file(st: Storage, rel, archived: bool = False) -> Path | None:
    if not _plain(rel) or Path(rel).suffix.lower() not in AUDIO_EXT:
        return None
    p = st.media_dir / rel
    try:
        real = p.resolve(strict=True)
    except (OSError, ValueError):
        return None
    own = st.upload_dir.resolve()
    shelf = (st.upload_dir / SONG_ARCHIVE).resolve()
    # No links anywhere on the way: the real file must be exactly where the path says.
    if real != st.media_dir.resolve() / rel or not real.is_file() or not _inside(real, own):
        return None
    if _inside(real, st.samples_dir.resolve()):  # samples aren't songs: Library → Samples deletes them
        return None
    return p if _inside(real, shelf) == archived else None


def own_song(st: Storage, rel) -> bool:
    """Whether a song (a path under the media folder) is in HA-liday Show's own folder and not
    already archived, so it may be archived or deleted here."""
    return _song_file(st, rel) is not None


def _records(st: Storage) -> dict:
    """archived-songs.json, keeping only records whose archived file and original place are both
    within HA-liday Show's folder (it comes back in imports, so it's checked like a request)."""
    try:
        data = json.loads((st.config_dir / ARCHIVED_SONGS).read_text())
    except (FileNotFoundError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    own, shelf = st.upload_dir.resolve(), (st.upload_dir / SONG_ARCHIVE).resolve()
    for archived, rec in data.items():
        if not isinstance(rec, dict) or not _plain(rec.get("path")) or Path(rec["path"]).suffix.lower() not in AUDIO_EXT:
            continue
        place = (st.media_dir / rec["path"]).resolve()
        if not _inside(place, own) or _inside(place, shelf):
            continue
        songless = rec.get("songless")
        songless = [i for i in songless if isinstance(i, str) and valid_id(i)] if isinstance(songless, list) else []
        out[archived] = {"path": rec["path"], "songless": songless}
    return out


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
    """The song a song's shows move to: any song in the media folder that isn't this one or archived."""
    if replacement is None:
        return None
    if not isinstance(replacement, dict) or replacement.get("source") != "media":
        raise ArchiveError("that isn't a song")
    path = replacement.get("path")
    if not _plain(path) or st.audio_path("media", path) is None:
        raise ArchiveError("pick another song that's in your songs folder")
    real = (st.media_dir / path).resolve()
    gone = (st.media_dir / rel).resolve() if _plain(rel) else None
    # Not the song that's going (however it's reached), nor one that's archived.
    if real == gone or _inside(real, (st.upload_dir / SONG_ARCHIVE).resolve()):
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
    while _inside(folder, top):
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
    src = _song_file(st, rel)
    if src is None:
        raise ArchiveError("only songs in HA-liday Show's own folder can be archived")
    replacement = check_replacement(st, rel, replacement)
    inner = src.resolve().relative_to(st.upload_dir.resolve())
    dest = _free_name(st.upload_dir / SONG_ARCHIVE / inner)
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dest)  # the file moves first, so a failure leaves every show as it was
    changed, songless = _rehome(st, rel, replacement)
    archived = dest.relative_to(st.media_dir).as_posix()
    records = _records(st)
    records[archived] = {"path": rel, "songless": songless}
    _save_records(st, records)
    return {"archived": archived, "shows": changed}


def list_archived_songs(st: Storage) -> list[dict]:
    """Archived songs whose files are still there: [{path, from, size, songless: [names]}]. Records
    of files that have gone (removed by hand, say) are dropped."""
    records, out, keep = _records(st), [], {}
    names = {s["id"]: s["name"] for s in st.list_shows()}
    for archived, rec in sorted(records.items()):
        p = _song_file(st, archived, archived=True)
        if p is None:
            continue
        keep[archived] = rec
        out.append({"path": archived, "from": rec["path"], "size": p.stat().st_size,
                    "songless": [names[i] for i in rec["songless"] if i in names]})
    if keep.keys() != records.keys():
        _save_records(st, keep)
    return out


def restore_song(st: Storage, archived: str) -> dict:
    """Moves an archived song back where it was (or beside it, "… (2)", if that's taken), and gives
    it back to the shows that were left without a song and still have none."""
    records = _records(st)
    rec = records.get(archived)
    src = _song_file(st, archived, archived=True)
    if rec is None or src is None:
        raise ArchiveError("that song isn't in the archive")
    target = _free_name(st.media_dir / rec["path"])
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, target)
    _tidy(st, src.parent)
    rel = target.relative_to(st.media_dir).as_posix()
    ref = {"source": "media", "path": rel}
    back = []
    for show_id in rec["songless"]:
        show = st.load_show(show_id)
        if show is not None and not show.get("audio"):
            _set_audio(st, show_id, ref)
            back.append({"id": show_id, "audio": ref})
    del records[archived]
    _save_records(st, records)
    return {"path": rel, "shows": back}


def song_deletable(st: Storage, rel: str, archived: bool = False) -> bool:
    if archived:
        return rel in _records(st) and _song_file(st, rel, archived=True) is not None
    return own_song(st, rel)


def delete_song(st: Storage, rel: str, archived: bool = False, replacement=None) -> dict:
    """Removes a song file for good. A song still in use gives its shows the replacement, or no song."""
    if archived:
        records = _records(st)
        p = _song_file(st, rel, archived=True)
        if rel not in records or p is None:
            raise ArchiveError("that song isn't in the archive")
        p.unlink()
        _tidy(st, p.parent)
        st._song_info_file("media", records[rel]["path"]).unlink(missing_ok=True)
        del records[rel]
        _save_records(st, records)
        return {"shows": []}
    p = _song_file(st, rel)
    if p is None:
        raise ArchiveError("only songs in HA-liday Show's own folder can be deleted")
    replacement = check_replacement(st, rel, replacement)
    p.unlink()
    st._song_info_file("media", rel).unlink(missing_ok=True)
    changed, _ = _rehome(st, rel, replacement)
    return {"shows": changed}


def _relink(data, old: dict, new: dict) -> bool:
    """Points every {source, path} in data at `old` to `new`, in place. Whether anything changed."""
    changed = False
    if isinstance(data, dict):
        if data.get("source") == old["source"] and data.get("path") == old["path"]:
            data["path"] = new["path"]
            changed = True
        for v in data.values():
            changed = _relink(v, old, new) or changed
    elif isinstance(data, list):
        for v in data:
            changed = _relink(v, old, new) or changed
    return changed


def rename_song(st: Storage, rel: str, name: str) -> dict:
    """Renames a song file in HA-liday Show's own folder, keeping its folder and type, and moves every
    show, draft and song folder that uses it to the new name. Returns {path, shows: [ids]}."""
    src = _song_file(st, rel)
    if src is None:
        raise ArchiveError("only songs in HA-liday Show's own folder can be renamed here")
    clean = " ".join(name.split()).strip(". ")
    if not clean or len(clean) > 120 or any(c in clean for c in '/\\:*?"<>|') or not clean.isprintable():
        raise ArchiveError("give it a name without / \\ : * ? \" < > |")
    dest = src.with_name(clean + src.suffix)
    if dest == src:
        return {"path": rel, "shows": []}
    if dest.exists() and dest.resolve() != src.resolve():
        raise ArchiveError(f"there's already a song called {clean}")
    info_old = st._song_info_file("media", rel)
    os.replace(src, dest)  # the file moves first, so a failure leaves everything pointing at the old one
    new_rel = dest.relative_to(st.media_dir).as_posix()
    old, new = {"source": "media", "path": rel}, {"source": "media", "path": new_rel}
    if info_old.exists():
        os.replace(info_old, st._song_info_file("media", new_rel))
    shows = []
    for s in st.list_shows():
        show = st.load_show(s["id"])
        if show is not None and _relink(show, old, new):
            _write_atomic(st.shows_dir / f"{s['id']}.json", json.dumps(show, indent=1).encode())
            shows.append(s["id"])
    for p in sorted(st.drafts_dir.glob("*.json")) if st.drafts_dir.is_dir() else []:
        try:
            draft = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if _relink(draft, old, new):
            _write_atomic(p, json.dumps(draft, indent=1).encode())
    settings = st.load_settings()
    if _relink(settings.get("song_folders"), old, new):
        st.save_settings(settings)
    return {"path": new_rel, "shows": shows}
