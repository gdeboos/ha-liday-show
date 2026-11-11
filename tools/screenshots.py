"""Makes the user guide's screenshots (docs/images/guide/) from the real app.

It starts HA-liday Show on its own with empty, temporary data, presses **Try the demo** (seven planned
lights on the sample house, a sample song and a show; nothing is sent to real lights), then opens each
page in a browser and saves a picture of it. Run it after a change that alters how a page looks, and
commit the pictures that changed.

    pip install playwright pillow      # Chromium is already at /opt/pw-browsers in cloud sessions
    python tools/screenshots.py        # every picture
    python tools/screenshots.py house songs   # only these (names without .webp)

The dashboard cards (card-*.webp) are drawn by tools/cards-harness.html with a stand-in Home Assistant built
from the app's own data. Their icons come from tools/mdi-icons.json (paths from @mdi/js, Apache 2.0): a
card given a new icon needs its path added there, or the icon is drawn blank.

Each picture's name is its function's name in SHOTS below. Pages in docs/guide/ show one with
![What it shows](../images/guide/<name>.webp).
"""

import asyncio
import re
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images" / "guide"
PORT, PUBLIC_PORT = 8199, 18199
BASE = f"http://localhost:{PORT}"
DESKTOP = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def trim(img):
    """Cuts plain background off the bottom, keeping a margin."""
    bg = img.getpixel((img.width - 1, img.height - 1))
    px, bottom = img.load(), img.height
    while bottom > 1 and all(px[x, bottom - 1] == bg for x in range(0, img.width, 3)):
        bottom -= 1
    return img.crop((0, 0, img.width, min(img.height, bottom + 48)))


def save(png: bytes, name: str, width: int | None = None):
    img = trim(Image.open(io.BytesIO(png)).convert("RGB"))
    if width and img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.webp", "WEBP", quality=80, method=6)
    print(f"  {name}.webp {img.width}×{img.height}")


async def page_at(ctx, view, wait=1500):
    page = await ctx.new_page()
    await page.goto(f"{BASE}/#{view}")
    await page.wait_for_timeout(wait)
    return page


async def shot(page, name, selector=None, width=None):
    target = page.locator(selector).first if selector else page
    save(await target.screenshot(), name, width)


# One function per picture. Each gets a fresh desktop browser tab (ctx) and a phone one (phone).

async def library_shows(ctx, phone):
    await shot(await page_at(ctx, "shows"), "library-shows")


async def library_songs(ctx, phone):
    await shot(await page_at(ctx, "songs", 2500), "library-songs")


async def library_phone(ctx, phone):
    await shot(await page_at(phone, "shows"), "library-phone")


async def devices(ctx, phone):
    await shot(await page_at(ctx, "devices", 2000), "devices")


async def add_light(ctx, phone):
    page = await page_at(ctx, "devices", 2000)
    await page.get_by_role("button", name="+ Add a light").first.click()
    await page.wait_for_timeout(800)
    await shot(page, "add-light")


async def house(ctx, phone):
    await shot(await page_at(ctx, "house", 2500), "house")


async def speakers(ctx, phone):
    await shot(await page_at(ctx, "speakers"), "speakers")


async def schedule(ctx, phone):
    await shot(await page_at(ctx, "schedule", 2000), "schedule")


async def playlists(ctx, phone):
    await shot(await page_at(ctx, "playlists"), "playlists")


async def scenes(ctx, phone):
    await shot(await page_at(ctx, "scenes"), "scenes")


async def scene_editor(ctx, phone):
    page = await page_at(ctx, "scenes", 1500)
    await page.locator("button:visible", has_text=re.compile(r"^\s*Edit\s*$")).first.click()
    await page.wait_for_timeout(4000)
    await shot(page, "scene-editor")


async def palettes(ctx, phone):
    await shot(await page_at(ctx, "palettes"), "palettes")


async def presets(ctx, phone):
    await shot(await page_at(ctx, "presets", 2500), "presets")


async def faces(ctx, phone):
    await shot(await page_at(ctx, "faces", 2500), "faces")


async def public_setup(ctx, phone):
    await shot(await page_at(ctx, "public", 2000), "public-page-setup")


