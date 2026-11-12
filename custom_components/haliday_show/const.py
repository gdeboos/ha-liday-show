"""Constants for the HA-liday Show integration."""
DOMAIN = "haliday_show"
API = 1  # must match halidayshow/integration.py API in the app
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8099
DEVICE_ID = "haliday_show"  # one device, as the MQTT entities had
EVENT_SIGNAL = "haliday_show_event"


def registry_entries(items, get) -> list:
    """Every entry in a device or entity registry, on old and new Home Assistants alike.

    Using the registry's lists as a mapping (.values(), .get_entries()) is deprecated from 2026.11 and
    stops working in 2027.9; going through them one by one isn't. Older versions give ids when you do
    that, newer ones give the entries, so ids are looked up with the registry's own async_get."""
    out = []
    for item in list(items):
        entry = get(item) if isinstance(item, str) else item
        if entry is not None:
            out.append(entry)
    return out
