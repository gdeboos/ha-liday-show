from datetime import date, datetime, timezone

from halidayshow.sun import sunset_utc


def close(got, h, m, tolerance_min=3):
    want = got.replace(hour=h, minute=m, second=0, microsecond=0)
    return abs((got - want).total_seconds()) <= tolerance_min * 60


def test_sunset_against_published_times():
    # London, 25 Oct: 16:46 GMT (timeanddate.com). New York, 21 Jun 2026: 20:31 EDT = 00:31 UTC on the 22nd.
    # Sydney, 21 Dec 2026: 20:05 AEDT = 09:05 UTC.
    assert close(sunset_utc(date(2026, 10, 25), 51.5074, -0.1278), 16, 46)
    ny = sunset_utc(date(2026, 6, 21), 40.7128, -74.0060)
    assert ny.date() == date(2026, 6, 22) and close(ny, 0, 31)
    assert close(sunset_utc(date(2026, 12, 21), -33.8688, 151.2093), 9, 5)
    assert sunset_utc(date(2026, 6, 21), 51.5, 0).tzinfo == timezone.utc


def test_no_sunset_in_polar_summer_or_winter():
    assert sunset_utc(date(2026, 6, 21), 78.2, 15.6) is None  # Svalbard: midnight sun
    assert sunset_utc(date(2026, 12, 21), 78.2, 15.6) is None  # polar night
    assert isinstance(sunset_utc(date(2026, 3, 20), 78.2, 15.6), datetime)
