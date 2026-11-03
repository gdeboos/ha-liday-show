"""Late at night, for the neighbours: from a time you set until the morning, the speaker plays quieter,
or not at all (the lights still play, and visitors can listen on their phones).

Saved in settings as "late_speaker": {"from": "21:00" or "" (off), "until": "07:00", "mode": "quieter" |
"off", "volume": 30 (percent, for "quieter")}.
"""
import re
from datetime import datetime

DEFAULT = {"from": "", "until": "07:00", "mode": "quieter", "volume": 30}
MODES = ("quieter", "off")
_TIME = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")


def clean(x) -> dict:
    x = x if isinstance(x, dict) else {}
    start = str(x.get("from") or "")
    until = str(x.get("until") or "")
    try:
        volume = int(x.get("volume", DEFAULT["volume"]))
    except (TypeError, ValueError):
        volume = DEFAULT["volume"]
    return {"from": start if _TIME.match(start) else "",
            "until": until if _TIME.match(until) else DEFAULT["until"],
            "mode": x.get("mode") if x.get("mode") in MODES else DEFAULT["mode"],
            "volume": min(max(volume, 5), 100)}


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def now_late(settings: dict, now: datetime | None = None) -> dict | None:
    """The late rule in force now ({mode, volume}), or None in the daytime or when it's off."""
    late = clean(settings.get("late_speaker"))
    if not late["from"]:
        return None
    now = now or datetime.now()
    t, a, b = now.hour * 60 + now.minute, _minutes(late["from"]), _minutes(late["until"])
    inside = (a <= t < b) if a < b else (t >= a or t < b)  # usually past midnight, 9pm until 7am
    return {"mode": late["mode"], "volume": late["volume"]} if inside and a != b else None
