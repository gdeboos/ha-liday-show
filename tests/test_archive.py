import json

import pytest

from halidayshow import archive, backup
from halidayshow.storage import Storage


@pytest.fixture
def st(tmp_path):
    media = tmp_path / "media"
    (media / "haliday_show").mkdir(parents=True)
    (media / "Music").mkdir()
    for p in ("haliday_show/bells.mp3", "haliday_show/carols/manger.mp3", "haliday_show/other.wav", "Music/theirs.mp3"):
        (media / p).parent.mkdir(parents=True, exist_ok=True)
        (media / p).write_bytes(b"ID3 " + p.encode())
    return Storage(tmp_path / "config", media)


def show(st, name, song=None, baked=True):
    show_id = st.new_show_id(name)
    body = {"name": name, "duration": 10, "tracks": []}
    if song:
        body["audio"] = {"source": "media", "path": song}
    st.save_show(show_id, body)
    if baked:
        st.save_baked(show_id, b"BAKE")
    return show_id


def playlists(st, *lists):
    s = st.load_settings()
    s["playlists"] = [{"id": f"p{i}", "name": f"P{i}", "shows": list(ids), "gap": 5} for i, ids in enumerate(lists)]
    st.save_settings(s)


def test_an_archived_show_leaves_every_list_keeps_its_bake_and_its_playlist_places(st):
    xmas = show(st, "Xmas")
    other = show(st, "Other")
    playlists(st, [xmas, other])
    archive.archive_show(st, xmas)
    assert [s["id"] for s in st.list_shows()] == [other]
    assert [s["name"] for s in archive.list_archived_shows(st)] == ["Xmas"]
    assert st.load_settings()["playlists"][0]["shows"] == [xmas, other]  # skipped while archived
    # Its id stays taken, so a new show can't be played in its place.
    assert st.new_show_id("Xmas") == "xmas-2"
    assert archive.restore_show(st, xmas) == {"id": xmas, "name": "Xmas"}
    assert st.load_baked(xmas) == b"BAKE"
    assert archive.list_archived_shows(st) == []


def test_a_restored_show_whose_name_was_taken_meanwhile_is_renamed(st):
    xmas = show(st, "Xmas")
    archive.archive_show(st, xmas)
    show(st, "xmas")  # a new one with the same name, made while the first was archived
    assert archive.restore_show(st, xmas)["name"] == "Xmas (restored)"
    assert st.load_baked(xmas) == b"BAKE", "renaming keeps the bake"


def test_deleting_a_show_takes_it_out_of_playlists(st):
    xmas, other = show(st, "Xmas"), show(st, "Other")
    playlists(st, [xmas, other, xmas], [other])
    archive.archive_show(st, other)
    archive.delete_show(st, other, archived=True)
    archive.delete_show(st, xmas)
    assert [p["shows"] for p in st.load_settings()["playlists"]] == [[], []]
    assert st.list_shows() == [] and archive.list_archived_shows(st) == []
    with pytest.raises(archive.ArchiveError):
        archive.delete_show(st, xmas)
    with pytest.raises(archive.ArchiveError):
        archive.archive_show(st, "../devices")


def test_only_songs_in_haliday_shows_own_folder_can_go(st):
    assert archive.own_song(st, "haliday_show/bells.mp3")
    assert archive.own_song(st, "haliday_show/carols/manger.mp3")
    assert not archive.own_song(st, "Music/theirs.mp3")
    assert not archive.own_song(st, "haliday_show/nope.mp3")
    for fn in (archive.archive_song, archive.delete_song):
        with pytest.raises(archive.ArchiveError):
            fn(st, "Music/theirs.mp3")
    assert (st.media_dir / "Music/theirs.mp3").exists()


def test_archiving_a_song_moves_it_out_of_the_lists_and_leaves_its_shows_songless_until_restored(st):
    a = show(st, "A", "haliday_show/carols/manger.mp3")
    b = show(st, "B", "haliday_show/carols/manger.mp3")
    st.save_song_info("media", "haliday_show/carols/manger.mp3", {"tempo": 90, "beats": [], "bars": [], "sections": []})
    r = archive.archive_song(st, "haliday_show/carols/manger.mp3")
    assert r["archived"] == "haliday_show/Archived/carols/manger.mp3"
    assert {s["id"] for s in r["shows"]} == {a, b}
    assert "audio" not in st.load_show(a) and st.load_baked(a) == b"BAKE"
    listed = [x["path"] for x in st.list_audio()]
    assert "haliday_show/carols/manger.mp3" not in listed and not any("Archived" in p for p in listed)
    [rec] = archive.list_archived_songs(st)
    assert rec["from"] == "haliday_show/carols/manger.mp3" and sorted(rec["songless"]) == ["A", "B"]
    # Give B another song meanwhile; restoring only gives the song back to A.
    archive._set_audio(st, b, {"source": "media", "path": "haliday_show/other.wav"})
    back = archive.restore_song(st, "haliday_show/Archived/carols/manger.mp3")
    assert back["path"] == "haliday_show/carols/manger.mp3" and [s["id"] for s in back["shows"]] == [a]
    assert st.load_show(a)["audio"]["path"] == "haliday_show/carols/manger.mp3"
    assert st.load_show(b)["audio"]["path"] == "haliday_show/other.wav"
    assert st.load_song_info("media", "haliday_show/carols/manger.mp3")["tempo"] == 90, "Detect results come back too"
    assert archive.list_archived_songs(st) == []
    assert not (st.upload_dir / "Archived").exists(), "empty archive folders are tidied away"


