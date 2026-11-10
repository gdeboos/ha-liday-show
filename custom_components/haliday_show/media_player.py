"""One media player for HA-liday Show: what's playing, its song and cover art, and Play / Stop / Next."""
from __future__ import annotations

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
        self._position_at: datetime | None = None
        self._last_key = None

    @property
    def _now(self) -> dict | None:
        return self.state_data.get("playing")

    def _handle_coordinator_update(self) -> None:
        now = self._now
        key = (now["show"], now.get("started"), round(now["position"])) if now else None
        if key != self._last_key:
            self._position_at = dt_util.utcnow() if now else None
            self._last_key = key
        super()._handle_coordinator_update()

    @property
    def state(self) -> MediaPlayerState:
        return MediaPlayerState.PLAYING if self._now else MediaPlayerState.IDLE

    @property
    def media_title(self) -> str | None:
        return self._now["name"] if self._now else None

    @property
    def media_artist(self) -> str | None:
        song = (self._now or {}).get("song")
        return song["title"] if song else None

    @property
    def media_album_name(self) -> str | None:
        return (self._now or {}).get("playlist")

    @property
    def media_duration(self) -> float | None:
        return (self._now or {}).get("duration") or None

    @property
    def media_position(self) -> float | None:
        return self._now["position"] if self._now else None

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
        return f"{song['source']}:{song['path']}" if song else None

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
