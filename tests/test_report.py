import logging

from halidayshow import report


def test_nothing_that_identifies_the_house_gets_through():
    line = ("couldn't reach 192.168.2.155 (light.porch_left) for /media/haliday_show/Last Christmas.mp3 at "
            "https://lights.example.com/?c=abc12345 from 7C:A6:B0:11:22:33:44:55, fe80::1ff:fe23:4567:890a, "
            "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0, mail me@example.com, PIN 2468")
    out = report.scrub(line, ["abc12345", "2468", ""])
    for gone in ("192.168", "porch", "Last Christmas", "example.com", "7C:A6", "fe80", "eyJ", "2468", "abc12345"):
        assert gone not in out, gone
    assert "<ip>" in out and "<entity>" in out and "<song>" in out and "<address>" in out and "<device>" in out
    assert "Last" not in out
    # Times stay readable.
    assert report.scrub("17:18:53 WARNING x: took 0:02") == "17:18:53 WARNING x: took 0:02"


def test_lights_are_counted_by_kind_and_model_only():
    devices = [{"id": "a", "name": "Pillars", "kind": "govee", "sku": "H70C5", "ip": "192.168.2.155"},
               {"id": "b", "name": "Roof", "kind": "govee", "sku": "H706A", "ip": "192.168.2.156"},
               {"id": "c", "name": "Tree", "kind": "wled", "ip": "10.0.0.5"},
               {"id": "d", "name": "Deer", "kind": "ha", "entity": "switch.deer", "protocol": "ha_switch"},
               {"id": "e", "name": "Arch", "kind": "ddp", "ip": ""}]
    assert report.lights(devices) == "2 Govee (H706A, H70C5), 1 WLED, 1 Home Assistant (1 switch), 1 planned"
    assert report.lights([]) == "none yet"


def test_recent_warnings_are_kept_in_memory():
    report.keep_recent()
    report.keep_recent()  # once only
    logging.getLogger("halidayshow.test").warning("the queue jammed at %s", "10.0.0.9")
    logging.getLogger("halidayshow.test").info("not kept")
    lines = report.recent()
    assert lines[-1].endswith("WARNING halidayshow.test: the queue jammed at 10.0.0.9")
    assert not any("not kept" in x for x in lines)


def test_names_hosts_paths_and_bare_ids_are_taken_out_too():
    names = ["Pillars", "Pillars Left", "Front Yard", "Jingle Bell Rock", "ab"]
    line = ("12:00:01 WARNING halidayshow.runner: wled 'Front Yard' unreachable; KeyError: 'pillars left'; "
            "Cannot connect to host my-house.duckdns.org:443 or homeassistant.local:8123 or foo.trycloudflare.com; "
            "show Jingle Bell Rock on /config/shows/abc.json; device 1F80C53238362D1E mac a4c1385ffe11; ab stays")
    out = report.scrub(line, names=names)
    for gone in ("Front Yard", "pillars left", "duckdns", "homeassistant.local", "trycloudflare", "Jingle", "/config/shows",
                 "1F80C5", "a4c138"):
        assert gone.lower() not in out.lower(), gone
    assert "halidayshow.runner" in out and "ab stays" in out  # module names and short words are left
    assert "<name>" in out and "<address>" in out and "<path>" in out and "<device>" in out
