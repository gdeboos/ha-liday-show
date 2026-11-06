import json

import pytest

from halidayshow import archive, migrate, server
from halidayshow.storage import Storage

WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\0" * 32


def _st(tmp_path) -> Storage:
    st = Storage(tmp_path / "config", tmp_path / "media")
    (st.upload_dir).mkdir(parents=True, exist_ok=True)
    return st


def _part(tmp_path, name="p.wav") -> "Path":  # noqa: F821
    p = tmp_path / name
    p.write_bytes(WAV)
    return p


def test_a_song_keeps_its_parts_until_its_file_changes(tmp_path):
    st = _st(tmp_path)
    song = st.upload_dir / "carol.mp3"
    song.write_bytes(b"ID3song")
    rel = "haliday_show/carol.mp3"
    assert st.song_parts("media", rel) == {}
    path = st.save_part("media", rel, "vocals", _part(tmp_path))
    assert path.startswith("haliday_show/.parts/") and path.endswith("/vocals.wav")
    assert st.song_parts("media", rel) == {"vocals": path}
    assert st.audio_path("media", path) is not None  # plays like any song
    # Parts aren't songs in their own right.
    listed = st.list_audio()
    assert [r["path"] for r in listed] == [rel] and listed[0]["parts"] == {"vocals": path}
    assert st.save_part("media", rel, "nope", _part(tmp_path)) is None
    assert st.save_part("media", "haliday_show/gone.mp3", "vocals", _part(tmp_path)) is None
    # Saved over (an edit made again): its old parts no longer count, and go when it gets new ones.
    song.write_bytes(b"ID3song, longer now")
    assert st.song_parts("media", rel) == {}
    st.save_part("media", rel, "drums", _part(tmp_path))
    assert set(st.song_parts("media", rel)) == {"drums"}


def test_parts_follow_their_song(tmp_path):
    st = _st(tmp_path)
    (st.upload_dir / "carol.mp3").write_bytes(b"ID3song")
    rel = "haliday_show/carol.mp3"
    vocals = st.save_part("media", rel, "vocals", _part(tmp_path))
    st.save_draft("d1", {"name": "d", "base": {"source": "media", "path": rel}, "pieces": [],
                         "layers": [{"clips": [{"song": {"source": "media", "path": vocals}}]}]})
    # Copied: the copy has its own.
    copy = archive.copy_song(st, rel)["path"]
    assert set(st.song_parts("media", copy)) == {"vocals"}
    # Renamed: they move, and a layer of its vocals follows.
    new = archive.rename_song(st, rel, "Carol (live)")["path"]
    moved = st.song_parts("media", new)["vocals"]
    assert moved != vocals and st.song_parts("media", rel) == {}
    assert st.load_draft("d1")["layers"][0]["clips"][0]["song"]["path"] == moved
    # Archived and back: still there. Deleted: gone.
    a = archive.archive_song(st, new)["archived"]
    assert st.song_parts("media", new) == {}
    archive.restore_song(st, a)
    assert set(st.song_parts("media", new)) == {"vocals"}
    archive.delete_song(st, new)
    assert not st.parts_dir("media", new).exists()


def test_old_split_vocals_become_their_songs_parts(tmp_path):
    st = _st(tmp_path)
    (st.media_dir / "Xmas").mkdir()
    (st.media_dir / "Xmas" / "Carol.mp3").write_bytes(b"ID3song")
    (st.upload_dir / "Carol (vocals).wav").write_bytes(WAV)  # where Split vocals saved them
    (st.upload_dir / "Carol (music).wav").write_bytes(WAV)
    (st.upload_dir / "Bells.mp3").write_bytes(b"ID3bells")
    (st.upload_dir / "Bells (vocals).wav").write_bytes(WAV)
    (st.upload_dir / "Nobody (vocals).wav").write_bytes(WAV)  # its song's gone: stays a song
    st.save_show("s1", {"name": "s", "audio": {"source": "media", "path": "haliday_show/Carol (vocals).wav"}, "tracks": []})
    moved = migrate.splits_to_parts(st)
    assert len(moved) == 3
    parts = st.song_parts("media", "Xmas/Carol.mp3")
    assert set(parts) == {"vocals", "music"}
    assert set(st.song_parts("media", "haliday_show/Bells.mp3")) == {"vocals"}
    names = sorted(r["path"] for r in st.list_audio())
    assert names == ["Xmas/Carol.mp3", "haliday_show/Bells.mp3", "haliday_show/Nobody (vocals).wav"]
    assert st.load_show("s1")["audio"]["path"] == parts["vocals"]
    assert migrate.splits_to_parts(st) == []  # once only


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    media = tmp_path / "media"
    (media / "haliday_show").mkdir(parents=True)
    (media / "haliday_show" / "tune.mp3").write_bytes(b"ID3fake")
    return await aiohttp_client(server.make_app(tmp_path / "config", media, allow_all=True))


