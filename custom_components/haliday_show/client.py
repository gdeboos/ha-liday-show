"""Talking to the HA-liday Show app: one snapshot, pushed again over a websocket whenever it changes."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

import aiohttp

from .const import API

_LOGGER = logging.getLogger(__name__)


class CannotConnect(Exception):
    """HA-liday Show isn't answering at that address."""


class BadPassword(Exception):
    """HA-liday Show asked for a password and the one given didn't work."""


class TooOld(Exception):
    """HA-liday Show is too old (or too new) for this version of the integration."""


class CommandFailed(Exception):
    """HA-liday Show refused a command, with a message for the user."""


class HalidayClient:
    def __init__(self, session: aiohttp.ClientSession, host: str, port: int, password: str | None = None):
        self.session = session
        self.base = f"http://{host}:{port}"
        self.auth = aiohttp.BasicAuth("ha", password) if password else None
        self._task: asyncio.Task | None = None

    async def _request(self, method: str, path: str, json: Any = None) -> Any:
        try:
            async with self.session.request(method, self.base + path, json=json, auth=self.auth,
                                            timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 401:
                    raise BadPassword
                if resp.status == 400:
                    raise CommandFailed(await resp.text())
                if resp.status >= 300:
                    raise CannotConnect(f"HA-liday Show answered {resp.status}")
                return await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise CannotConnect(str(err)) from err

    async def state(self) -> dict:
        state = await self._request("GET", "/api/integration")
        if not isinstance(state, dict) or state.get("api") != API:
            raise TooOld(state.get("version") if isinstance(state, dict) else None)
        return state

    async def command(self, action: str, **data: Any) -> dict:
        return await self._request("POST", "/api/integration/command", {"action": action, **data})

    async def claim(self, on: bool) -> None:
        await self._request("POST", "/api/integration/claim", {"on": on})

    def listen(self, on_state: Callable[[dict], None], on_lost: Callable[[], None],
               on_event: Callable[[str, dict], None] | None = None) -> None:
        """Follow the app's state (and events) until stop(); reconnects with growing waits."""
        self._task = asyncio.create_task(self._listen(on_state, on_lost, on_event))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _listen(self, on_state, on_lost, on_event) -> None:
        delay = 1
        while True:
            try:
                async with self.session.ws_connect(self.base + "/api/integration/ws", auth=self.auth,
                                                   heartbeat=30) as ws:
                    delay = 1
                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            break
                        data = msg.json()
                        if data.get("type") == "state":
                            on_state(data["state"])
                        elif data.get("type") == "event" and on_event:
                            on_event(str(data.get("event")), data.get("data") or {})
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001 - any failure means "try again shortly"
                _LOGGER.debug("lost HA-liday Show: %s", err)
            on_lost()
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)
