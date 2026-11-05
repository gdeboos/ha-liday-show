"""Report a problem (Help → Report a problem…): what a bug report needs, with anything that could
identify the house or its owner taken out, as GitHub issues are public.

The last warnings and errors are kept in memory only (never written anywhere), from when the app
started. Everything sent to the editor goes through scrub() first.
"""
import collections
import logging
import os
import re
import time
import traceback
from pathlib import Path

MAX_LINES = 50
MAX_LINE = 400
_recent: collections.deque = collections.deque(maxlen=MAX_LINES)


class _Keep(logging.Handler):
    def emit(self, record):
        try:
            text = record.getMessage()
            if record.exc_info and record.exc_info[0]:
                text += " | " + "".join(traceback.format_exception_only(*record.exc_info[:2])).strip()
            stamp = time.strftime("%H:%M:%S", time.localtime(record.created))
            _recent.append(f"{stamp} {record.levelname} {record.name}: {text}"[:MAX_LINE])
        except Exception:  # a report is never worth breaking logging for
            pass


_handler: _Keep | None = None


def keep_recent():
    """Starts keeping warnings and errors (once, however many apps are made, as in the tests)."""
    global _handler
    if _handler is None:
        _handler = _Keep(level=logging.WARNING)
        logging.getLogger().addHandler(_handler)


def recent() -> list[str]:
    return list(_recent)


def install() -> str:
    if os.environ.get("SUPERVISOR_TOKEN"):
        return "Home Assistant app"
    if os.environ.get("HALIDAY_SHOW_INSTALL") == "python":
        return "Python (pipx)"
    return "Docker" if Path("/.dockerenv").exists() else "Python"


KIND_NAMES = {"govee": "Govee", "wled": "WLED", "ddp": "DDP", "e131": "E1.31", "twinkly": "Twinkly",
              "ha": "Home Assistant"}


def lights(devices: list[dict]) -> str:
    """"3 Govee (H70C5, H706A), 1 WLED, 2 planned": kinds and models only, never names or addresses."""
    by: dict[str, list[dict]] = {}
    planned = 0
    for d in devices:
        if not (d.get("ip") or d.get("entity")):
            planned += 1
            continue
        by.setdefault(d.get("kind") or "govee", []).append(d)
    parts = []
    for kind, ds in by.items():
        models = sorted({str(d.get("sku") or "")[:12] for d in ds} - {""}) if kind == "govee" else []
        if kind == "ha":
            switches = sum(d.get("protocol") == "ha_switch" for d in ds)
            models = [x for x in (f"{len(ds) - switches} light" if len(ds) - switches else "",
                                  f"{switches} switch" if switches else "") if x]
        parts.append(f"{len(ds)} {KIND_NAMES.get(kind, kind)}" + (f" ({', '.join(models)})" if models else ""))
    if planned:
        parts.append(f"{planned} planned")
    return ", ".join(parts) or "none yet"


_PATTERNS = [
    (re.compile(r"https?://[^\s\"'<>)]+"), "<address>"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5,7}[0-9A-Fa-f]{2}\b"), "<device>"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "<ip>"),
    # IPv6: four or more groups, or shortened with "::" (never a time such as 17:18:53).
    (re.compile(r"\b(?:[0-9A-Fa-f]{1,4}:){4,7}[0-9A-Fa-f]{1,4}\b"), "<ip>"),
    (re.compile(r"(?:\b[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*)?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4})*\b)?"), "<ip>"),
    (re.compile(r"\b(?:light|switch|media_player|sensor|binary_sensor|scene|script|automation|input_[a-z_]+|"
                r"ai_task|conversation|tts|select|number|button|stt|wake_word|assist_satellite)\.[a-z0-9_]+\b"), "<entity>"),
    # A song file's name, spaces and all, back to the folder it's in (or the start of the phrase).
    (re.compile(r"[^\n\"'/\\:()<>,]*?\.(?:mp3|m4a|wav|flac|ogg|oga|opus|aac|webm)\b", re.IGNORECASE), "<song>"),
    (re.compile(r"\b[A-Za-z0-9_\-.]{40,}\b"), "<token>"),
]


def scrub(text: str, secrets=()) -> str:
    """Takes out addresses, device and entity ids, song names, tokens, your own folders and the
    secrets given (the public code and PINs)."""
    text = str(text)
    for folder, name in ((os.environ.get("HALIDAY_SHOW_MEDIA"), "<media>"), (os.environ.get("HALIDAY_SHOW_CONFIG"), "<config>"),
                         (str(Path.home()), "~")):
        if folder and len(folder) > 1:
            text = text.replace(folder, name)
    for pattern, put in _PATTERNS:
        text = pattern.sub(put, text)
    for s in secrets:
        if s and len(s) >= 4:
            text = text.replace(s, "<secret>")
    return text