async def test_parts_are_sent_and_listed(client):
    q = "source=media&path=haliday_show/tune.mp3"
    assert await (await client.get(f"/api/audio/parts?{q}")).json() == {}
    up = "upload=abcdefabcdefabcdefabcdef"
    r = await client.post(f"/api/audio/parts?{q}&part=vocals&{up}&offset=0&done=1", data=WAV)
    assert r.status == 200
    path = (await r.json())["path"]
    assert await (await client.get(f"/api/audio/parts?{q}")).json() == {"vocals": path}
    assert (await client.get(f"/api/audio/file?source=media&path={path}")).status == 200
    songs = await (await client.get("/api/audio")).json()
    assert songs == [{"source": "media", "path": "haliday_show/tune.mp3", "parts": {"vocals": path}}]
    assert (await client.post(f"/api/audio/parts?{q}&part=other&{up}&offset=0&done=1", data=WAV)).status == 404
    assert (await client.post(f"/api/audio/parts?{q}&part=drums&{up}&offset=0&done=1", data=b"not a wav")).status == 400
    assert (await client.post(f"/api/audio/parts?source=media&path=x.mp3&part=drums&{up}&offset=0&done=1", data=WAV)).status == 404


def test_a_split_that_cant_move_leaves_the_rest_linked(tmp_path, monkeypatch):
    st = _st(tmp_path)
    for name in ("A", "B"):
        (st.upload_dir / f"{name}.mp3").write_bytes(b"ID3" + name.encode())
        (st.upload_dir / f"{name} (vocals).wav").write_bytes(WAV)
        st.save_show(name, {"name": name, "audio": {"source": "media", "path": f"haliday_show/{name} (vocals).wav"}, "tracks": []})
    real = st.save_part

    def flaky(source, rel, name, src):
        if rel.endswith("B.mp3"):
            raise OSError("disk full")
        return real(source, rel, name, src)

    monkeypatch.setattr(st, "save_part", flaky)
    moved = migrate.splits_to_parts(st)
    assert [m["from"] for m in moved] == ["haliday_show/A (vocals).wav"]
    assert st.load_show("A")["audio"]["path"] == st.song_parts("media", "haliday_show/A.mp3")["vocals"]
    assert st.load_show("B")["audio"]["path"] == "haliday_show/B (vocals).wav"  # still there, still a song
    # A show put back to the old path (a restore from an older backup, say) is put right next start.
    show = st.load_show("A")
    show["audio"]["path"] = "haliday_show/A (vocals).wav"
    st.save_show("A", show)
    monkeypatch.setattr(st, "save_part", real)
    migrate.splits_to_parts(st)
    assert st.load_show("A")["audio"]["path"] == st.song_parts("media", "haliday_show/A.mp3")["vocals"]


def test_an_archived_songs_parts_stay_its_own(tmp_path):
    st = _st(tmp_path)
    (st.upload_dir / "carol.mp3").write_bytes(b"ID3song")
    rel = "haliday_show/carol.mp3"
    st.save_part("media", rel, "vocals", _part(tmp_path))
    a = archive.archive_song(st, rel)["archived"]
    # A new song saved where it was, with parts of its own.
    (st.upload_dir / "carol.mp3").write_bytes(b"ID3 another carol")
    st.save_part("media", rel, "drums", _part(tmp_path, "d.wav"))
    back = archive.restore_song(st, a)["path"]
    assert back != rel
    assert set(st.song_parts("media", back)) == {"vocals"}
    assert set(st.song_parts("media", rel)) == {"drums"}


async def test_what_a_song_sounds_like_is_kept_with_it(client):
    q = "source=media&path=haliday_show/tune.mp3"
    assert await (await client.get(f"/api/audio/sounds?{q}")).json() is None
    up = "upload=abcdefabcdefabcdefabcdef"
    await client.post(f"/api/audio/parts?{q}&part=vocals&{up}&offset=0&done=1", data=WAV)
    assert "sounds" not in (await (await client.get("/api/audio")).json())[0]
    body = {"step": 0.5, "sounds": {"sleighbells": [0, 40, 55], "happy": [10, 10, 12]}}
    assert (await client.put(f"/api/audio/sounds?{q}", json=body)).status == 200
    assert await (await client.get(f"/api/audio/sounds?{q}")).json() == body
    assert (await (await client.get("/api/audio")).json())[0]["sounds"] is True
    # Nothing heard is still kept, so it isn't listened to again.
    assert (await client.put(f"/api/audio/sounds?{q}", json={"step": 0.5, "sounds": {}})).status == 200
    assert await (await client.get(f"/api/audio/sounds?{q}")).json() == {"step": 0.5, "sounds": {}}
    for bad in ({"step": 0.5, "sounds": {"kazoo": [1]}}, {"step": 0.5, "sounds": {"choir": [101]}},
                {"step": True, "sounds": {}}, {"step": 0.5, "sounds": {"choir": [1.5]}}, {"sounds": {}}, []):
        assert (await client.put(f"/api/audio/sounds?{q}", json=bad)).status == 400, bad
    assert (await client.put("/api/audio/sounds?source=media&path=gone.mp3", json=body)).status == 404


def test_the_server_knows_every_sound_the_editor_does():
    import re
    from pathlib import Path
    js = (Path(server.__file__).parent / "static" / "js" / "sounds.js").read_text()
    block = js[js.index("export const SOUNDS = {"):js.index("};", js.index("export const SOUNDS = {"))]
    assert set(re.findall(r"^  (\w+): \{", block, re.M)) == server.SOUND_KEYS