async def settings(ctx, phone):
    await shot(await page_at(ctx, "editors"), "settings")


async def ai(ctx, phone):
    await shot(await page_at(ctx, "ai", 2000), "ai")


async def your_data(ctx, phone):
    await shot(await page_at(ctx, "data"), "your-data")


async def live_music(ctx, phone):
    await shot(await page_at(ctx, "livemusic"), "live-music")


async def help_panel(ctx, phone):
    page = await page_at(ctx, "shows")
    await page.get_by_role("button", name="Help").first.click()
    await page.wait_for_timeout(800)
    await shot(page, "help")


async def pre_show_check(ctx, phone):
    page = await page_at(ctx, "devices", 2000)
    await page.get_by_role("button", name="Pre-show check").first.click()
    await page.wait_for_timeout(6000)
    await shot(page, "pre-show-check")


async def open_show(ctx):
    page = await page_at(ctx, "shows", 1500)
    await page.locator("button:visible", has_text=re.compile(r"^\s*Edit\s*$")).first.click()
    await page.wait_for_timeout(6000)
    return page


async def show_editor(ctx, phone):
    page = await open_show(ctx)
    await page.keyboard.press("Space")    # play a few seconds, so the house is lit
    await page.wait_for_timeout(9000)
    await page.keyboard.press("Space")
    await page.wait_for_timeout(800)
    await shot(page, "show-editor")


async def music_editor(ctx, phone):
    page = await page_at(ctx, "songs", 2500)
    await page.locator("button:visible", has_text=re.compile(r"^\s*Edit\s*$")).first.click()
    await page.wait_for_timeout(7000)
    await shot(page, "music-editor")


async def visitors_page(ctx, phone):
    page = await phone.new_page()
    await page.goto(f"http://localhost:{PUBLIC_PORT}/?c={CODE}")
    await page.wait_for_timeout(2500)
    await shot(page, "visitors-welcome")
    for _ in range(5):    # through the first-visit welcome
        btn = page.get_by_role("button", name="Skip")
        if not (await btn.count() and await btn.first.is_visible()):
            break
        await btn.first.click()
        await page.wait_for_timeout(600)
    await page.wait_for_timeout(1000)
    await shot(page, "visitors-page")


async def dashboard_cards(ctx, phone):
    """The Home Assistant dashboard cards, drawn by tools/cards-harness.html with a stand-in Home Assistant."""
    shows = api("GET", "/api/shows")
    api("PUT", "/api/schedule", [
        {"id": "evening", "play": {"type": "show", "id": shows[0]["id"]}, "on": True, "start": "17:00", "end": "22:00",
         "days": [0, 1, 2, 3, 4, 5, 6], "from": "", "to": ""},
        {"id": "daytime", "play": {"type": "scene", "id": api("GET", "/api/house-scenes")[0]["id"]}, "on": True,
         "start": "15:30", "end": "17:00", "days": [5, 6], "from": "", "to": ""}])
    api("POST", "/api/player/play", {"show": shows[0]["id"], "position": 30})
    frontend = ROOT / "custom_components" / "haliday_show" / "frontend"
    drawing = ROOT / "haliday_show" / "app" / "halidayshow" / "static" / "js"

    async def serve(route):
        path = route.request.url.split("ha.test", 1)[1]
        local = path.split("?", 1)[0]
        if local.startswith("/app/"):
            got = await ctx.request.fetch(BASE + path[4:], method=route.request.method)
            await route.fulfill(status=got.status, headers=got.headers, body=await got.body())
            return
        file = {"/": ROOT / "tools" / "cards-harness.html", "/icons.json": ROOT / "tools" / "mdi-icons.json"}.get(local)
        if local.startswith("/cards/"):
            file = frontend / local[len("/cards/"):]
        elif local.startswith("/api/haliday_show/js/"):
            file = drawing / local[len("/api/haliday_show/js/"):]
            if not file.exists():
                file = drawing.parent / local[len("/api/haliday_show/js/"):]
        if not file or not file.exists():
            await route.fulfill(status=404, body="")
            return
        kind = {".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml"}.get(file.suffix, "text/html")
        await route.fulfill(status=200, content_type=kind, body=file.read_bytes())

    await ctx.route("http://ha.test/**", serve)
    page = await ctx.new_page()
    try:
        cards = ["player@420", "browse@560", "scenes@420", "schedule@560", "visitors@420", "house@560"]
        await page.goto("http://ha.test/?cards=" + ",".join(cards))
        await page.wait_for_function("window.ready === true", timeout=20000)
        await page.wait_for_timeout(5000)
        for name in cards:
            name = name.split("@")[0]
            await shot(page, f"card-{name}", f"#{name}")
    finally:
        api("POST", "/api/player/stop", {})


