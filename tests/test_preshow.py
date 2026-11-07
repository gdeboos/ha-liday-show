import datetime

from halidayshow import preshow
from halidayshow.output import blink_frame, chase_frame, chase_lap


class FakeHA:
    available = True

    def __init__(self, states):
        self.states = states

    async def state(self, entity):
        if entity not in self.states:
            raise Exception("404: not found")
        return {"state": self.states[entity]}


def light(i, kind="govee", **kw):
    d = {"id": f"l{i}", "name": f"Light {i}", "kind": kind, "ip": f"192.168.1.{i}"}
    return {**d, **kw}


async def test_every_kind_of_light_is_asked_its_own_way():
    devices = [light(1), light(2), light(3, "wled"), light(4, "ddp"), light(5, "ha", ip="", entity="light.porch"),
               light(6, "ha", ip="", entity="switch.reindeer"), light(7, ip=""), light(8)]

    async def scan():
        return [{"ip": "192.168.1.1"}, {"ip": "192.168.1.8"}]

    async def wled_ok(ip):
        return True

    lines, look = await preshow.lights(devices, {"l8"}, FakeHA({"light.porch": "on", "switch.reindeer": "unavailable"}),
                                       scan=scan, ask_wled=wled_ok)
    text = [x["text"] for x in lines]
    assert [x["level"] for x in lines] == ["fail", "fail", "ok", "info", "info", "info"]  # problems first
    assert {"level": "ok", "text": "Light 1, Light 3 and Light 5 answered."} in lines
    assert "Light 4 can't be asked over the network, so watch it in the next step." in text
    assert {"level": "fail", "text": "Light 2 didn't answer.", "fix": preshow.NO_ANSWER_FIX["govee"]} in lines
    assert any(x["level"] == "fail" and x["text"].startswith("Light 6 is unavailable") for x in lines)
    assert "Light 7 is planned, not linked to a real light yet, so it's left out." in text
    assert "Light 8 is packed away, so it's left out." in text
    # Flashed next: those that answered and those that can't be asked, never the gone or left out.
    assert look == ["l1", "l3", "l4", "l5"]


async def test_lights_sharing_a_wled_ask_it_once():
    # Three strings on one WLED (a light per segment): its web server drops requests that arrive
    # together, so one question answers for all of them.
    devices = [light(1, "wled", segment=0), light(2, "wled", first=151, segment=1),
               light(3, "wled", first=211, segment=2)]
    for d in devices:
        d["ip"] = "192.168.2.50"
    asked = []

    async def wled_once(ip):
        asked.append(ip)
        return len(asked) == 1  # a second request at the same time gets nothing back

    lines, look = await preshow.lights(devices, set(), ask_wled=wled_once)
    assert asked == ["192.168.2.50"]
    assert look == ["l1", "l2", "l3"]
    assert lines[0] == {"level": "ok", "text": "All 3 lights answered."}


async def test_all_answering_says_so_in_a_line():
    async def scan():
        return [{"ip": "192.168.1.1"}, {"ip": "192.168.1.2"}]
    lines, look = await preshow.lights([light(1), light(2)], set(), scan=scan)
    assert lines == [{"level": "ok", "text": "All 2 lights answered."}] and look == ["l1", "l2"]
    lines, _ = await preshow.lights([], set())
    assert preshow.worst(lines) == "fail"


async def test_without_home_assistant_its_lights_are_watched_instead():
    class Off:
        available = False
    lines, look = await preshow.lights([light(5, "ha", ip="", entity="light.porch")], set(), Off())
    assert lines[0]["level"] == "warn" and look == ["l5"]


def page(**kw):
    p = {"address": "https://lights.example.com", "hours": {"on": True}}
    args = dict(running=True, error=None, hours={"open": True}, answers=True, outside="", waiting=0,
                picks=[{"kind": "show", "available": True}, {"kind": "show", "available": True}])
    return preshow.page_lines(p, **{**args, **kw})