def test_a_song_can_hand_its_shows_another_song(st):
    a = show(st, "A", "haliday_show/bells.mp3")
    r = archive.archive_song(st, "haliday_show/bells.mp3", {"source": "media", "path": "haliday_show/other.wav"})
    assert r["shows"] == [{"id": a, "audio": {"source": "media", "path": "haliday_show/other.wav"}}]
    assert archive.list_archived_songs(st)[0]["songless"] == []
    for bad in ({"source": "media", "path": "haliday_show/Archived/bells.mp3"}, {"source": "media", "path": "gone.mp3"},
                {"source": "x", "path": "haliday_show/other.wav"}, "other.wav"):
        with pytest.raises(archive.ArchiveError):
            archive.archive_song(st, "haliday_show/other.wav", bad)


def test_archiving_a_song_twice_with_the_same_name_keeps_both(st):
    archive.archive_song(st, "haliday_show/bells.mp3")
    (st.media_dir / "haliday_show/bells.mp3").write_bytes(b"ID3 new bells")
    r = archive.archive_song(st, "haliday_show/bells.mp3")
    assert r["archived"] == "haliday_show/Archived/bells (2).mp3"
    # Restoring the first while a new bells.mp3 is back puts it beside it.
    (st.media_dir / "haliday_show/bells.mp3").write_bytes(b"ID3 newest")
    assert archive.restore_song(st, "haliday_show/Archived/bells.mp3")["path"] == "haliday_show/bells (2).mp3"


def test_deleting_a_song_for_good(st):
    a = show(st, "A", "haliday_show/bells.mp3")
    st.save_song_info("media", "haliday_show/bells.mp3", {"tempo": 90, "beats": [], "bars": [], "sections": []})
    r = archive.delete_song(st, "haliday_show/bells.mp3")
    assert r["shows"] == [{"id": a, "audio": None}] and "audio" not in st.load_show(a)
    assert not (st.media_dir / "haliday_show/bells.mp3").exists()
    assert not any(st.songs_dir.glob("*.json")), "its Detect results go too"
    archive.archive_song(st, "haliday_show/other.wav")
    archive.delete_song(st, "haliday_show/Archived/other.wav", archived=True)
    assert archive.list_archived_songs(st) == [] and not (st.config_dir / archive.ARCHIVED_SONGS).exists()


def test_exports_include_archived_shows_and_the_song_record(st):
    xmas = show(st, "Xmas")
    archive.archive_show(st, xmas)
    archive.archive_song(st, "haliday_show/bells.mp3")
    names = set(backup._files(st.config_dir))
    assert {f"shows/archived/{xmas}.json", f"shows/archived/{xmas}.gshow", "archived-songs.json"} <= names
    data = backup.export(st.config_dir, "test")
    backup.clear(st.config_dir)
    assert archive.list_archived_shows(st) == []
    backup.restore(st.config_dir, data)
    assert [s["name"] for s in archive.list_archived_shows(st)] == ["Xmas"]
    assert json.loads((st.config_dir / archive.ARCHIVED_SONGS).read_text())


def test_paths_that_escape_haliday_shows_folder_are_refused(st):
    music = st.media_dir / "Music/theirs.mp3"
    for bad in ("haliday_show/../Music/theirs.mp3", "haliday_show/./bells.mp3", "haliday_show//bells.mp3",
                "/etc/passwd", "haliday_show\\bells.mp3", "", None, "haliday_show/notes.txt"):
        assert not archive.own_song(st, bad), bad
        with pytest.raises(archive.ArchiveError):
            archive.archive_song(st, bad)
        with pytest.raises(archive.ArchiveError):
            archive.delete_song(st, bad)
    assert music.exists()


