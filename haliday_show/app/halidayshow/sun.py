"""Sunset times, for playlists that start at sunset.

NOAA's general solar position formula: within a couple of minutes, which is plenty for a light
show, with nothing to install.
"""
import math
from datetime import date, datetime, time, timedelta, timezone


def sunset_utc(d: date, lat: float, lon: float) -> datetime | None:
    """When the sun sets on day d at that place (east is positive), in UTC; None in polar day or night."""
    g = 2 * math.pi / 365 * (d.timetuple().tm_yday - 1 + 0.5)  # the year as an angle, at midday
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                       - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    phi = math.radians(lat)
    c = math.cos(math.radians(90.833)) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
    if not -1 <= c <= 1:
        return None
    minutes = 720 - 4 * (lon - math.degrees(math.acos(c))) - eqtime
    return datetime.combine(d, time(0), tzinfo=timezone.utc) + timedelta(minutes=minutes)


def sunset_local(d: date, lat: float, lon: float) -> datetime | None:
    """Sunset on day d on this machine's clock, without a time zone (as schedules are written)."""
    utc = sunset_utc(d, lat, lon)
    return utc.astimezone().replace(tzinfo=None, second=0, microsecond=0) if utc else None