def test_the_visitors_page_is_checked_as_visitors_meet_it():
    good = page()
    assert preshow.worst(good) == "ok"
    assert "Visitors have 2 shows to pick from." in [x["text"] for x in good]
    assert page(running=False, error="couldn't open port 8098")[0]["level"] == "fail"
    assert preshow.worst(page(answers=False)) == "fail"
    assert preshow.worst(page(outside=None)) == "warn"
    assert preshow.worst(page(outside="no answer")) == "warn"
    assert preshow.worst(page(picks=[{"kind": "show", "available": False}])) == "fail"
    later = datetime.date.today().isoformat() + "T17:00"
    assert "The visitors' page opens at 17:00 tonight." in [x["text"] for x in page(hours={"open": False, "next": later})]
    assert preshow.worst(page(hours={"open": False, "next": "2099-01-01T17:00"})) == "warn"


def test_how_shows_start_checks_only_what_is_set_up():
    ok, warn = preshow.line("ok", "fine"), preshow.line("warn", "hmm")
    summary, items = preshow.starting(False, [], False, [])
    assert summary["level"] == "warn" and items == []  # neither: amber, as you may start them yourself
    summary, items = preshow.starting(True, [ok], False, [])
    assert summary == {"level": "ok", "text": "Shows start from the visitors' page."} and items == [ok]
    summary, _ = preshow.starting(False, [], True, [warn])
    assert summary["text"] == "Shows start from the schedule."
    summary, _ = preshow.starting(True, [preshow.line("fail", "broken")], True, [ok])
    assert summary["level"] == "fail"


def test_tonights_schedule():
    today = datetime.date.today().isoformat()
    slot = lambda day, lane="show", plays=True: {"day": day, "lane": lane,
                                                 "plays": [f"{day}T18:30", f"{day}T22:00"] if plays else None}
    assert preshow.schedule_lines([slot(today)], today)[0] == {"level": "ok", "text": "The schedule starts a show tonight, from 18:30."}
    for slots in ([], [slot("2099-01-01")], [slot(today, "scene")], [slot(today, plays=False)]):
        assert preshow.schedule_lines(slots, today)[0]["level"] == "warn"


def test_the_sound_is_checked_where_it_comes_from():
    picks = [{"kind": "show", "available": True, "speaker": False}]
    lines = preshow.sound_lines(page_on=True, listen=True, picks=picks, missing_songs=[], speakers={}, can_shrink=True)
    assert preshow.worst(lines) == "ok"
    # No speaker, and phones can't listen: visitors hear nothing.
    assert preshow.worst(preshow.sound_lines(page_on=True, listen=False, picks=picks, missing_songs=[], speakers={},
                                             can_shrink=True)) == "warn"
    assert preshow.worst(preshow.sound_lines(page_on=True, listen=True, picks=picks, missing_songs=["Carol"],
                                             speakers={}, can_shrink=True)) == "fail"
    assert preshow.worst(preshow.sound_lines(page_on=False, listen=False, picks=[], missing_songs=[],
                                             speakers={"Kitchen": "gone"}, can_shrink=True)) == "fail"
    nothing = preshow.sound_lines(page_on=False, listen=False, picks=[], missing_songs=[], speakers={}, can_shrink=True)
    assert nothing[0]["level"] == "info" and "off" in nothing[0]["text"]
    no_picks = preshow.sound_lines(page_on=True, listen=False, picks=[], missing_songs=[], speakers={}, can_shrink=True)
    assert no_picks == [preshow.line("info", "Phone listening is off, and none of the visitors' picks plays on a speaker yet.")]


def test_blink_and_chase():
    assert blink_frame(3, 0.1) == b"\xff" * 9 and blink_frame(3, 1.0) == b"\0" * 9
    lit = lambda f: [i for i in range(len(f) // 3) if f[i * 3]]
    assert lit(chase_frame(80, 0)) == [0]
    lap = chase_lap(80)
    assert lit(chase_frame(80, lap * 0.999))[-1] == 79  # reaches the last segment
    assert len(lit(chase_frame(80, lap / 2))) == 2  # a short bar, 80 // 40 wide
