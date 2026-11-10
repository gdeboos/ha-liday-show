"""The pre-show check (Setup → Devices): what can be checked without anyone looking.

Every light that can be asked whether it's there is asked; how tonight's shows will start is checked
only as far as it's set up (the visitors' page, the schedule, both or neither); and the sound, by a
speaker where a show uses one, else by phones listening. Each line is {"level", "text", "fix"?}, level
being "ok", "warn", "fail" or "info" (not a problem: skipped, or nothing to ask). The editor then
flashes each light in turn for you to confirm, and keeps the last result (settings "preshow").
"""
import asyncio
import datetime
import logging

import aiohttp

from . import discovery, twinkly, wled

log = logging.getLogger(__name__)

ASK_TIMEOUT_S = 4.0
LEVELS = ("ok", "info", "warn", "fail")  # worst last


def line(level: str, text: str, fix: str = "") -> dict:
    return {"level": level, "text": text, **({"fix": fix} if fix else {})}


def worst(lines: list[dict]) -> str:
    return max((x["level"] for x in lines), key=LEVELS.index, default="ok")


def names(ds: list[dict]) -> str:
    """"Porch", "Porch and Tree", "Porch, Tree and Fence"."""
    n = [d["name"] for d in ds]
    return n[0] if len(n) == 1 else ", ".join(n[:-1]) + " and " + n[-1]


# lights ------------------------------------------------------------------------------------------
NO_ANSWER_FIX = {
    "govee": "Check it's plugged in and switched on, and that LAN Control is on for it in the Govee Home app.",
    "wled": "Check it's plugged in and on your Wi-Fi: its own page should open at its IP address.",
    "twinkly": "Check it's plugged in and on your Wi-Fi.",
}


async def _ask_wled(ip: str) -> bool:
    try:
        await wled.fetch(ip, timeout=ASK_TIMEOUT_S)
        return True
    except Exception:
        return False


async def _ask_twinkly(ip: str) -> bool:
    try:
        await asyncio.wait_for(twinkly.fetch(ip), ASK_TIMEOUT_S)
        return True
    except Exception:
        return False


async def _ask_ha(ha, entity: str) -> str:
    """"ok", "gone" (unavailable or unknown to Home Assistant) or "unknown" (couldn't ask)."""
    if ha is None or not ha.available:
        return "unknown"
    try:
        st = await asyncio.wait_for(ha.state(entity), ASK_TIMEOUT_S)
    except Exception as e:
        return "gone" if "404" in str(e) else "unknown"
    return "gone" if st.get("state") in ("unavailable", "unknown", None) else "ok"