def test_a_link_inside_the_folder_to_a_file_outside_it_is_refused(st):
    link = st.upload_dir / "link.mp3"
    link.symlink_to(st.media_dir / "Music/theirs.mp3")
    linked_dir = st.upload_dir / "linked"
    linked_dir.symlink_to(st.media_dir / "Music", target_is_directory=True)
    for rel in ("haliday_show/link.mp3", "haliday_show/linked/theirs.mp3"):
        assert not archive.own_song(st, rel)
        with pytest.raises(archive.ArchiveError):
            archive.delete_song(st, rel)
    assert (st.media_dir / "Music/theirs.mp3").exists()


def test_a_replacement_cant_be_an_archived_song_however_it_is_written(st):
    archive.archive_song(st, "haliday_show/other.wav")
    for path in ("haliday_show/Archived/other.wav", "haliday_show/./Archived/other.wav",
                 "haliday_show//Archived/other.wav", "haliday_show/carols/../Archived/other.wav"):
        with pytest.raises(archive.ArchiveError):
            archive.archive_song(st, "haliday_show/bells.mp3", {"source": "media", "path": path})
    # Another app's song is fine as a replacement: the show just plays it.
    r = archive.archive_song(st, "haliday_show/bells.mp3", {"source": "media", "path": "Music/theirs.mp3"})
    assert (st.media_dir / "Music/theirs.mp3").exists() and r["archived"]


def test_an_imported_record_pointing_outside_the_archive_is_ignored(st):
    # A hand-edited or foreign export could hold any paths; nothing outside the archive is touched.
    (st.config_dir / archive.ARCHIVED_SONGS).write_text(json.dumps({
        "Music/theirs.mp3": {"path": "haliday_show/x.mp3", "songless": []},
        "haliday_show/Archived/ghost.mp3": {"path": "../outside.mp3", "songless": []},
    }))
    for rel in ("Music/theirs.mp3", "haliday_show/Archived/ghost.mp3"):
        assert not archive.song_deletable(st, rel, archived=True)
        with pytest.raises(archive.ArchiveError):
            archive.delete_song(st, rel, archived=True)
        with pytest.raises(archive.ArchiveError):
            archive.restore_song(st, rel)
    assert (st.media_dir / "Music/theirs.mp3").exists()
    assert archive.list_archived_songs(st) == []


def test_records_of_songs_removed_by_hand_are_dropped(st):
    archive.archive_song(st, "haliday_show/bells.mp3")
    (st.upload_dir / "Archived/bells.mp3").unlink()
    assert archive.list_archived_songs(st) == []
    assert not (st.config_dir / archive.ARCHIVED_SONGS).exists()


def test_copies_are_kept_per_kind_so_deletes_cant_push_out_an_import_copy(st, monkeypatch):
    show(st, "Xmas")
    import itertools
    stamps = (f"20261026-0900{n:02d}" for n in itertools.count())
    monkeypatch.setattr(backup.time, "strftime", lambda fmt, *a: next(stamps) if "%H" in fmt else "x")
    backup.keep_copy(st.config_dir, "t", "import")
    for _ in range(backup.KEEP_COPIES + 3):
        backup.keep_copy(st.config_dir, "t", "delete")
    kinds = [c["reason"] for c in backup.copies(st.config_dir)]
    assert kinds.count("import") == 1 and kinds.count("delete") == backup.KEEP_COPIES


def test_odd_input_is_refused_rather_than_breaking(st):
    for bad in ("haliday_show/a.mp3\0.mp3", "haliday_show/bells.mp3\0"):
        assert not archive.own_song(st, bad)
        with pytest.raises(archive.ArchiveError):
            archive.archive_song(st, "haliday_show/bells.mp3", {"source": "media", "path": bad})
    # A link to the song that's going isn't another song.
    (st.upload_dir / "same.mp3").symlink_to(st.upload_dir / "bells.mp3")
    with pytest.raises(archive.ArchiveError):
        archive.archive_song(st, "haliday_show/bells.mp3", {"source": "media", "path": "haliday_show/same.mp3"})
    # Records of the wrong shape are read as best they can be, never breaking the list.
    archive.archive_song(st, "haliday_show/other.wav")
    data = json.loads((st.config_dir / archive.ARCHIVED_SONGS).read_text())
    data["haliday_show/Archived/other.wav"]["songless"] = 5
    data["bad"] = {"path": "haliday_show/x.mp3", "songless": [["x"]]}
    (st.config_dir / archive.ARCHIVED_SONGS).write_text(json.dumps(data))
    assert [x["path"] for x in archive.list_archived_songs(st)] == ["haliday_show/Archived/other.wav"]
    assert archive.restore_song(st, "haliday_show/Archived/other.wav")["path"] == "haliday_show/other.wav"