SHOTS = [library_shows, library_songs, library_phone, devices, add_light, house, speakers, schedule,
         playlists, scenes, scene_editor, palettes, presets, faces, public_setup, settings, ai, your_data, live_music,
         help_panel, pre_show_check, show_editor, music_editor, visitors_page, dashboard_cards]
CODE = ""


async def set_up_demo(browser):
    page = await (await browser.new_context(viewport=DESKTOP)).new_page()
    await page.goto(BASE + "/")
    await page.wait_for_timeout(2500)
    await page.get_by_role("button", name="Try the demo").first.click()
    await page.get_by_role("button", name="Start the demo").click()
    for _ in range(120):
        await page.wait_for_timeout(1000)
        shows = api("GET", "/api/shows")
        if shows and shows[0].get("baked"):
            break
    else:
        raise SystemExit("The demo show never finished baking.")
    await page.wait_for_timeout(3000)
    await page.context.close()
    # A finished show on the visitors' page, so it has something to offer.
    global CODE
    api("POST", f"/api/shows/{shows[0]['id']}/mark", {"in_progress": False})
    api("PUT", "/api/public", {"on": True, "nearby": False,
                               "items": [{"kind": "show", "id": shows[0]["id"]}]})
    lights = [d["id"] for d in api("GET", "/api/devices")]
    looks = ["twinkle", "candles", "chase", "snow", "twinkle", "pulse", "candles"]
    colours = ["#ff0000", "#ffb000", "#00b000", "#ffffff", "#c00000", "#00a000", "#ffb000"]
    for name, look in [("Twinkle", lambda i: {"effect": looks[i % 7], "params": {"color": colours[i % 7]}}),
                       ("Walking chase", lambda i: {"effect": "chase", "params": {"color": "#ff0000", "color2": "#ffffff"}})]:
        sid = api("POST", "/api/house-scenes", {"name": name})["id"]
        api("PUT", f"/api/house-scenes/{sid}", {"name": name, "mode": "basic",
                                                 "lights": {d: look(i) for i, d in enumerate(lights)}})
    CODE = api("GET", "/api/public").get("code") or api("POST", "/api/public/code").get("code", "")


async def run(wanted):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        await set_up_demo(browser)
        for fn in SHOTS:
            if wanted and fn.__name__.replace("_", "-") not in wanted and fn.__name__ not in wanted:
                continue
            print(fn.__name__)
            ctx = await browser.new_context(viewport=DESKTOP, color_scheme="light")
            phone = await browser.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True,
                                              has_touch=True, color_scheme="light")
            try:
                await fn(ctx, phone)
            except Exception as e:    # one page failing shouldn't lose the rest
                print(f"  failed: {e}")
            await ctx.close()
            await phone.close()
        await browser.close()


def main():
    data = Path(tempfile.mkdtemp(prefix="haliday-shots-"))
    (data / "config").mkdir()
    (data / "media").mkdir()
    env = {**os.environ, "HALIDAY_SHOW_CONFIG": str(data / "config"), "HALIDAY_SHOW_MEDIA": str(data / "media"),
           "HALIDAY_SHOW_PORT": str(PORT), "HALIDAY_SHOW_PUBLIC_PORT": str(PUBLIC_PORT)}
    env.pop("SUPERVISOR_TOKEN", None)
    server = subprocess.Popen([sys.executable, "-m", "halidayshow"], cwd=ROOT / "haliday_show" / "app", env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                api("GET", "/api/info")
                break
            except OSError:
                time.sleep(0.5)
        asyncio.run(run(set(sys.argv[1:])))
    finally:
        server.terminate()
        server.wait()
        shutil.rmtree(data, ignore_errors=True)


if __name__ == "__main__":
    main()
