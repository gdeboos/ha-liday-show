<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Getting started

[Contents](README.md) · [Your lights →](lights.md)

## Finding your way

Five tabs run along the top, and a sixth, **Public page**, once you've turned it on. HA-liday Show
opens on **Library**; the three editors sit together after it, under **Editors**, as **Show**,
**Music** and **Playlist**:

| Tab | What's there |
| --- | --- |
| **Library** | In two groups. **Shows**: **Shows** (all of yours) and **Playlists** (shows back to back, by hand or on a schedule). **Ingredients**: **Songs** (all of yours), **Samples** (short sounds to layer over a song), **Palettes** and **Presets** (the colours and effect settings you reuse). |
| **Show** (the **Show editor**) | Where shows are made: the timeline, previews and effect settings. |
| **Music** (the **Music editor**) | Where songs are cut, shortened, joined and detected. |
| **Playlist** (the **Playlist editor**) | Where you drag shows into playlists and set when they play. |
| **Setup** | **Devices**, **Speakers**, **House** and **Settings**, the things you set up once. |
| **Public page** | What people passing by can pick on their phone, and when, and their queue (see [The public page](public-page.md#the-public-page)). |

Library and Setup list their pages down the side (along the top on a phone), and each remembers the
page you last had open. Below, "the House tab" and so on mean that page.

Your browser's **Back** and **Forward** buttons (or swiping back on a phone) move between the tabs and
pages you've visited, in Home Assistant too. From an open show, **Back** goes to **Your shows**, as
**← All shows** does; from a song in the Music editor, it goes to **Your songs**; from a playlist, to
**Your playlists**. The first two ask first if you'd lose changes. Going back to **Your shows** stops the show if it's playing. **Back** does nothing
while a window is open: close it first.

When you come back to HA-liday Show from elsewhere in Home Assistant, or reload the page, it opens where
you left it, with the same show, song, draft or playlist open. It opens on **Library** the first time,
and if what you had open has gone, it shows that editor's list. This is kept in your browser, so each
computer or phone remembers its own place.

### Help

**? Help**, at the top right, opens tips for the page you're on beside it (over it on a phone). It
follows you as you change page. Each topic folds open, and **More in the guide ↗** opens that part of
this guide on GitHub. Type in **Search help** to look through every page's tips at once. **✕**, or **Esc** while you're in it,
closes it. In the editors, each panel's **?** shows a few tips for that panel, with **More in
Help →** for the rest.

## Requirements

- Home Assistant OS or Supervised (anything with **Settings → Apps**). Apps were called add-ons before
  Home Assistant 2026.2. No apps? You can [run it without them](without-home-assistant.md#running-without-home-assistant), with
  Docker or Python.
- Lights on the same network as Home Assistant, any of:
  - **Govee** lights with **LAN Control** switched on in the Govee Home app, with multicast allowed. The
    model needs Govee's per-segment realtime mode (the Devices tab tells you whether a model is known
    to have it).
  - **WLED** strips.
  - **Pixel controllers** that take **DDP** (Falcon Player, ESPixelStick, ESPHome, Tasmota, an ESP32) or
    **E1.31**, also called sACN (Falcon, Kulp, xLights set-ups).
  - Any **Home Assistant** light or switch, such as Zigbee or Hue bulbs, or a smart plug for a prop.
  - **Twinkly** lights (experimental).
- Optional: a Home Assistant media player for the music. Without one, songs play in your browser
  while you edit, and shows started by a playlist or an automation play their music in the
  [Show player](play-it.md#music-with-no-speaker-the-show-player) (or the lights only).
- Optional: the Mosquitto broker app and MQTT integration, for show entities in automations.

## Quick start

The first time you open HA-liday Show, the **setup guide** opens and walks you through these steps in one
window: add your lights, check each one, pick a speaker, choose the sample house or your own photo, and
make your first show from a song. Every step can be skipped, **← Back** goes back, and you can run it
again any time with **Run the setup guide** under **Setup → Settings**. Its first page also offers
**Try the demo** (see [The demo](#the-demo)). To do it by hand instead:

1. **Setup → Devices**: press **+ Add a light**, pick what kind it is and follow the steps, then press
   **Test** to check it. For a Govee light, **Find** or **Test** sets its segment count.
2. **Setup → Speakers** (optional): press **+ Add a speaker**, **Test and add** your speaker, and pick it as the default show
   speaker.
3. **Setup → House** (optional): upload a photo of your house and trace each light on it.
4. **Show** tab (the Show editor), or **Library → Shows**: press **+ New show** (or **Open** one of yours), name it and pick or upload a song, then press **Create show** (with an AI set up, a second step
   offers **Start empty**). Drag across a light's track, press **＋ Add effect…** and pick one. Press
   Space to play.
5. Play it by itself: put it in a [playlist](play-it.md#playlists) on the **Playlist** tab and turn on
   **Play on a schedule** (at set times or from sunset), or start it from an automation with the MQTT
   **Play** button or the `hassio.app_stdin` action.

> **Just want to see it working?** On a fresh install, press **Try the demo** under **Setup → Devices**
> (or **Setup → Settings → Demo**). See [The demo](#the-demo).

> **Tip:** lights not here yet? Add them as [planned lights](lights.md#lights-not-delivered-yet) and start
> designing now. Once a song is picked, **✨ Generate** in the Show panel makes a whole first draft
> to build on.

## The demo

**Try the demo** sets everything up in one press, so you can try HA-liday Show before your lights are up,
or test it without any lights at all. It adds seven planned lights (Roof, Icicles, Porch, Windows,
Tree, Garage and Path) already placed on the [sample house](house.md#the-sample-house), adds a sample song (a
music-box *Jingle Bells* made for HA-liday Show, free to use) to your songs, and generates **Demo show**
in Christmas colours. Press **▶ Play** to watch it on the House panel. Nothing is sent to real lights.

It's only offered while you have no lights, so it never mixes with your own. When you're done, press
**Remove the demo** under **Setup → Settings → Demo**: the demo's lights, their places on the house and
**Demo show** go, and your own shows are kept. The sample song stays in your songs, to use in your own
shows if you like.

## Moving from Govee Light Show

This app used to be called **Govee Light Show**. Home Assistant treats the renamed app as a new
one, so you install **HA-liday Show** alongside the old one:

1. Stop **Govee Light Show**, so only one app drives your lights.
2. Install **HA-liday Show** and start it. The first time it starts, it copies your shows, lights,
   palettes, presets, settings, house photo and songs across from the old app. The old app's
   copy isn't changed.
3. In **HA-liday Show**'s **Configuration** tab, paste your **Claude API key** again if you use one,
   and turn on **Show in sidebar** and **Start on boot**.
4. If you use MQTT, the old **Govee Light Show** entities are removed and new **HA-liday Show** ones
   appear (for example `select.ha_liday_show_show`). Point your automations at the new ones, and
   change the app in any `hassio.app_stdin` (or older `hassio.addon_stdin`) action to **HA-liday Show**.
5. Once your shows play as before, uninstall **Govee Light Show**. Your songs stay in
   `/media/govee_show` until you delete them; the new app uses its own copies in
   `/media/haliday_show`.

The copy only happens once, and only if **HA-liday Show** has no lights or shows of its own yet.

---

[Contents](README.md) · [Your lights →](lights.md)
