"""One media player for HA-liday Show: what's playing, its song and cover art, and Play / Stop / Next."""
from __future__ import annotations

import hashlib
from datetime import datetime

from homeassistant.components.media_player import (MediaPlayerEntity, MediaPlayerEntityFeature, MediaPlayerState,
                                                   MediaType)
from homeassistant.util import dt as dt_util

from .entity import HalidayEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([ShowPlayer(entry)])


class ShowPlayer(HalidayEntity, MediaPlayerEntity):
    _attr_name = "Player"
    _attr_icon = "mdi:string-lights"
    _attr_media_content_type = MediaType.MUSIC
    _attr_supported_features = (MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.STOP
                                | MediaPlayerEntityFeature.NEXT_TRACK | MediaPlayerEntityFeature.SELECT_SOURCE)

    def __init__(self, entry) -> None:
        super().__init__(entry, "player")
        self._position: float | None = None
        self._position_at: datetime | None = None
        self._playing_key = None

    @property
    def _now(self) -> dict | None:
        return self.state_data.get("playing")

    def _handle_coordinator_update(self) -> None:
        """Keep the reported position (and its time) unless a new show started or it's drifted, so the
        state isn't rewritten every second: Home Assistant works the position out from the two."""
        now = self._now
        key = (now["show"], now.get("started")) if now else None
        if not now:
            self._position = self._position_at = None
        else:
            stamp = dt_util.utcnow()
            expected = (self._position or 0) + ((stamp - self._position_at).total_seconds() if self._position_at else 0)
            if key != self._playing_key or abs(now["position"] - expected) > 2:
                self._position, self._position_at = now["position"], stamp
        self._playing_key = key
        super()._handle_coordinator_update()

    @property
    def state(self) -> MediaPlayerState:
        return MediaPlayerState.PLAYING if self._now else MediaPlayerState.IDLE

    @property
    def media_title(self) -> str | None:
        """The song, with the show as the artist; the show itself when it has no song."""
        if not self._now:
            return None
        return (self._now.get("song") or {}).get("title") or self._now["name"]

    @property
    def media_artist(self) -> str | None:
        return self._now["name"] if self._now and self._now.get("song") else None

    @property
    def media_album_name(self) -> str | None:
        return (self._now or {}).get("playlist")

    @property
    def media_duration(self) -> float | None:
        return (self._now or {}).get("duration") or None

    @property
    def media_position(self) -> float | None:
        return self._position

    @property
    def media_position_updated_at(self) -> datetime | None:
        return self._position_at

    @property
    def source_list(self) -> list[str]:
        return [s["name"] for s in self.state_data.get("shows", [])]

    @property
    def source(self) -> str | None:
        return next((s["name"] for s in self.state_data.get("shows", [])
                     if s["id"] == self.state_data.get("selected_show")), None)

    @property
    def media_image_hash(self) -> str | None:
        song = (self._now or {}).get("song")
        if not song or not song.get("cover"):
            return None
        return hashlib.sha1(f"{song['source']}:{song['path']}".encode()).hexdigest()[:16]

    async def async_get_media_image(self) -> tuple[bytes | None, str | None]:
        song = (self._now or {}).get("song")
        got = await self.client.cover(song["source"], song["path"]) if song else None
        return got if got else (None, None)

    async def async_select_source(self, source: str) -> None:
        show = next((s for s in self.state_data.get("shows", []) if s["name"] == source), None)
        if show:
            await self.send("select_show", show=show["id"])

    async def async_media_play(self) -> None:
        await self.send("play")

    async def async_media_stop(self) -> None:
        await self.send("stop")

    async def async_media_next_track(self) -> None:
        await self.send("skip")