async def lights(devices: list[dict], away: set[str], ha=None, *, scan=discovery.scan, ask_wled=_ask_wled,
                 ask_twinkly=_ask_twinkly) -> tuple[list[dict], list[str]]:
    """Asks each light whether it's there. Returns the lines, and the ids of the lights to flash next
    (those that answered, and those that can't be asked, such as pixel controllers)."""
    out, look, answered = [], [], []
    real = []
    devices = [{**d, "name": d.get("name") or d.get("ip") or d["id"]} for d in devices]
    for d in devices:
        if not (d.get("ip") or d.get("entity")):
            out.append(line("info", f"{d['name']} is planned, not linked to a real light yet, so it's left out."))
        elif d["id"] in away:
            out.append(line("info", f"{d['name']} is packed away, so it's left out."))
        else:
            real.append(d)
    kind = lambda d: d.get("kind") or "govee"
    govee = [d for d in real if kind(d) == "govee"]
    found = set()
    if govee:
        try:
            found = {r["ip"] for r in await scan()}
        except Exception as e:
            log.warning("pre-show check: scan failed: %s", e)
    # One question per controller: several lights can share a WLED (a light per segment), and its
    # small web server drops requests that arrive together, so asking per light made all but one
    # look unreachable.
    asks: dict[tuple, asyncio.Task] = {}

    def ask(d):
        k = kind(d)
        key = (k, d.get("ip") or d.get("entity"))
        if key not in asks:
            asks[key] = asyncio.ensure_future(
                ask_wled(d["ip"]) if k == "wled" else ask_twinkly(d["ip"]) if k == "twinkly"
                else _ask_ha(ha, d["entity"]) if k == "ha" else asyncio.sleep(0, result=None))
        return asks[key]

    results = await asyncio.gather(*[ask(d) for d in real])
    quiet = []  # pixel controllers: nothing to ask
    for d, got in zip(real, results):
        k = kind(d)
        if k == "govee":
            got = d["ip"] in found
        if k in ("ddp", "e131"):
            quiet.append(d)
            look.append(d["id"])
        elif k == "ha" and got == "unknown":
            out.append(line("warn", f"Couldn't ask Home Assistant about {d['name']}, so watch it in the next step.",
                            "Check Home Assistant is running."))
            look.append(d["id"])
        elif got is True or got == "ok":
            answered.append(d)
            look.append(d["id"])
        elif k == "ha":
            out.append({**line("fail", f"{d['name']} is unavailable in Home Assistant.",
                                "Check it's plugged in, or look at it under Settings → Devices in Home Assistant."),
                        "light": d["name"]})
        else:
            out.append({**line("fail", f"{d['name']} didn't answer.", NO_ANSWER_FIX[k]), "light": d["name"]})
    if quiet:
        out.insert(0, line("info", f"{names(quiet)} can't be asked over the network, so "
                           f"{'watch it' if len(quiet) == 1 else 'watch them'} in the next step."))
    if answered:
        out.insert(0, line("ok", f"All {len(answered)} lights answered." if len(answered) == len(real) > 1
                           else f"{names(answered)} answered."))
    if not devices:
        out.append(line("fail", "You haven't added any lights yet.", "Press + Add a light."))
    # Problems first, then what's fine, then what was left out.
    order = ("fail", "warn", "ok", "info")
    return sorted(out, key=lambda x: order.index(x["level"])), look


# how shows start tonight ---------------------------------------------------------------------------
def clock(iso: str) -> str:
    return datetime.datetime.fromisoformat(iso).strftime("%H:%M")


def page_lines(p: dict, *, running: bool, error: str | None, hours: dict, picks: list[dict], answers: bool,
               outside: str | None, waiting: int) -> list[dict]:
    """The visitors' page, when it's switched on. `answers`: it gave its state to a request from here.
    `outside`: None with no Public address, "" if the page answered at that address, else what went wrong."""
    restart = "Restart HA-liday Show, then run the check again."
    if not running:
        return [line("fail", "The visitors' page isn't running" + (f": {error}." if error else "."), restart)]
    out = []
    if not answers:
        out.append(line("fail", "The visitors' page didn't answer, so visitors can't pick shows.", restart))
    if outside is None:
        out.append(line("warn", "The visitors' page has no Public address, so only phones on your Wi-Fi can reach it.",
                        "Set up a tunnel and put its address in Public address under Public page."))
    elif outside:
        out.append(line("warn", f"Couldn't reach the visitors' page at {p['address']} from here ({outside}).",
                        "Open the page on your phone with Wi-Fi off to check it from outside."))
    else:
        out.append(line("ok", f"The visitors' page can be reached at {p['address']}."))
    now = [c for c in picks if c.get("available")]
    if not now:
        out.append(line("fail", "Visitors have no shows to pick tonight.",
                        "Add some under Public page. A show needs saving, and mustn't be marked in progress."))
    else:
        one = len(now) == 1
        noun = (("playlist" if one else "playlists") if all(c["kind"] == "playlist" for c in now)
                else ("show" if one else "shows") if all(c["kind"] == "show" for c in now)
                else "shows and playlists")
        out.append(line("ok", f"Visitors have {len(now)} {noun} to pick from."))
    if hours.get("open"):
        out.append(line("ok", "The visitors' page is open now." if p["hours"]["on"]
                        else "The visitors' page is open all the time (no opening hours)."))
    elif hours.get("next") and hours["next"][:10] == datetime.date.today().isoformat():
        out.append(line("ok", f"The visitors' page opens at {clock(hours['next'])} tonight."))
    else:
        nxt = hours.get("next")
        out.append(line("warn", "The visitors' page is closed tonight"
                        + (f": it next opens {datetime.datetime.fromisoformat(nxt).strftime('%A at %H:%M')}." if nxt else "."),
                        "Change its opening hours under Public page if you want it open tonight."))
    if answers:
        out.append(line("ok", "The queue is ready" + (f", with {waiting} waiting now." if waiting else ".")))
    return out


def schedule_lines(slots: list[dict], today: str) -> list[dict]:
    """The schedule, when it has rows switched on: what of tonight's starts shows."""
    tonight = [s for s in slots if s["day"] == today and s["lane"] == "show" and s["plays"]]
    if not tonight:
        return [line("warn", "Nothing on the schedule starts a show tonight.",
                     "Check its days and times under Schedule if you expected one.")]
    first = min(s["plays"][0] for s in tonight)
    return [line("ok", f"The schedule starts {'a show' if len(tonight) == 1 else f'{len(tonight)} lots of shows'} tonight, "
                       f"from {clock(first)}.")]


def starting(page_on: bool, page: list[dict], schedule_on: bool, sched: list[dict]) -> tuple[dict, list[dict]]:
    """The overall "How shows start tonight" line, and the lines under it. Only what's set up is checked:
    neither being on is amber, not red, as you may be starting shows yourself."""
    items = (page if page_on else []) + (sched if schedule_on else [])
    if not page_on and not schedule_on:
        return line("warn", "Nothing will start shows tonight unless you start them yourself or from Home Assistant.",
                    "Switch on the visitors' page, or add a row to the Schedule, if you want shows to start by themselves."), []
    how = " and ".join(x for x, on in (("the visitors' page", page_on), ("the schedule", schedule_on)) if on)
    level = "fail" if worst(items) == "fail" else "ok"
    return line(level, f"Shows start from {how}." if level == "ok"
                else f"Shows start from {how}, but something needs fixing first."), items


# sound -------------------------------------------------------------------------------------------
def sound_lines(*, page_on: bool, listen: bool, picks: list[dict], missing_songs: list[str],
                speakers: dict[str, str], can_shrink: bool) -> list[dict]:
    """`speakers`: each speaker a show uses, by name, and "ok", "gone" or "unknown". The speaker is only
    checked where a show uses one; phones listening only where the visitors' page is on."""
    out = []
    for name, st in speakers.items():
        if st == "ok":
            out.append(line("ok", f"The speaker {name} is ready."))
        elif st == "gone":
            out.append(line("fail", f"The speaker {name} is unavailable in Home Assistant.",
                            "Check it's switched on and on your Wi-Fi."))
        else:
            out.append(line("warn", f"Couldn't ask Home Assistant about the speaker {name}.", "Check Home Assistant is running."))
    if page_on:
        quiet = [c for c in picks if c.get("available") and not c.get("speaker")]
        if listen:
            out.append(line("ok", "Phone listening is on: visitors can hear the music on their phones."))
            if not can_shrink:
                out.append(line("warn", "Songs go to phones at full size, which is slow over mobile data.",
                                "Install ffmpeg where HA-liday Show runs (the app has it already)."))
        elif quiet:
            out.append(line("warn", f"{len(quiet)} of the visitors' picks {'has' if len(quiet) == 1 else 'have'} no speaker, "
                                    "and phone listening is off, so visitors won't hear the music.",
                            "Switch on Listen on your phone under Public page, or give the shows a speaker."))
        elif not speakers:
            out.append(line("info", "Phone listening is off, and none of the visitors' picks plays on a speaker yet."))
        for name in missing_songs:
            out.append(line("fail", f"The song for {name} is missing.", "Open the show and pick its song again."))
    if not out:
        out.append(line("info", "No show uses a speaker and the visitors' page is off, so there's no sound to check."))
    return out


async def reach(url: str, timeout: float = ASK_TIMEOUT_S) -> str:
    """"" if the visitors' page gave its state at `url`, else a few words on what went wrong."""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.get(url) as r:
                if r.status != 200:
                    return f"it answered {r.status}"
                body = await r.json(content_type=None)
    except asyncio.TimeoutError:
        return "no answer"
    except (aiohttp.ClientError, ValueError) as e:
        return str(e)[:80] or "no answer"
    return "" if isinstance(body, dict) and not body.get("locked") else "the code didn't work"
