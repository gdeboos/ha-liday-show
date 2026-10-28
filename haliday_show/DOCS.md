# 🎄 HA-liday Show

Build music-synchronised light shows for your Christmas lights, preview them on a photo of your house,
and play them from Home Assistant. It drives WLED strips, pixel controllers (DDP or E1.31), Govee
lights, any Home Assistant light or switch, and Twinkly (experimental), in any mix. Open **HA-liday Show** from
the Home Assistant sidebar.

**Getting started:** [Finding your way](#finding-your-way) · [Requirements](#requirements) ·
[Quick start](#quick-start) · [The demo](#the-demo)

**Setting up:** [1. Devices](#1-devices) · [2. Speakers](#2-speakers) · [3. Your house](#3-your-house)

**Making shows:** [4. Build a show](#4-build-a-show) · [Effects](#effects) · [5. Play it](#5-play-it) ·
[Playlists](#playlists) · [The public page](#the-public-page) · [6. Automations](#6-automations)

**Reference:** [Arrange the editor](#arrange-the-editor) · [Settings](#settings) ·
[Your data](#your-data) · [Moving from Govee Light Show](#moving-from-govee-light-show) ·
[Setting up the AI](#setting-up-the-ai) · [Packet lab](#packet-lab) ·
[Troubleshooting](#troubleshooting) · [Where things are stored](#where-things-are-stored) ·
[Running without Home Assistant](#running-without-home-assistant)

## Finding your way

Three tabs run along the top, **Library**, **Schedule** and **Setup**, and a fourth, **Public page**, once
you've turned it on. HA-liday Show opens on **Library**:

| Tab | What's there |
| --- | --- |
| **Library** | In two groups. **Shows**: **Shows** (all of yours), **Scenes** (one-tap looks for every light) and **Playlists** (shows back to back). **Ingredients**: **Songs** (all of yours), **Samples** (short sounds to layer over a song), **Palettes** and **Presets** (the colours and effect settings you reuse). |
| **Schedule** | What plays by itself, and when: playlists, shows and scenes (see [Schedule](#schedule)). |
| **Setup** | **Devices**, **Speakers**, **House** and **Settings**, the things you set up once. |
| **Public page** | What people passing by can pick on their phone, and when, and their queue (see [The public page](#the-public-page)). |

Library and Setup list their pages down the side (along the top on a phone), and each remembers the
page you last had open. Below, "the House tab" and so on mean that page.

The four editors open from the Library: **Open** on a show takes you to the **Show editor** (the timeline,
previews and effect settings), **Edit** on a scene to the **Scene editor** (see [Scenes](#scenes)),
**Edit** on a song to the **Music editor** (cutting, shortening, joining and detecting) and **Open** on a
playlist to the **Playlist editor** (dragging shows into order and setting when they play). **+ New
show**, **+ New scene** and **+ New playlist** open the new one in its editor too. In an editor,
**← All shows** (or songs, scenes or playlists) goes back to that Library page and puts it away.
**Library** or **Setup** at the top leave it open instead: a **↩** button with its name then sits next to the
tabs, and takes you straight back to it.

Your browser's **Back** and **Forward** buttons (or swiping back on a phone) move between the tabs and
pages you've visited, in Home Assistant too. From an open show, **Back** goes to **Library → Shows**, as
**← All shows** does; from a song in the Music editor, it goes to **Library → Songs**; from a playlist, to
**Library → Playlists**. The first two ask first if you'd lose changes. Going back to the shows stops the show if it's playing. **Back** does nothing
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
  Home Assistant 2026.2. No apps? You can [run it without them](#running-without-home-assistant), with
  Docker or Python.
- Lights on the same network as Home Assistant, any of:
  - **WLED** strips: any string of pixels on an ESP32 or ESP8266 running WLED.
  - **Pixel controllers** that take **DDP** (Falcon Player, ESPixelStick, ESPHome, Tasmota, an ESP32) or
    **E1.31**, also called sACN (Falcon, Kulp, xLights set-ups).
  - **Govee** lights with **LAN Control** switched on in the Govee Home app, with multicast allowed. The
    model needs Govee's per-segment realtime mode (the Devices tab tells you whether a model is known
    to have it).
  - Any **Home Assistant** light or switch, such as Zigbee or Hue bulbs, or a smart plug for a prop.
  - **Twinkly** lights (experimental).
- Optional: a Home Assistant media player for the music. Without one, songs play in your browser
  while you edit, and shows started by a playlist or an automation play their music in the
  [Show player](#music-with-no-speaker-the-show-player) (or the lights only).
- Optional: the Mosquitto broker app and MQTT integration, for show entities in automations.

## Quick start

The first time you open HA-liday Show, the **setup guide** opens and walks you through these steps in one
window: add your lights, check each one, pick a speaker, choose the sample house or your own photo, and
make your first show from a song. Every step can be skipped, **← Back** goes back, and you can run it
again any time with **Run the setup guide** under **Setup → Settings**. Its first page also offers
**Try the demo** (see [The demo](#the-demo)). To do it by hand instead:

1. **Setup → Devices**: press **+ Add a light**, pick what kind it is and follow the steps, then press
   **Test** to check it. A WLED strip's LEDs are filled in for you; for a Govee light, **Find** or
   **Test** sets its segment count.
2. **Setup → Speakers** (optional): press **+ Add a speaker**, **Test and add** your speaker, and pick it as the default show
   speaker.
3. **Setup → House** (optional): upload a photo of your house and trace each light on it.
4. **Library → Shows**: press **+ New show** (or **Open** one of yours), name it and pick or upload a song, then press **Create show** (with an AI set up, a second step
   offers **Start empty**). Drag across a light's track, press **＋ Add effect…** and pick one. Press
   Space to play.
5. Play it by itself: on the [Schedule](#schedule) tab press **+ Add to schedule** and pick it (or a
   [playlist](#playlists) it's in) and the times, or start it from an automation with the MQTT **Play**
   button or the `hassio.app_stdin` action.

> **Just want to see it working?** On a fresh install, press **Try the demo** under **Setup → Devices**
> (or **Setup → Settings → Demo**). See [The demo](#the-demo).

> **Tip:** lights not here yet? Add them as [planned lights](#lights-not-delivered-yet) and start
> designing now. Once a song is picked, **✨ Generate** in the Show panel makes a whole first draft
> to build on.

## The demo

**Try the demo** sets everything up in one press, so you can try HA-liday Show before your lights are up,
or test it without any lights at all. It adds seven planned lights (Roof, Icicles, Porch, Windows,
Tree, Garage and Path) already placed on the [sample house](#the-sample-house), adds a sample song (a
music-box *Jingle Bells* made for HA-liday Show, free to use) to your songs, and generates **Demo show**
in Christmas colours. Press **▶ Play** to watch it on the House panel. Nothing is sent to real lights.

It's only offered while you have no lights, so it never mixes with your own. When you're done, press
**Remove the demo** under **Setup → Settings → Demo**: the demo's lights, their places on the house and
**Demo show** go, and your own shows are kept. The sample song stays in your songs, to use in your own
shows if you like.

## 1. Devices

On the **Devices** tab press **+ Add a light**. First pick what you're adding under **A light you have**
(a WLED strip, a pixel controller, a Govee light, a Home Assistant light or switch, or a Twinkly), or
**Plan a light** for one that hasn't arrived yet. Then fill in what that kind needs and press **Add**. For a
WLED strip or a Govee light, press **Scan network** and **Add** each light it finds, or type its IP if it
doesn't show up. When it's added, press **Add another**
for the next one, or **Done**.

The list shows one line per light: its name, IP, model and its **Size**, a bar with each part in its
colour and how many LEDs (or segments, on a Govee light) and parts it has. A Govee light
with a segment for every bulb, such as one on **Per bulb**, says bulbs instead. Press **Test** on a line to test the light. Press anywhere
else on the line (or **Edit**) to open the light's window, which has all its settings and its parts.
**Remove light** is at the bottom of that window. The settings are:

| Setting | What it does |
| --- | --- |
| Name | How the light is labelled in the editor and on the House tab. |
| LEDs | WLED, Twinkly and pixel controllers: how many LEDs it has, filled in or typed when you add it. |
| Segments | Govee only: how many separately controllable sections it has. Govee doesn't report it, so set it with **Find** or **Test** (see [Govee lights](#govee-lights)); most Govee strips and outdoor lights have 10 to 15. |
| Bulbs | Govee only: the real number of bulbs, so the House view draws each one. Leave blank to draw 4 per segment. On other lights the House view draws one bulb per LED. |
| Brightness % | Caps the light in every show, handy when one string is much brighter than the rest. It applies straight away, to previews too, without re-saving shows. |
| Reverse | Turn it on if effects run from the wrong end. |
| Blend | Govee only: asks the light to blend smoothly between neighbouring segments. |
| Protocol | Govee only: how colours are sent (see [Govee lights](#govee-lights)). Other kinds show how they're driven, such as **DDP** or **E1.31**. |

A Home Assistant light has neither **LEDs** nor **Segments**: it shows one colour at a time.

Some kinds have a little more in their window: **first LED** for a pixel controller over DDP, **universe**
and **channel** for one over E1.31, and the light or switch for a Home Assistant one.

### WLED strips

WLED strips work like any other light. Press **+ Add a light**, pick **WLED strip** and press
**Scan network** to find it, or type its IP address (it's on the WLED app's **Info** page) and press **Add**. HA-liday Show asks the
strip for its name and number of LEDs, so there's nothing to work out: its **LEDs** are filled in,
up to 1000 a strip. **Find**, **Blend** and **Protocol** don't apply to WLED, so they're not shown.

WLED has its own way of splitting a strip, **segments** in the WLED app. If you've set some up, they
become the strip's **parts** here when you add it, with their names (see *Splitting a light into
parts* below). Change them in WLED later? Press **Use WLED segments** under the strip to bring them in
again: a part keeps its clips as long as its WLED segment is still there. You can also split the strip
here by hand, without touching WLED.

During a show HA-liday Show sets every LED itself, so the effect you picked in WLED, and its segments'
own effects, are paused until a couple of seconds after the show stops, then WLED carries on where it
left off. WLED's own brightness still applies, on top of **Brightness %** here. If only part of the
strip lights up during a show, open WLED's **Config → Sync Interfaces** and untick **Use main segment
only**.

To plan a WLED strip before it arrives, pick **Plan a light**, choose **WLED strip** as the **Kind of
light** and set **LEDs** to how many it has.

#### Moving a Govee light to WLED

Rewired a Govee light to run from a WLED controller? You don't need to add it again. Open
**Setup → Devices**, press **Edit** on the Govee light, then **Convert to WLED…** at the bottom of the
window. Type the WLED's IP address, or press **Scan network** and **Use** next to it, then press
**Convert**.

Controller not plugged in yet? Leave the IP blank, set **LEDs** to how many it will have (it starts
at the light's **Bulbs**) and press **Convert**. The light becomes a planned WLED light, so you can
work on its shows straight away. Once the controller is on, type its IP into the light's window and
press **Test**.

- The light keeps its name, its tracks in every show and its place on the house photo.
- **LEDs** is set to the WLED's number of LEDs, and its parts keep their share of the light: on a
  44-segment light split into thirds, **Left**, **Center** and **Right** become thirds of the new length.
- Shows that use the light are updated straight away, so playlists, schedules and Home Assistant play
  them on every LED.
- **Reverse** stays as it was. Press **Test** afterwards, and if the white dot runs the wrong way,
  change **Reverse**.

### Pixel controllers

Strings on a pixel controller work too: Falcon Player, ESPixelStick, ESPHome, Tasmota, a home-made ESP32,
or anything else that listens for **DDP**. Turn DDP on in the controller's settings if it has a switch for
it. Then press **+ Add a light**, pick **Pixel controller (DDP)**, type the controller's IP and how many
**LEDs** the string has, and press **Add**. Controllers don't say how many LEDs they have, so check
with **Test**: the white dot should reach the end of the string.

One controller often drives several strings or props. Add the same IP again for each one: the new light
starts just after the last light on that controller. **first LED**, in the light's window, is where the
light starts in the controller's LED order, so you can set it to match how you've wired things. If two
lights on one controller share LEDs, their line says *Shares LEDs with…*. You can also add the whole
controller as one long light and split it into **parts** instead.

To plan one before it arrives, pick **Plan a light**, choose **Pixel controller (DDP)** as the **Kind
of light** and set **LEDs** to how many are on the string.

### E1.31 controllers

Most Falcon and Kulp controllers, and anything set up for xLights, speak **E1.31** (also called sACN).
Press **+ Add a light**, pick **Pixel controller (E1.31)**, type the controller's IP and how many **LEDs**
the string has, and press **Add**. Set the controller to take E1.31 as **unicast** (straight to
its IP); HA-liday Show doesn't use multicast.

Each light has a **universe** and **channel** in the **Model** column: where it starts in the
controller's set-up. Each LED takes 3 channels, a universe holds 510 (170 LEDs), and a light carries on
into the next universe when it runs past the end of one, the way xLights numbers them. Add the same IP
again for the next string and it starts just after the last one. Lights on one controller can share a
universe without blanking each other, and their line says *Shares LEDs with…* if two overlap.

When a show or test stops, HA-liday Show tells the controller, so it goes straight back to what it was
doing. To plan one before it arrives, pick **Plan a light** and choose **Pixel controller (E1.31)** as the
**Kind of light**.

### Govee lights

Switch on **LAN Control** for each light in the Govee Home app first. Then press **+ Add a light**, pick
**Govee light**, press **Scan network** and **Add** each light it finds, or type its IP if it doesn't show
up. Govee lights need a little more setting up than the others, because Govee doesn't report how many
segments a light has, and different models take colours in different ways.

#### Setting the segment count

Press **Test**: a rainbow runs along the light with a white dot
stepping from segment to segment. Set **Segments** so the dot visits every segment once per lap,
and turn on **Reverse** if it runs the wrong way. If the light is still on its reel, press **Find**
next to **Segments** instead: a window opens, lights one segment and asks whether anything is lit.
Each answer halves the possible range, so after about 7 answers the count is filled in and the
window says what it found. **Cancel** stops it and lets the light go back to normal. Set **Reverse** later,
once the light is hung up.

While the test is running you can change **Segments**, **Reverse** or **Protocol** and the light
picks up the change straight away, so you don't need to press **Test** again after each one.

#### Test only turns the light on?

Not every Govee light has a realtime mode. Change **Protocol** and press **Test** again:

| Protocol | When to use it |
| --- | --- |
| Realtime | The default, the same packets OpenRGB sends. Works for most strips and outdoor lights. |
| Whole light (one colour) | For lights with no realtime mode, or whose realtime mode only reaches part of the light. The whole light shows the average colour of its segments, at up to 10 changes a second, and each change fades a little. |

### Home Assistant lights and switches

Any light or switch in Home Assistant can join in: Zigbee and Hue bulbs, LIFX, or a smart plug driving an
inflatable or a lit-up prop. Press **+ Add a light** and pick **Home Assistant light or switch**. Type part of a
name in **Find a light or switch** (or pick **Colour lights**, **Other lights** or **Switches** to narrow the
list), press each one you want so it's ticked, then press **Add**: you can add several at once. A
double-click adds just that one, and so does **Enter** when only one matches. Ones you've already added
are greyed out. To swap one for another later, pick it in the light's window.

Changes go through Home Assistant, so these are slow, and each is one colour at a time:

- A **light** takes the show's colour up to 4 times a second. Fades, colour changes and pulses look
  good; chases and sparkles don't show on a single colour. A light that only does white gets just the
  brightness.
- A **switch** turns on while the show is at least half bright there and off when it's darker, whatever
  the colour. It changes at most once a second, to spare the plug's relay and the prop, so it suits
  beats in slower songs and changes between sections. **Brightness %** doesn't apply to a switch, as a
  plug can't dim. In the editor a switch shows as plain white when it's on and dark when it's off, and a
  clip is marked if it would leave the switch off the whole time, or keep it on so its colours are lost.
  A steady clip, such as **Solid**, is the way to have the prop on for part of the song.

Effects that are too fast for one are marked on the timeline, as for other slow lights. All your Home
Assistant lights and switches share about 10 changes a second between them, as that's what a Hue bridge
or a Zigbee network keeps up with, so with lots of them each one changes a little less often and none
fall behind. Just before a show or test starts, HA-liday Show remembers how each light and switch was, and
puts it back when it ends.

Running HA-liday Show without Home Assistant? These need `HA_URL` and `HA_TOKEN` set (see **Running
without Home Assistant**). To plan one, pick **Plan a light** and choose **Home Assistant light or switch** as the **Kind of light**.

### Twinkly lights (experimental)

Press **+ Add a light**, pick **Twinkly** and type the light's IP (it's in the Twinkly app under the
light's **Device settings**). Its name and number of LEDs are filled in for you, and you can
split it into **parts** like any other light.

During a show HA-liday Show switches the light into Twinkly's realtime mode and sets every LED itself; when
the show or a test ends, the light goes back to what it was playing. Twinkly doesn't officially support
this mode, and it hasn't been tried on a real Twinkly yet, so press **Test** first: a rainbow with a
white dot should run along the whole light. If nothing happens, or the colours are wrong, say so on
GitHub.

### Putting lights in order

Drag a light by its ⠿ handle, or use its ↑ and ↓ buttons. Every
show's timeline, the editor's preview and the House tab list lights in this order, with a split
light's parts kept together under it.

### Lights not delivered yet?

Press **+ Add a light** and pick **Plan a light**. Choose the **Kind of light** (a WLED strip to start
with, a pixel controller, a Govee light, a Home Assistant light or switch, or a Twinkly), give it a name
and press **Add planned light**, then build shows with it straight away. Each kind only asks for what it
needs: the strips, pixel controllers and Twinkly their **LEDs**, a Govee light its **Model** (for example
`H706A`, optional) and **Segments**, and a Home Assistant light just a name. For Govee models, a badge next to the model flags anything we've
found on real lights that you should know: **⚠ limited** (tested, only partly works; point at the badge
to see what it can do) or **? untested** (not tried with HA-liday Show yet: most
Govee lights with LAN Control work, so add one and press **Test** before buying more; the badge's
tooltip says whether Govee lists the model as having LAN Control). A model with no badge has been tested
and works on Realtime. A tested model
starts with the settings that suit it, such as 44 segments for the 30 m Christmas String Lights 2
(as many as it lights in realtime), both when you plan it and when you add it from **Scan network** (under **+ Add a light → Govee light**). Lights you've already
added keep their settings. Otherwise 15 segments is a guess until you test the real
light. Planned lights appear in the previews but nothing is sent to them. When the light arrives, type
its IP into the planned light's window (or pick it, for a Home Assistant light). For a Govee light you can
also press **+ Add a light → Govee light → Scan network** and choose **Link to** next to it. Its shows carry over, and if the real segment count differs, just change it: effects scale
to any number of segments.

### Splitting a light into parts

A long light can run where you only want part of it in the show,
or you may want different effects on different stretches, like a roof line that goes round the
whole house. Press the light's line to open its window, then **Split into parts…**. The first part covers the whole
light; set its first and last LED (segment, on a Govee light), then press **+ Add part** for the next stretch (it starts
just after the last part). For example, a 150-LED WLED strip round the roof could be **Front roof**
1–60, **Side** 61–100 and **Back** 101–150. They're counted the way effects run, so with
**Reverse** on, LED 1 is the far end. Parts are listed one per line, each with its colour,
and the bar above them maps the light: each part in its colour, unused ones grey.

To check where a part really is, press **Test** on its line: the real light shows just that part,
in its colour, with its first segment white, for a minute. Change its first or last segment while
it's lit and the light follows, so you can nudge it until it starts and ends in the right place.
**Test parts** lights every part the same way, with unused segments off, and **Stop** lets the light
go.

Each part gets its own track in the editor (named like *Roof · Front roof*), its own preview row,
and works with Copy and Recolour like any other light. **Segments in no part stay off during a
show**: the light's window lists them as *Unused, off in shows*. Parts can't overlap, and making the light
shorter trims them. Remove a part with ✕; its effects stay in your shows.

### The whole light as one

Unless you turn off **Also play as one** under the parts, the light
keeps its own track too, marked *All parts*. Effects on it
run across all its parts joined end to end, as if the unused segments weren't there. A 30 m string
that goes up the left pillar, across the top and down the right pillar could be split into *Left*,
*Top* and *Right*: a chase on the light's own track then runs up, across and down in one go. While
a clip is playing on a part's own track, that part shows its clip instead, so you can run one
effect over the whole string and drop a different one on just the left pillar. **Generate** puts
effects on the parts and leaves the light's own track for you. Turn off **Also play as one** for a
light you only ever use in parts, like a roof line where only the front 30 segments are seen: its
own track goes away (or, if it has effects on it, is marked *Not played: parts only*).

On the timeline a split light's tracks (when there's more than one) are grouped: a coloured bar runs down the left of the light
and its parts, the parts are indented under it, and a heavier line marks where the group starts and
ends. Press the **▸** before the light's name to fold its parts away under it, and **▾** to bring them back. A
light that plays only as parts (no track of its own) folds the rest under its first part.

### Light groups

A group is a set of lights, or parts of lights, that a show can give one effect: the two strips of
roof icicles, say, or the left part of each pillar. Under **Groups**, below your lights on the
**Devices** tab, press **+ New group**, give it a name and turn on the lights and parts to put in it, then
press **Add group**. A part is in automatically when its whole light is. **Edit** changes a group and
**Delete…** removes it. Groups are listed like your lights: press a group's line to change it, and drag it
by its ⠿ handle (or use **↑** and **↓**) to change the order of their lanes in the Show editor. A light can be in as many groups as you like.

Each group gets its own lane in the Show editor, under **House** (see [Group lanes](#group-lanes)).

## 2. Speakers

The song can play on any Home Assistant media player that can play files from the media folder.
Speakers are added on the **Speakers** tab first, and only those are offered in the editor.

- Press **+ Add a speaker**, then **Test and add** next to a media player in the window that opens
  (type in **Find a speaker** to narrow a long list). HA-liday Show plays a short chime on it the same way
  a show starts and only adds it if that works. Media players that can't be sent a song are listed
  but can't be added, and a failed test shows Home Assistant's reason. Echo devices through Alexa
  Media Player and Emby clients, for example, often can't play files from the media folder.
- **Delay ms** is how late the speaker really starts after it reports playing. Raise it if the
  lights run ahead of the music (often 100 to 500 ms for Wi-Fi speakers).
- **Default show speaker** is where shows play when started from an automation, unless a show picks
  its own (see [Play it](#5-play-it)).

## 3. Your house

The **House** tab puts your lights on a photo of your house. The editor's **House** panel then plays
the show on it, so you can design without standing outside, and the **House** lane uses it for
effects that sweep across the whole house.

### The sample house

Until you upload a photo, the **House** tab and panel show a drawn **sample house**, so you can try
the House view and the **House** lane straight away. Press **Put my lights on it** and each light that
isn't traced yet goes on the roofline, the eaves, the porch, the windows, the tree, the garage or the
path. A light whose name says where it is (*Porch*, *Icicles*, *Tree*) goes there; the rest fill the
places in order. There's room for eight lights. You can retrace any of them by hand.

When you upload a photo of your own, you're asked whether to clear the lights you put on the sample
house so you can trace them on your photo. **Remove photo** goes back to the sample house.

### Tracing a light

1. Take a photo from where people will watch, ideally at dusk, and press **Upload photo**. It's
   scaled to 2000 pixels across and kept in the app's config folder. **Darken** dims it so the
   lights stand out.
2. Pick a light in the list beside the photo, press **Trace** and click along where it runs,
   **starting at the end with the plug**. Click once at each corner or bend. The light's bulbs
   (its **Bulbs** count, or 4 per segment) are spread evenly along the line.
3. Press **Done** (or Enter). Drag a point to move it, right-click a point to remove it, and press
   Backspace while tracing to undo the last point. **Retrace** starts again and **Clear** removes
   the light from the photo.

While a light is picked, it's drawn in a rainbow from red at the plug to the far end, so you can
check it runs the same way as the real light. If it's backwards, retrace it from the other end, or
turn on **Reverse** on the Devices tab if the effects themselves run the wrong way. Each light's
**Brightness %** applies here as well. Click a light in the list, or its line on the photo, to pick
it; Esc lets go.

A light split into parts is drawn with each part in its colour (the same colours as on the Devices
tab) and its unused segments as faint, unlit bulbs. The picked light shows segment numbers along it
(1, every 5th, and where each part starts and ends) and each part's name. Hover over any bulb to see
which light, segment and part it belongs to.

### Light styles

Each light has a **Style**:

| Style | For | How to set it up |
| --- | --- | --- |
| Line | Strips, string lights, eaves lights | Trace along it, as above. |
| Icicle | Icicle lights | Trace the line the icicles hang from, then set **Drops** to how many drops it has and **Length** to how far the longest one hangs on the photo. The drops are staggered, each in its segment's colour, with the light's **Bulbs** shared between them. It starts with one drop for about every five bulbs, and never shows more drops than bulbs. |
| Spots | Spotlights | Press **Trace** and click where each spotlight sits, starting nearest the plug. Each one shines a soft wash of colour; drag its round handle to aim it, and use **Beam** for how wide the beams are. A spot covering several segments shows them blended. |

### Photo taken at an angle

Bulbs are spread evenly along the line, but on a photo taken from the
side the far end of a light looks squashed, so the bulbs don't sit on the real ones. Pick the light,
then drag one of its segment numbers along the line to where that segment really is: it's pinned
there (amber), and the bulbs between pins and the ends are spread evenly between them. Pin a few
along a long light. Not sure where a segment is? Click its number and press **Light it** to light
just that segment white on the real light (**Stop** lets it go). Right-click a pinned number, or
press **Unpin**, to let it go; **Unpin all** clears a light's pins. Pins are used by the House panel
and the House lane too, and **Retrace** or **Clear** removes them.

### Lights on top of each other

When two traced lights overlap, press 👁 on the one in front to
hide it on the photo, so you can click and drag the one underneath. It stays hidden (🙈) on this
browser until you press it again. Hiding only affects the House tab's photo: the light still shows
in the editor's House panel and plays in shows.

### Parts you can't see

If eaves carry on round the back of the house, or an extension lead runs
from the plug to the first bulb, trace past that part anyway (a short line is fine). Then click
that stretch of the line, choose **Out of view** and enter how many bulbs are on it (0 for an
extension lead). It's drawn dashed on the House tab and left out of the House panel. Its bulbs still
take their share of the segments, so the bulbs you can see show the right part of each effect, and
the real light plays the whole show as usual.

### Lights split into parts

A light split into parts (see **Devices**) is listed as its parts, each
under the light's name with its colour, and you trace each part on its own, starting at the end of
the part nearest the light's plug. That suits a light whose parts aren't joined up on the photo,
like a string that runs up one pillar, across and down the other. A light you traced whole before
splitting it keeps its one line and has a **Split trace into parts** button: it cuts the line where
each part starts and ends, so you can then move each part's points on their own.

## 4. Build a show

A show is a song plus effects on each light's track. The usual path is: pick a song, **Detect** its
beats and sections, then **Generate** a draft or **Describe it**, and fine-tune clips on the
timeline.

- **The song:** [Shows](#shows) · [Sharing shows](#sharing-shows) · [Songs](#songs) · [Samples](#samples) · [Editing a song](#editing-a-song) · [Drafts](#drafts) · [Layers](#layers) · [Mixer](#mixer-bass-mid-treble-and-tempo) · [Suggest cuts](#suggest-cuts) ·
  [Marks](#marks) ·
  [Detecting](#detecting-in-the-music-editor) · [Sections](#editing-sections) · [Beats](#beats)
- **Let it help:** [Suggestions](#suggestions) · [Describe it](#describe-it) · [Generate](#generate)
- **By hand:** [The timeline](#the-timeline) · [Adding effects](#adding-effects) ·
  [Editing a clip](#editing-a-clip) · [Presets](#presets) · [Your own presets](#your-own-presets) ·
  [Copying](#copying) · [Colour palettes](#colour-palettes)
- **Odds and ends:** [Lights that are gone](#lights-that-are-gone) · [Working on one part](#working-on-one-part) ·
  [Undo](#undo) · [Shortcuts](#shortcuts)

### Shows

Your shows are under **Library → Shows**, and nothing changes in a show until you open it in the
**Show editor**. Each show is listed with its song, its length and when it last changed, newest first, and the
one you were last editing has a **Last edited** badge.

- **Open** a show to edit it, or press **+ New show** to start one. A short window asks for:
  1. a **Name** and a **Song** (or **+ Add a song…**, or **No song, lights only** with its length). The
     name fills in from the song until you type your own, and each show needs its own name.
  2. with an AI set up, how it starts: **Start empty**, or **Generate with AI**, which needs a song
     and at least one light and shows the same choices as **✨ Generate** (**Colours**, **Style**,
     **Build up**, **Longest effect** and, with lights traced on the house photo, the sweep across the
     house). Without an AI, the show starts empty straight after step 1. For a quick draft
     made by rules, press **✨ Generate** in the editor (see [Generate](#generate)).

  **Create show** (or **Create and generate**) saves it straight away; **Cancel** makes nothing.
- **Duplicate** makes a copy called "… copy", ready to play straight away.
- **Rename** lets you type a new name in the list; press Enter to keep it, or Escape to put it back.
  Each show needs its own name. An automation that starts the show by its name needs the new name.
- **Share** downloads the show as a file you can send to anyone with HA-liday Show (see [Sharing shows](#sharing-shows)).
- **Remove…** archives or deletes a show (see [Archiving and deleting](#archiving-and-deleting)).
- **← All shows**, at the start of the Show panel, takes you back to **Library → Shows**. Going to
  another tab instead keeps your show open, with **↩** at the top to come back to it (see
  [Finding your way](#finding-your-way)).

The Show panel shows the open show's name beside **← All shows**; to switch to another show, go back
to the list. **⚙ Show settings…** opens the show's settings: its **Name**, its **Show speaker**
(below), **Brightness** (below), **Save automatically a couple of seconds after each change**, and **Remove show…** to archive or delete it.

**Brightness** in **⚙ Show settings…** dims this show without changing any of its effects:

- **Whole show** dims every light in the show.
- **Each light in this show** has its own slider, so you can bring down one light that's too bright
  next to the others. A light split into parts is dimmed as one.

The two work together with each effect's own **Brightness %** on the timeline, and with each light's
brightness under **Setup → Devices**, which applies to every show. For example, a show at 50% with a
light at 50% plays that light at a quarter. The preview and the house photo show the result as you
drag. Shows you made before keep playing at 100%.

### Sharing shows

You can swap shows with friends, or post one on a forum, without either of you changing your lights.

- **Share** on a show's row downloads a small file ending in `.halidayshow`. It holds the show's effects,
  its beats and sections, its **Brightness** levels from **⚙ Show settings…**, the song's name and length,
  and a short description of each light it uses
  (its name, what kind of light it is, how many segments and parts it has, and roughly where it is on
  your house photo). It doesn't hold the song, your house photo, IP addresses or any settings. Lights
  with no effects in the show are left out.
- **Import show…**, beside **+ New show**, asks for a `.halidayshow` file, then opens a short window.
  It always makes a new show, so nothing you already have changes.
  1. **Name and song.** Songs aren't shared, so pick your own copy. The song with the closest name is
     picked for you. If your copy is a different length, a ⚠ says so: the show still imports, and you
     can move effects in the editor afterwards. You can also pick **No song for now** and add it later.
  2. **Match your lights.** Each light in the show has a row, with a small map of where it was on their
     house. Pick which of your lights plays it. Your lights are suggested for you, most alike first,
     and each suggestion says why, such as "✓ Suggested: same model, 3 parts each". A light that isn't
     much like any of yours starts on **Leave it out**, and its effects don't come across.
     - Effects stretch to fit your light, however many bulbs it has.
     - A light with parts shows a **Parts** box, so you can pick which of your light's parts plays each
       of theirs, or **Whole light**.
     - Two of their lights can play on one of yours: the picker says "(also playing …)". Where both
       have an effect at the same time, the one that started later shows.
     - Effects across the whole house, on the **House** lane, always come along.
     - **▶ Preview on your house** plays the show on your house photo, with the pairings as they are
       now and your song in this browser, so you can see it before you import it. Change a pairing
       while it plays and the preview follows. Nothing is sent to your lights, and nothing is saved.
       Press **■ Stop preview** to stop it. It needs your lights on the house photo
       (**Setup → House**).

  The show's **Brightness** comes along: the whole-show level as it was, and each light's level on
  the light of yours that plays it. Where two of their lights play on one of yours, the brighter level
  is used. You can change them afterwards in **⚙ Show settings…**. A show shared from an older
  HA-liday Show, before brightness, imports at 100%.

  **Import show** saves it and opens it in the editor. Effects a light can't show are marked as usual
  (see [Effects a light can't show](#effects-a-light-cant-show)).

### Songs

The Song panel shows the show's song with its length, tempo and sections. Press
**Change…** to pick another from your Home Assistant **media** folder, or **+ Add a song…** (MP3,
M4A, AAC, OGG, Opus, WAV, FLAC or WebM; see below). Songs you add go to `/media/haliday_show/` so media
players can play them. For a lights-only show, choose **No song, lights only** and set its **Length with no song**.

**Library → Songs** lists every song in your media folder: its length, what **Detect** found (its
tempo and sections) or "not detected yet", and which shows use it. Type in **Find** to narrow the
list by name, folder or show. **Edit** opens a song in the **Music editor**, and **Remove…** archives
or deletes one. The song you last opened in the Music editor has a **Last edited** badge.

Each song you added is one card, marked **Original**. Inside it, under **Edits of this song**:

- **✂ Edit · song file** (purple): a song file made in the Music editor from this song, with its length,
  the shows that use it and the [draft](#drafts) it was made from. **Edit draft** reopens that draft;
  **Remove…** archives or deletes the file (the draft stays). An edit of an edit sits under the first
  song. Edits made before drafts existed (named "… (edit)") are found by their name; **Edit** on one
  starts a new draft.
- **✎ Draft · no file yet** (amber, dashed): a draft that hasn't made a song file, so shows can't use
  it yet. **Open**, **Rename…** or **Delete…** it.

**All**, **Originals**, **Edits** and **Drafts**, beside **Find**, show just those, and the count says
how many songs, edits and drafts there are.

**Folders** sort your songs, such as **Christmas**, **Halloween** or **Party**. Press **+ New folder**
under the list and name it, then pick it under **Folder** on a song; the song's edits and drafts go
with it. Each folder folds away (press its name), and remembers whether you left it open; songs in no
folder are listed after them, under **Not in a folder**. **Rename…** and **Delete…** are on each
folder; deleting one leaves its songs, just in no folder. Folders only sort the list: the song files
stay where they are, so shows and speakers still find them. They're saved with your settings, so
they're in **Export…** too.

**+ Add a song**, under the list, opens a short window:

1. **Choose a file…** and give it a **Name**. It's saved under that name in `/media/haliday_show/`; if
   a song there already has it, the window asks for another, so nothing is replaced by mistake.
2. How to get it ready, then press **Add song**:
   - **Detect, then let the AI name the parts** (picked to start with when an AI is set up): finds its
     tempo, beats and parts, then the AI names the parts and writes their notes a little later (see
     the section notes under [Detecting in the Music editor](#detecting-in-the-music-editor)).
   - **Detect only** (picked to start with without an AI): the same, with the simple notes.
   - **Add it as it is**: leaves it for later (**Detect** in the Music editor).

   Detected songs are ready to use: a show that picks one gets its beats and parts straight away.

The same window opens from **+ Add a song…** in the **New show** window and in a show's **Choose a
song** window, and the song comes back picked.

Songs of any size up to 200 MB can be added. Home Assistant won't pass on more than 16 MB at once, so
a bigger song goes up in pieces, with the window showing how far it's got. Long shows on lots of
bulbs are saved in pieces the same way. If something goes wrong
while a window is open, the message shows inside the window as well as at the top.

### Archiving and deleting

**Remove…**, on a show or a song, opens a window that says where it's used and offers two ways to
take it away:

- **Archive** keeps it, out of the way. Archived shows and songs are listed, folded, under **Archived
  shows** and **Archived songs** at the foot of each list, and **Restore** brings one back.
- **Delete for good…** removes it, after asking you once more. Before it does, HA-liday Show keeps a copy
  of your shows and settings under **Setup → Settings → Your data** (*Before deleting*). A deleted song
  file itself can't be brought back.

**Shows.** An archived show is skipped by playlists (they show it as *archived*) and can't be started
by an automation, and comes back to the same places in its playlists when you restore it. If another
show has taken its name meanwhile, it comes back as "… (restored)". Deleting a show for good also
takes it out of its playlists. Archived shows are included in **Export…**. A show that's playing when
you archive or delete it plays to the end; a playlist skips it from then on. An archived show can't be
edited from another browser that still has it open until you restore it.

**Songs.** Only songs in HA-liday Show's own folder (`haliday_show` in your media folder, where uploads
and the Music editor's saves go) can be archived or deleted here, as the rest of your media folder
may belong to other apps; **Remove…** is greyed out for the others. If shows use the song, choose what
they play instead: **Another song**, or **No song for now** (they keep their effects and beats, and
play the lights only). An archived song moves to an **Archived** folder inside HA-liday Show's
folder, where it's out of HA-liday Show's song lists but still in Home Assistant's Media. Restoring it
puts it back and gives it back to the shows that were left without a song.

### Samples

**Library → Samples** keeps short sounds, such as sleigh bells, a "ho ho ho" or a voice saying "Merry
Christmas", ready to layer over a song in the Music editor. There are two ways to make one:

- **From a song:** in the Music editor, select the stretch you want and press **Save as sample…** (in
  the **Edit** panel), then give it a name. It's saved as it sounds in your edit, layers and all.
- **From a file:** press **+ Add a sample** and pick one or more files (the same kinds as songs).

They go in a **Samples** folder inside `/media/haliday_show/`, kept out of **Library → Songs** and a show's
song list so those stay tidy. Use them on a [layer](#layers) in the Music editor. Each sample has **▶** to hear it (press **■** to stop) and **Delete…** to
remove it for good.

To sort them, press **+ New folder** and give it a name, then pick the folder under **Folder** on each
sample (or pick **New folder…** there). A folder's title folds it away, and **Rename…** and
**Delete…** sit beside it; deleting a folder keeps its samples, which move to **Not in a folder**. The
files themselves stay where they are, so songs that use them still find them. In the Music editor, a
layer's **+ Add a clip** list shows the samples under their folders.

### Editing a song

The **Music editor** cuts, shortens and splices songs before you build a show. Press **Edit** on a
song under **Library → Songs** (with **+ Add a song**) to open it; nothing is touched until you do. The open
song's name sits beside **← All songs**, which goes back to the list to open another. The song you open is never changed: your
first change starts a [draft](#drafts), kept as you go, which you make into a new song file when you're
happy. Drag across the waveform to select (clicking moves the playhead and keeps the selection; press **✕**
next to its times or Esc to clear it), then **Cut selection** to remove it or
**Keep only selection** to shorten the song to it, or let **✂ Suggest cuts…** find the cuts for you (see
[Suggest cuts](#suggest-cuts)). **Insert at playhead** and **Add to end** splice in
another song, which is then selected so you can trim it. Joins blend over the **Crossfade at joins**
time (a few hundredths of a second hides the click, a few seconds blends one song into the next), and
**Fade in** and **Fade out** soften the ends. Zoom with the wheel, or type the selection's times for
precision. **⏮** goes back to the start, and **⏪** and **⏩** go back or on a bar (5 seconds before the song
is detected), carrying on playing if it was. The 🔊 slider by the clock sets how loud it plays in your browser. Once the song is detected, selection edges snap to bars
(hold Shift to place them freely), clicking a section in the lane selects exactly its stretch (Shift-click
adds the next), and **Preview cut** plays the join before you cut, with the playhead jumping over the selection as the cut would. Beats and sections follow your edits
and are kept when you make the song file. Edit the song before placing clips, because cutting it
afterwards won't move them.

Each join shows as a dashed line with a **✂** at the top. Click the **✂** to hear a few seconds either
side of the join; the **Selection** panel says what was cut there (how much, and from where in the
song). To change that cut, press **Adjust cut**: the part comes back and is selected, so drag its edges
(or type the times) and press **Cut selection** again. **Put back** undoes just that cut, leaving the
others as they are. Both are one step for **Undo**. A join where another song was spliced in only has
**▶ Hear join**. When you zoom out, the beat lines thin out to every bar, then every 2nd or 4th bar, so
the music stays visible; zoom in to see every beat.

You can also use the keyboard: press Tab until the waveform is outlined, then **←** and **→** move the
playhead a beat at a time (a second at a time before **Detect**), and holding Shift selects as you go.
Space plays, Home goes back to the start, , and . go back or on a bar, Delete cuts the selection, M adds a
[mark](#marks), Ctrl+Z undoes and Ctrl+S makes the song file.

#### Drafts

An edit is kept as a **draft**: a note of which parts of which songs it uses, with its crossfade and
fades, but no audio of its own. Your first change to a song (a cut, a splice, a crossfade or a fade)
starts one, named after the song, such as "sample-song (edit)"; type a better name under **Draft** at
the top. **Draft kept** beside it says it's saved, which happens a moment after every change, so you
can close the page or carry on from another device. If a change can't be kept (HA-liday Show stopped,
say), the status bar says so, even for a draft you've moved on from, and it's tried again with your
next change; closing the page then asks first. A song can have several drafts, such as a "Short
version" and a "Party mix": press **Edit** on the song again to start another.

**Library → Songs** lists each song's drafts inside its card (see [Songs](#songs)): as **✎ Draft · no
file yet** until a song file has been made from it, then with that file as **✂ Edit · song file**.
**Open** (or **Edit draft**) carries on where you left off (**Undo** starts afresh each visit),
**Rename…** renames it, and **Delete…** deletes the draft (not the song, or any file it made).

**Make song file** (Ctrl+S) writes the draft as a WAV in `/media/haliday_show/`, named after the draft,
so every speaker can play it; pick it under **Song** in a show. Its beats, sections and marks go with it.
The draft stays open, so you can keep changing it. Making it again asks whether to **Replace it** (the
same file, so shows and playlists using it get the new version; the window lists those shows, since
their effects don't move with the music, and any other drafts that splice that file in, which will play
the new version too) or **Make a new file** (such as "Short version 2.wav"). Making a
song file without changing anything is a quick way to get a WAV copy of a song.

**Even out the volume**, beside **Make song file** and on unless you turn it off, turns the new file up
or down so it plays at about the same loudness as other songs made here, the level most streaming
services play at. That way one song doesn't blast out after a quiet one in a playlist. Only the overall
level changes, and a song is never turned up so far that its loudest moments would distort, so a very
spiky one may stay a little quieter. The status bar says how much it was turned up or down. The switch
is remembered in this browser.

Songs you edited before drafts existed are ordinary songs: press **Edit** on one to start a draft from
it. A draft can't be opened if a song it uses has been archived or deleted; restore the song first
(under **Archived songs**). Until then, drafts whose song has gone are listed together at the end of
**Library → Songs**, under **Drafts of songs that aren't here any more**, so you can still delete them.

#### Layers

Layers play samples or other songs on top of the song: sleigh bells over the intro, a "ho ho ho" on the
last chorus, a voice saying "Merry Christmas", or another song fading in under the end.

1. Under the waveform, in the **Mixer**, press **+ Add layer** (up to four). Its row has a name, a
   **Volume**, **EQ** (see [Mixer](#mixer-bass-mid-treble-and-tempo)), **Quieten the song**, **Match
   tempo** and **Remove**, and a lane appears under the waveform for its clips.
2. Put the playhead where you want a clip to start, then pick a sample or song from **+ Add a clip at
   the playhead…** on the layer's row. It starts a little quieter than the song, so it sits in the mix;
   change that with the clip's **Volume**.
3. Drag a clip to move it (it snaps to bars, beats and marks; hold Shift to place it freely). Drag its
   left or right end to trim it. Click a clip to pick it (the playhead goes where you clicked): its panel
   has **Volume**, **Fade in**, **Fade out**, **▶ Hear it**, **✂ Split at playhead** (or press S) and
   **Delete** (or press Delete). Each clip shows its own waveform and, once its song has been detected,
   its sections in their colours, so you can see where its chorus or drop is. To use just parts of a
   song on a layer, split it where each part starts and ends, delete what you don't want and drag the
   rest where it goes.
4. To make a layer stand out, such as a voice saying "Merry Christmas", tick **Quieten the song** on its
   row. The song dips a little while that layer's clips play (starting just before each one) and comes
   back up gently after. It's off for new layers.

Each clip is pinned to the moment in the song it starts at, so it moves with your cuts: cut a bit
earlier in the song and it moves earlier with the music; cut the part it sits on and it's left out
(**Undo** or **Put back** brings it back). A new clip is trimmed to the song's end. One that runs past it (after a cut, say) stops there, and
its end sits at the song's end so you can drag it in.
If you delete a sample a draft uses, its clips show greyed out and silent until you delete them or add
the sample back. Layers are part of the draft and every change is one
**Undo** step. **Make song file** mixes the layers into the new file, keeping the mix from
distorting where they pile up. The waveform, **Detect** and **Suggest cuts** go by the song alone, and a
sample saved with **Save as sample…** includes the layers.

#### Mixer: bass, mid, treble and tempo

The **Mixer** under the waveform works like a DJ's, for mash-ups and for making a layer sit well with
the song. The song has a row, and so does each layer.

- **EQ** opens that row's **Bass**, **Mid** and **Treble** faders in the **Selection** panel (press it again,
  or **✕**, to close them; another row's **EQ** swaps to its faders). Each goes from +6 dB down to **off**
  at the bottom: take the bass out of the song while a layer's bass carries it, say, or the treble off a
  layer so it sits behind. The **EQ** button is highlighted when anything is changed.
- **Changes partway through:** put the playhead where it should change, press **+ Change here**, then
  move the faders. From there the sound glides to the new settings over **Glide** seconds (1 by
  default; 0 for an instant switch). The faders always show, and change, the setting at the playhead:
  before the first change that's the row's own setting. A change shows as a small diamond: the song's
  along the bottom of the waveform, a layer's in its lane. Click one to put the playhead on it, drag it
  to move it, and press **Delete change** (or Delete) to remove it. Changes move with your cuts, like
  clips.
- **Match tempo** on a layer speeds up or slows down its clips to the song's tempo, keeping their pitch,
  so a loop or another song stays in time. The song needs **Detect** first, for its tempo. Each clip's
  own tempo is taken from its beats if it's been detected, or found when it's added (a clip needs a few
  seconds of steady beat). If it's wrong or missing, click the clip and type it under **Tempo**. A clip is
  never stretched more than about 1.4 times either way: one at half or double the song's tempo plays
  in time at about its own speed. Line the clip's first beat up with a bar (clips snap to them).

All of it is part of the draft, every change is one **Undo** step, and **Make song file** includes it.
The waveform still shows the song as it was, without the mixer.

#### Suggest cuts

**Suggest cuts** finds places to make the song, or one section of it, shorter without the join being
heard: for when the intro goes on too long, say, or the song is longer than your show needs. It works
in whole bars, so the song needs to be detected first (**Detect**).

1. Press **✂ Suggest cuts…** in the **Edit** panel, or pick a section in the lane and press **✂ Shorten…**.
   A window opens, set to the section you've picked (or **the whole song** if you haven't picked one).
2. Under **Shorten**, choose **the whole song** or a section. Under **To about**, type how long you'd
   like it, as 1:30 or 90. It starts at half the section, or three quarters of the song, and shows how
   long it is now.
3. Press **Find cuts →** (or Enter). You get up to three options.
4. Press a cut's **▶** to hear a few seconds either side of its join. What it would take out shows in
   red on the waveform.
5. Press **Use** on the one you like. The cut is made and the window closes. **Undo** in the **Edit**
   panel (or Ctrl+Z) takes it back. To try another length instead, press **← Back**.

It only takes out whole bars, in 4- or 8-bar phrases where it can, and only where the music either side
of the join matches, such as a loop that repeats or a verse and chorus that come round again. For the
whole song, an option can be several cuts, taken from parts that are heard again elsewhere, and it never
cuts off the ending (use **Fade out** for that). Each option says how many bars go, how much shorter it
makes things, and how well its join matches: **smooth join**, **good join** or **join may be heard**.
If nothing fits, it says so; try a length a little longer or shorter.

With an [AI set up](#setting-up-the-ai), it's also asked which option works best musically. The
options show straight away, so you can listen while it thinks. When it answers, the one it thinks
works best is marked **AI's pick** and each gets a short reason under it (such as "Drops the repeated
second verse; keeps the 1:12 crash"); they stay where they are, so nothing moves as you reach for
**Use**. It asks once each time you press **Find cuts →** (and only when there's more than one option),
which counts as one AI request. It goes by the song's name (it may know the song), your section names and notes
(the ones you wrote count most) and your [marks](#marks), so it steers away from cutting a moment you've
marked. It can't hear the song, so listen to the joins yourself. If it can't answer, the options are
still there, without its pick.

Nothing changes until you press **Use**, and the song you opened is never changed: a cut you use goes
into your [draft](#drafts), and **Make song file** turns it into a new song file.

### Marks

Marks flag moments in a song you want to light, such as a big hit, the bells coming in or the last
note. They're kept with the song, so every show that uses it gets them, and they don't change when you
**Detect** again.

- **Add one:** in the Music editor, put the playhead where you want it and press **⚑ Add mark** (in the
  **Beats and sections** panel), or press **M**. **M** works while the song plays, so you can tap
  it along with the music and name the marks afterwards. You don't need to **Detect** the song first.
- **Name, colour or delete it:** click its flag in the beat lane (the playhead jumps to it), and change it
  in the **Selection** panel. Type a
  **Name**, pick a **Colour**, or press **Delete**. **Move to playhead** moves it to where the playhead is,
  and **✕** or Esc closes it. Each new mark takes the colour you picked last.
- **Move it:** drag its flag. It snaps to beats and bars; hold Shift to place it freely.

In the **Show editor**, a song's marks show as coloured flags on the **Beats** lane, with a line down
through every light, and clips snap to them (when **Snap** is on) so you can line an effect up with
the moment. They're read from the song each time you open the Show editor, so marks you add in the
Music editor show straight away. To change them, go back to the Music editor.

Marks follow your cuts: a mark in a part you cut out disappears from the edit, and the rest move with
the music and go with the song file when you **Make song file**. You can add, change and move marks while you're
editing too. They're saved on the song you opened as well, at the same moment in it, and that song keeps
all its marks, even ones in parts you cut out of the edit. A song spliced in brings its own marks,
shown faintly with a dashed line; they go with the song file too, but you change them on that song
itself. The one place you can't add a mark until you've made the song file is a part spliced in.

### Detecting in the Music editor

**Detect** in the Music editor finds a song's beats, bars and sections and keeps them with the song file,
drawn over its waveform. A song file you make from a draft keeps the beats and sections that followed
your cuts. A song spliced in brings its own beats, sections (with their names and notes) and marks, so
nothing is lost. Only if a song in it hasn't been detected yet is the new file detected afresh (the
marks still go with it). When a show picks that song
under **Song**, it takes them automatically (asking first if the show already has beats), and **From
song** in the Beats panel brings them back later. Detect in the editor also saves its results with the
song. Each show keeps its own copy, so moving beats in one show doesn't change the song or other shows.

### Editing sections

In the Music editor, the lane above the waveform shows each section in its colour.
Click one to change it in the **Selection** panel: rename it or pick its colour (every section with the same name changes colour together),
**✂ Shorten…** it (see [Suggest cuts](#suggest-cuts)),
**Split at playhead**, **Merge with next** or **Delete** it, and drag the line between two sections to
move it. Changes save with the song; a show that already uses the song picks them up with **From song**.
Give a section **Notes** to tell **Describe it** what happens there or how you'd like it lit, such as
"bells only, very gentle" or "big drop at the end, everything flashes"; the AI follows them.

You don't have to write them all yourself. **Detect** writes notes for every section, and **✨ Describe
sections** writes them again for the sections as they are now (after you've split or moved them,
say). It listens to each section and notes how loud it is, whether it builds up or fades, whether it's
busy or sparse, bass-heavy or bright, any big hits or moments it goes quiet (with their times), and
which earlier section it's like. It then suggests how to light it, for example: "Loud, busy, lots of
hits; builds up through it; big hit at 0:42. Everything on, moving and flashing on the beat; flash
everything on the hit." Notes you've typed or changed are never replaced, and nor are names you've
given sections: pressing **Detect** again carries them over to the new section that covers the same
stretch of the song. Edit anything it writes; once you do, it's yours.

With an AI set up (see [Setting up the AI](#setting-up-the-ai)), the AI then rewrites those notes,
usually within a minute, while you carry on. It can't hear the song, so it works from the same
measurements and the song's name. If it knows the song, it uses what it knows: which part is the verse
or the chorus, where it builds. It also gives the sections Detect named itself better names, such as
**Part B** becoming **Verse**, but never a name you gave. If you edit the sections before it's done,
its notes aren't used, so press **✨ Describe sections** to ask again. Without an AI, or if it can't
answer, the simpler notes stay.

### Beats

Press **Detect** to have the editor listen to the song and find its tempo, every beat,
where each bar starts (drawn as stronger markers) and its sections, which show as tinted, named bands
behind the waveform (Intro, Verse, Chorus, Bridge, Outro). It runs in your browser in a few seconds,
with nothing sent anywhere. Detection reads songs as 4/4 and prefers a lively tempo, so a slow ballad
may come out at double time; type the BPM you want and press **Fill** if so. You can also press **B**
(or **Tap beat**) in time with the music while it plays, type a **BPM** and press **Fill** to add beats
from the playhead, or click the beat lane to add or remove one. **Clear** removes the beats and
sections. With **Snap** on, clips and selections snap to beats and to each other; hold Shift to
place freely.

### Suggestions

Once the song has been analysed, **＋ Add effect…** on a selection starts with looks
suggested for that part of the song: soft ones for a quiet verse, fast ones that move on the beat for
a loud chorus, with speeds set from the tempo and colours from the palette picked in the palette bar.

### Describe it

Type what you'd like in the **Describe it** panel and press **✨ Create**, for example
"red and green chase on the roof in every chorus, gentle white twinkle on the tree the rest of the time"
or "strobe everything on the last four bars". An AI turns it into effects on the lights you name, lined
up with the beats and sections, and they replace what those lights had at those times. If you select a
stretch first and the request doesn't say where or when, it works on the selection. Anything the AI gets
wrong (a light or effect that doesn't exist) is left out and listed in the status bar, and Ctrl+Z undoes
the lot. It needs an AI to be set up first; see [Setting up the AI](#setting-up-the-ai).

### Generate

**✨ Generate** in the Show panel opens **Generate a show**, which makes a first draft of the whole show
from the song.
Pick the **Colours** (any palette) and a **Style** (Calm, Balanced or Lively), and it fills your lights
with effects that follow the song: soft, slow looks in quiet parts, faster ones that move on the beat
as it gets louder, every light moving together in the chorus, the same looks each time a section comes
back, and a change every few bars. Quiet starts and ends fade in and out, and with lights traced on the
house photo, turn on **Sweep across the house as the music lifts** for a sweep from one side to the
other. It runs **Detect** first if the song hasn't been analysed. It replaces the lights' effects, so Ctrl+Z brings them back; press it again for a
different take, then edit whatever you like. The colours start on the palette for the time of year
(Halloween in October, Christmas in December…) when there is one.

**Longest effect** sets how long one effect may run before the look changes: **2 bars**, **4 bars**
(to start with), **8 bars** or **Any length**. A bar is four beats, so 4 bars is about 8 seconds at
120 BPM. **Rules** keep to it; an effect from the **AI** that runs longer is cut at bar lines into
pieces, each in the next colours of your palette, so the look keeps changing.

**Build up** (on to start with) lights the house the way you would by hand rather than lighting
everything all the time. Quiet parts use only a few lights and leave the rest dark. Middling parts
start with about half and bring in another every few bars, starting afresh in each part of the song.
Only the loudest parts and the chorus use every light at once (in a song with neither, its loudest
part does), so every light gets its moment. A part of the song that comes back uses the same lights
each time, and the parts of a split light (like **Pillars · Left** and **Pillars · Right**) go on and
off together. A song that hasn't been analysed into parts fills every light. Turn it off to fill every
light all the way through. It works for the **AI** too.

Lights on **Whole light (one colour)**, and Home Assistant lights and switches, can only change a few times a second,
so Generate gives them looks that suit that: colour changes, fades and pulses of the whole light, still
blocks and slow gradients, never faster than once a beat. The AI is told the same, and the effect ideas
in the **Selection** panel follow suit for those lights.

With an AI set up (see [Setting up the AI](#setting-up-the-ai)), **Made by** picks who makes it:
**Rules** is instant, as above; **AI** sends the whole song to the AI with the same colours and style,
and it follows the **notes** you've written on the song's sections in the **Music editor** ("the guitar
solo, make it flash", "keep this bit dark"). It takes 10 to 60 seconds. Meanwhile a window headed **Generating** with your
show's name covers the editor with a spinner and the time so far, so nothing changes underneath it.
**Cancel** (or Esc, or Back on a phone) stops waiting and leaves the show as it was.

### The timeline

Each light has a track, with the **House** lane at the top. The timeline is never taller than
your screen: with lots of lights it scrolls them inside itself, and the times, song and beats stay at
the top. Scroll through the lights with the mouse wheel over their names (or drag the scroll bar), and
along the song with the wheel over the tracks; zoom with the **−** and **+** buttons in the Timeline panel, the + and − keys, or
Ctrl+wheel (or a trackpad pinch) around the pointer. Click the ruler to move the playhead. The **▸**
before **House** folds the [group lanes](#group-lanes) away, and the one before a split light's name
folds its parts (see [The whole light as one](#the-whole-light-as-one)); **▾** brings them back.

### Adding effects

Drag across a light's track to select a stretch of time (drag up or down to
cover several lights; a plain click selects up to the next beat; hold **Alt** to start a selection
on top of an existing clip). Press **＋ Add effect…** in the Selection panel to open the effect
chooser: a button for every effect, each with a strip playing it on that light for the selection's
length, so you can see it first. Click one to add it (Esc or ✕ closes it without adding). The last
effect you added also gets an **Add … again** button, for laying down a run of the same thing. With
the House lane and lights selected together, the chooser has a section for each. To clear a stretch,
select it and press **Delete effects here** or the Delete key: effects inside it are removed and
ones crossing its edges are trimmed.

### Editing a clip

Click a clip to select it. Drag it to move it (onto another light too), drag
its edges to resize it, and change its effect, colours and settings in the Selection panel. While a
clip is selected it loops on its own in a strip at the top of its settings, so changes show
straight away. To swap the effect, press the **Effect** button: it opens the same effect
chooser used to add one, playing on that light for the clip's length, with the current effect
outlined. Changing effect keeps the clip's colours and brightness.

Previews show what the real light will do. A light on **Whole light (one colour)**, or a Home
Assistant light or switch, can only change a few times a second, so its previews (the timeline,
**Preview**, the house photo, the Selection strip and the effect chooser) step at that pace rather than
moving smoothly, and a **Whole light (one colour)** light shows the single colour it really will.

On one of these slow lights, the Selection panel warns **⚠ Too fast for this light** when a clip's effect changes
faster than that, such as a quick chase, sparkle or strobe. It would look steppy on the real light.
Slow the effect down, or use a fade, pulse or colour change instead.

House lane effects are checked the same way, light by light: the warning names each slow light the
effect is too fast for, such as **⚠ Too fast for Porch (a Home Assistant light)**. Realtime lights in the
same sweep or wave are fine.

### Effects a light can't show

Not every effect works on every light. A light set to **Whole light (one colour)** shows one colour at a
time, so a chase, comet or two-colour blocks come out as one steady colour. A light with only a few
segments can't show a chase wider than itself.

- In the effect chooser, effects that won't work on the light are greyed out. Click one to see why.
  Turn on **Allow effects that won't work** to pick them anyway.
- Effects that work, but not quite as meant (too fast for a slow light, a House lane effect that is
  too fast for one of your slow lights, or one that leaves out lights you haven't traced on the photo),
  are marked **⚠**.
- On the timeline, clips that won't work are hatched with a red corner and a **⚠**; ones that only
  partly work get an orange corner. Select one and the Selection panel says why. When you open a show,
  a message says how many of its clips won't work.
- Nothing is changed or removed for you: such clips stay in your show and play as before. They are
  marked again whenever you change a light under **Setup → Devices**, say from **Realtime** to **Whole
  light (one colour)**.
- **Copy to all lights**, paste and adding an effect to several lights at once leave out the lights it
  won't work on, and say which. **Generate** and **Describe it** only use effects that work.
- A light whose realtime mode only reaches part of it, like the 30 m Christmas String Lights 2 (H70C5)
  at 44 bulbs, shows **⚠ first 44 bulbs only** under its name on the timeline.

### Presets

Most effects can look very different depending on their settings (Three colours can sit
still, alternate, or run as a slow or fast marquee). Turn on **Show presets** in the effect chooser and
each effect becomes its own boxed group: **Default** first, then its presets, each previewed. Picking
a preset sets just the settings it names. When adding an effect it uses the effect's default colours;
when changing a clip your colours stay. The Effect button shows the preset a clip matches, such as
**Three colours · Wide marquee**. The chooser remembers whether presets were showing.

Some presets come from WLED's favourites: **Heartbeat** (Pulse), **Meteor** (Comet), **Twin scanner** (Scanner)
and **Dark sparkle** (Twinkle: lit all over in your colour, with bulbs blinking out).

### Your own presets

Get a clip looking right, then press **Save as preset…** under its settings.
Name it and choose whether to **Include colours** (on by default; turn it off to save just the
movement and other settings, so the preset takes on whatever colours a clip already has). Your
presets appear in the effect chooser after the built-in ones, marked with a ★, and **★ My presets
only** narrows the chooser to them.

### The Presets tab

**Library → Presets** lists your presets by effect, each with a live preview, and **Edit…**,
**Duplicate** and **Delete…**. **Edit…** opens the preset in a window with a larger preview (choose
which light's segments with **Preview on**). Rename it, change its **Effect** (or start again from one
of that effect's presets), turn **Include colours** on or off, and change its colours (palettes work
here too), settings and brightness; the preview follows every change. **Save** keeps the changes and
**Cancel** leaves the preset as it was. **+ New preset** starts one from scratch: pick an effect, or
any built-in preset, to start from, then **Add preset** in the window. Or describe a look in
the box above, such as "slow icy shimmer" or "warm fire flicker", and press **✨ Make presets**: the AI
suggests up to three, each with a live preview, and **Keep** adds one to your presets (it needs an AI
set up, as for **Describe it**). Changing or deleting
a preset doesn't change clips that already used it. They're saved in HA-liday Show, so every browser
sees the same ones.

Turn on **Show on the light** to loop it on the real light too while the show is
stopped; the light goes back to normal when you click away. Every effect has a **Brightness %**
slider, so one section can glow softly and the next hit full brightness.

### Copying

Select a clip, or click a light's name to select all its effects, press **Ctrl+C**,
click another light's name and press **Ctrl+V**. Pasted effects keep their times so the lights stay
in step; pasting onto the same light puts them at the playhead. With a light's name selected you
can also **Copy all effects to** another light or all of them, optionally replacing what they had.
Effects scale to each light's segment count. **D** duplicates the selected clip.

### Colour palettes

An effect's settings include a **Palette** picker. Click a colour to put it in
the colour field you last clicked, or press **Apply palette** to fill them all in order. Click a
light's name to **Recolour this light** or **Recolour all lights**: each light steps through the
palette effect by effect, so the lights stay matched (backgrounds are left alone). **Library →
Palettes** lists your palettes, each with **Edit…**, **Duplicate** and **Delete…**, then the built-in
ones (seasonal ones, plus looks such as **Classic C9 bulbs**, **Lava**, **Aurora** and **Ice and fire**). **Edit…** opens a window to rename the palette and change its colours: pick each colour, move it
up with **↑**, take it out with **✕**, or **+ Add a colour** (up to 12). **Save** keeps the changes.
**+ New palette**, or **Copy…** on a built-in one, opens the same window for a new palette. Or describe some colours in the box above, such as
"frosty winter night" or "tropical sunset", and press **✨ Make palettes**: the AI suggests up to three, each
shown as a colour bar, and **Keep** adds one to your palettes (it needs an AI set up, as for
**Describe it**). Your palettes are available in every show.

### Lights that are gone

A track whose light was removed from the Devices tab shows as **Missing
device**, and isn't played. Click its name and press **Remove from show** to take it out with its
effects (Ctrl+Z brings it back), or **Remove all unplayed tracks** when there are several.

### Working on one part

Drag along the time ruler to set a **play region**, or select a stretch
and press **▶ Play this part**. Play then plays just that part, and Home goes back to its start.
Turn on **Loop** to repeat it (or the whole show when there's no region), and clear the region with
its ✕. Region and Loop apply when the song plays in the browser; on a speaker the whole show plays.

### Undo

Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, even after a change has been saved.

### Shortcuts

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Home | Back to the start (of the play region, if there is one) |
| B | Add a beat at the playhead |
| Delete or Backspace | Delete the selected clip, or clear the selected stretch |
| D | Duplicate the selected clip |
| Esc | Deselect |
| Ctrl+C / Ctrl+V | Copy and paste effects |
| Ctrl+Z / Ctrl+Shift+Z | Undo and redo |
| Ctrl+S | Save |
| + / − | Zoom the timeline in and out |
| Ctrl+wheel | Zoom round the pointer |
| Shift while dragging | Place without snapping |
| Alt while dragging | Start a selection on top of a clip |

## Effects

**Effects on a light** run along that light, from the plug end (or the other end with
**Reverse**). In the effect chooser they're under headings: **Basics**, **Movement**, **Sparkle and
festive** and **Calm**.

Fairy lights, Ocean waves, Aurora, Flowing colours, Juggle, Ripple, Bouncing balls and Stacking blocks take a list of up to 8 colours. Set
**Colours** to how many to use, and only that many colour boxes show. **Apply palette** fills the
whole list from the palette and sets **Colours** to match.

| Effect | What it does |
| --- | --- |
| Solid | One colour |
| Two colours, Three colours | Solid colours side by side. **Split** divides the light into halves or thirds; **Alternate** repeats them along it, **Segments per colour** wide. **Move** slides them along like marquee lights (negative numbers go the other way). |
| Pulse | Breathes between a colour and the background. **Shape: heartbeat** beats twice, lub-dub, like a heart |
| Gradient | Blends two or three colours along the light; **Move** slides it back and forth |
| Colour cycle | The whole light changes through two to four colours, fading or stepping |
| Fade | Fades from one colour to another over the clip; fade to a darker colour for a gentle dim |
| Chase | A block of colour running along the light |
| Rainbow | A moving rainbow |
| Comet | A bright head with a fading tail running along the light. **Tail: sparkly** breaks the tail up as it fades, like a meteor |
| Scanner | A dot bouncing from end to end. **Eyes: two** sends two dots from opposite ends, crossing in the middle |
| Flicker | Candle or fire flicker between two colours |
| Lightning | Random bright flashes over a dark background |
| Strobe | Flashes on and off |
| Twinkle | Segments sparkle at random |
| Wipe | Fills the light with colour over the clip |
| Halloween eyes | Pairs of eyes open somewhere along the light, blink, and close again. Set how many pairs, their size and the gap between them |
| Fireworks | Bursts in up to three colours bloom along the light and fade. Set how many a second and how big |
| Drip | Drops swell at one end, fall faster and faster and splash at the other. Set **Icicle length** to the length of each icicle on icicle lights, so every icicle drips on its own |
| Candles | Every segment (or every few, with **Segments per candle**) flickers like its own candle, with the odd draught |
| Snow | Flakes fall along the light, some near and some further off. The **Rain** preset turns it into fast blue rain |
| Fairy lights | Each bulb has its own colour from a list, in turn or mixed up, and fades on and off on its own |
| Ocean waves | Swells of your colours roll along the light, from the deep (first colour) to the crests (last) |
| Aurora | Curtains of colour that drift, brighten and fade, like the northern lights |
| Flowing colours | Soft patches of your colours that drift and blend into each other |
| Sunrise | Dark, then deep red, orange and gold, then daylight, over the length of the clip. **Way: sunset** goes the other way |
| Theatre chase | One segment lit in every few, stepping along like theatre marquee lights. **Lit in: rainbow** makes a rainbow chase |
| Juggle | A dot for each colour swings back and forth at its own pace, leaving a fading trail |
| Ripple | Drops land at random and ripple outwards in your colours |
| Dissolve | Segments light one at a time in a random order until the light is full, then go out the same way |
| Bouncing balls | Balls in your colours bounce up from the start of the light. **Style: popcorn** pops kernels up at random instead |
| Lighthouse | A soft beam sweeps along the light once a turn, with a faint glow in between |
| Stacking blocks | Blocks drop from the far end and pile up until the light is full, then it fades and starts again |
| Fill to a level | Lit up to a level that moves from **Level at the start** to **Level at the end** over the clip. The **Count down** preset empties it |

**Effects on the House lane** run across all your lights at once, by where each one is on the
house photo, like xLights' model effects. Add them the same way, by selecting a stretch of the
House lane. They sit on top of each light's own effects.

| Effect | What it does |
| --- | --- |
| Sweep | A band of colour crossing the house. Set its **Width** and how many **Sweeps** fit in the clip. |
| House wipe | Fills the house with a colour over the clip, with a **Soft edge**. |
| Rainbow wave | A rainbow across the house; set how many fit across it and how fast it moves. |

- **Direction** can be left to right, right to left, top to bottom, bottom to top, out from the
  centre or in to the centre.
- **Elsewhere** decides what lights outside the band show: the **Background** colour, or their own
  effects.
- Only lights traced on the House tab take part, and bulbs marked out of view are left alone.
- Positions are worked out when the show is saved. Playing from the editor picks up any retracing
  by itself, but a show started from an automation needs saving again after you retrace a light
  (any edit with Auto save on does it).

#### Group lanes

Each [light group](#light-groups) has a lane under **House**, named after it. Press the **▸** before **House** to fold
all the group lanes away under it, and **▾** to bring them back. Folding is remembered in your browser, and
a stretch selected across lights leaves folded tracks out. Select a stretch of it and
press **＋ Add effect…**, and the chooser has two kinds:

- **Along the group, as if its lights were one strip**: any light effect, running through the group's
  lights and parts one after another, in the **Devices** tab's order. A chase on the roof icicles runs off
  the end of the left strip and on into the right one. Change the order on the Devices tab.
- **Across the group, by where its lights are on the house photo**: **Sweep**, **House wipe** and
  **Rainbow wave**, as on the House lane but measured across just the group's lights, so a sweep crosses
  the whole group, however much of the house it covers.

While a light effect runs on a group it takes over the group's lights from their own effects; a House
effect on a group goes over them, as on the House lane (and the House lane still goes on top of
everything). Before and after, each light plays its own. **✨ Generate** clears the group lanes, as their
effects would cover its new look (Ctrl+Z brings them back). Selecting a group lane with lights or the House lane
puts light effects on the lights and House effects on the House lane, as before. Changing a group
updates the saved shows that use group lanes, so automations and playlists play it straight away.
Shared shows don't carry group lanes, because the groups are yours.

## 5. Play it

### Saving

**Save** stores the show and bakes every frame for playback (Play saves first if
needed). With **Auto save** on in the show's settings (the default), the show also saves itself a couple of seconds
after each change and when you switch shows; the note next to it says whether everything is saved.
A new show is saved once it has its first effect. Auto save waits while a show is playing.

Whenever something saves (a show, your lights, palettes, presets, playlists or the house photo), the
top right of the page lights up green for a few seconds, then settles to a small **✓ Saved** with the
time, so you can always see when something last saved. If a save fails, or something else goes wrong,
the message shows in red and stays until you press it, or until the same thing works again. A nudge
such as "Choose a song first" shows in orange and fades by itself.

### While you edit

The Playback panel chooses where the song plays. This is kept in your browser
and never changes where the real show plays:

- **Song in this browser**: the song plays in your browser and HA-liday Show streams the lights in
  sync. Turn off **Lights** to preview in the browser only. If the lights lead or lag, adjust
  **Light offset** under **Setup → Speakers**. The 🔊 slider next to the clock sets how loud the song
  plays in your browser. The **Music editor** shares the same level, and your browser remembers it.
- **Speaker: …**: HA-liday Show starts the song on that speaker and the lights with it, and the
  playhead follows along. Line the lights up with the speaker's **Delay ms** under **Setup →
  Speakers** (also shown under Timing there while that speaker is picked).

### The real show

**Show speaker** in **⚙ Show settings…** (Show panel) is where the song plays when the show is
started from an automation or the MQTT Play button. Leave it on **Default** to use the default show
speaker from the Speakers tab, or pick a speaker for this show only. So you can design on a speaker
indoors and the real show still plays outside. With no show speaker and no default, the lights play
on their own.

### Scenes

A scene sets every light at once, like a preset in WLED or a one-tap scene in a lights app, and
plays until you choose something else. Use one for the hours your lights are on between shows.

Your scenes are under **Library → Scenes**, and **Edit** opens one in the **Scene editor**. Each scene shows its colours and what it plays, with **▶ Play** (or **■ Stop**
while it's on), **Edit** and **Remove…**.

- **+ New scene** asks for a name. Every light starts on a steady warm white, so it does something
  the moment you play it.
- In the editor, each light has its own row: its **Effect**, its **Colours** (a colour box for each,
  and **Palette…** to use one of your palettes), and **Speed** and **Brightness** sliders. Press the
  effect to change it: the same window as the Show editor's opens, with every effect moving in the
  light's own colours. Tick **Show presets** there to pick a preset; the effect then shows its name,
  such as **Three colours · Still blocks**. **Off** beside it turns the light off in this scene.
- A light split into parts plays one look across the whole light. Turn on **Each part on its own**
  under its name to give every part its own row instead, each starting on the light's look. A light set to play only as parts always
  has a row for each part.
- **Same for every light** puts one row in charge of all your lights. Turn it off again and each
  light starts from that look, ready to change one at a time.
- The **Preview** shows the scene moving on your house photo. Changes save as you make them.
- **▶ Play on lights** plays it on your real lights, round and round. Change it while it plays and
  the lights follow.

**Advanced** (beside the scene's name) opens the scene in the **Show editor**, for a scene that changes
over time or runs across the house: effects can start and stop on the timeline, and the **House** lane
works as in a show. Each light's look becomes one effect across the whole timeline to start with.

- The timeline is one time round. The banner under the Show panel's title says how long:
  **Goes round every** 20 seconds to start with, up to 10 minutes. Making it shorter cuts effects at the
  new end; dragging an effect past the end makes it longer.
- There's no song, so the song, beats, ✨ **Generate** and **⚙ Show settings…** are hidden, and
  **Loop** is on. **▶ Play** plays the scene on your lights from the playhead; **⏸ Pause** turns it off.
- It saves as you go, like a show. **← All scenes** goes back to the list, where **Edit** opens it in
  the Show editor again.
- **Switch to Basic** goes back to a row per light. It's only offered while nothing would be lost: each
  light with one effect across the whole loop, played on the whole light, and nothing on the House lane.

Scenes come on and off by themselves from the [Schedule](#schedule) tab. **When it plays** at the foot
of the Scene editor (or **Schedule…** in the banner for an Advanced scene) says what the schedule does
with the scene, with **+ Add to schedule** and **Open Schedule**. **Library → Scenes** says it too.

Scenes are also in Home Assistant, as a scene each and one light whose brightness dims them (see
[With MQTT](#with-mqtt)).

While a scene is on, starting a show or a playlist (from an editor, an automation, a schedule or a
visitor) takes the lights over. When it finishes, or you stop it, the scene comes back after a
couple of seconds, and its row says **Comes back after the show** meanwhile. To turn the lights off,
press **■ Stop** on the scene, or **Stop** while only the scene is playing. **Remove…** deletes a
scene for good, keeping a copy of all your data first under **Setup → Settings → Your data**.

Scenes are made for the lights you have when you edit them. If you add or change lights, open
HA-liday Show and scenes are made again for the new lights.

### Live music

**Setup → Settings → Live music** shows what a WLED light with a microphone hears: how loud it is, each
beat, and the bass, middle and treble. Nothing on your lights reacts to it yet: scenes that do are
coming.

A WLED hears music with a small microphone wired to its controller (an INMP441, say, on an ESP32 board),
with the **AudioReactive** usermod that most ESP32 builds of WLED 0.14 and later include. It doesn't
need to be one of your show lights: a small board by the speaker works well. To have it send what it
hears:

1. In that WLED's web page, open **Config → Usermods** (on some versions it's under **Config → Sync
   Interfaces**) and find **AudioReactive**.
2. Check the microphone is set up and the WLED's own sound effects react to music.
3. Under its sync settings, set **Mode** to **Send**, and leave the port at **11988**.

Within a few seconds it appears under **Listen to**. With more than one WLED sending, pick one, or leave it
on **Any WLED that sends sound** to use the loudest. **Counts as music from** sets how loud counts as music,
so chatter in the garden doesn't. A ⚠ note says if nothing is heard, or if a WLED sends in an older
format (update it to 0.14 or later).

It works on your home network only, and needs nothing from Home Assistant. If HA-liday Show can't listen
on UDP port 11988 (another program on the machine has it), the card says so. With Docker, keep the host
networking from `docker-compose.yml`, or the sound won't reach it; with pipx, let UDP port 11988 in
through your computer's firewall.

### Playlists

To play several shows back to back, open **Library → Playlists**. Each playlist says how many shows it has, how
long it takes to play through once and when it plays, with **Open**, **▶ Play** and **Delete**. Press
**+ New playlist**, or **Open** one, to edit it:

- **Building blocks**, at the left to start with, go between your shows (see below). Drag one in like a show.
- **Your shows**, below them, lists every show. Drag one by its card into **Running order** and let
  go where it should play; a blue line shows where it will land. Or press **+** to add it at the end.
  **Find a show** narrows the list. The same show can go in more than once.
- In **Running order**, drag a show or block up or down to change when it plays, or drag it out of
  **Running order** (back to **Your shows**, say) to take it out. **↑**, **↓** and **✕** do the same with a press. On a phone or tablet, drag
  by the dots (⠿) at the left of a card, so the page still scrolls; there, **Running order** comes
  first and **Building blocks** starts folded.
- The coloured bar above the order shows one time through, each show and block as long as it plays,
  and next to **Running order** it says how long that takes.
- Type over the name at the top to rename the playlist. **Delete playlist** removes it but keeps its
  shows. **← All playlists** (or your browser's **Back**) goes back to **Library → Playlists**.

Changes save as you make them. A playlist holds up to 100 shows and 200 things in all, and you can
have up to 50 playlists.

**Building blocks** fill the time between shows. Each has its own length in **seconds** (up to an
hour), set on its card in **Running order**:

- **Pause**: your lights go back to how they normally look.
- **Colour**: every light shows one colour. Click the colour box on its card to pick it.
- **Off**: every light goes dark.
- **Effect**: an effect plays on every light, such as **Twinkle** or **Rainbow**. Pick the effect, then
  a **Style** (the same ready-made settings as in the Show editor, your own presets too) and, for
  effects with colours, **Colours** from your palettes. An effect longer than a minute repeats every
  minute or so, at a point where the join doesn't show.
- **Scene**: one of your [scenes](#scenes) plays, going round as it does on its own, at your scenes'
  brightness. Pick it on the block's card. It needs at least one scene, made in the **Scene** editor. If
  the scene is deleted later, the block says so and is skipped until you pick another.

Put a block wherever you like: between every show, only before the first, or several in a row (a
colour, then off for a moment, say). Colour, Off and Effect blocks are got ready in your browser, like a show
when you save it: whenever HA-liday Show is open, and straight after you change a block or your
lights. A block that isn't ready yet (if you add lights and don't open HA-liday Show before the
playlist plays, say) is skipped. Playlists made before blocks have a **Pause** after each show,
as long as their old **Pause between shows**.

Press **▶ Play** and HA-liday Show plays the shows in order, then starts again from the top, until
you press **■ Stop**. It carries on with the page closed. A line at the top of **Library → Playlists**
and the Playlist editor says what's playing (a show or a block), which is also outlined in **Running order**. Each show plays on its own **Show speaker**, just as when an automation starts it.
Only saved shows play: a show you haven't saved yet, or have deleted, says so in the list and is
skipped. Playing a show from the editor, or stopping it, stops the playlist, and so does pausing or
stopping the song on the speaker.

#### Music with no speaker: the Show player

A show with no **Show speaker** (and no default one under **Setup → Speakers**) plays its lights only
when a playlist, its schedule or an automation starts it. Without Home Assistant, that's every show.
To hear the music too, use the **Show player**:

1. On a computer or tablet connected to your speakers, open the **Show player** link under
   the **Schedule** tab. Without Home Assistant, the address is `http://<HA-liday Show's address>:8099/player`.
2. Press **▶ Start the Show player** (browsers only play sound after a press on the page).
3. Leave it open. Each song plays there from the right point, and your lights follow it.

Keep that computer from going to sleep while your shows run. If the lights are ahead of the music,
make **Light offset** bigger; if they're behind, make it smaller. Shows you play from the editor, or
on a speaker, don't play in the Show player, so you never hear a song twice.

### Schedule

The **Schedule** tab is where playlists, shows and scenes play by themselves at set times, even with
the page closed. Each row is one thing it plays, then its times, days and dates.

- Press **+ Add to schedule**, then pick what it plays: a playlist, a show (it plays round and round
  for the whole time) or a scene. **+ Add to schedule** under **When it plays**, in the Playlist editor
  or the Scene editor, adds that playlist or scene.
- The same thing can be on the schedule more than once, such as your playlist 17:00 to 22:00 on
  weekdays and 16:00 to 23:00 at weekends.
- Untick **On** to pause a row without losing its times. **Delete** takes it off the schedule.
- A row whose playlist, show or scene you delete stays, greyed out, and is skipped.

Times work like this:

- **From** and **to** set the times, such as 17:00 to 22:00. An end time earlier than the start runs
  past midnight: 20:00 to 01:00 on a Saturday plays until 1 in the morning on Sunday.
- To start when it gets dark, change **From** to **sunset**. You can start up to 3 hours before or
  after it, such as 15 **minutes after**. Sunset moves through the year, so the row does too.
  An end time in the morning (before 12:00), such as 01:00, is the next morning. On an evening the sun
  sets after the end time (21:00 in midsummer, say), it doesn't play.
- Press the days it shouldn't play to turn them off.
- Turn on **Only between** to play just between two dates, such as 25 Oct and 31 Oct. They come round
  every year, and can run over New Year (1 Dec and 6 Jan).

Each row says when it next starts. At the start time a playlist or show starts, even if something else
is playing. At the end time the show that's on finishes, then it stops (a building block that's on
stops straight away), unless another row for the same thing carries straight on. If you press
**■ Stop**, pause the song on the speaker or play something else in between, it stays off until its
next start time. If HA-liday Show restarts during the scheduled time (after an update, say), it
starts again, and so does a row you turn on during its time. Changing the times while it plays
just moves when it stops.

A scene row puts the scene on at its start and off at its end. If a show or playlist is playing,
the scene waits for it to finish. If you turn it off, or put another scene on, before then, it's left
that way until its next start.

#### When times overlap

Playlists and shows take turns, and so do scenes; a scene can be on alongside a playlist or show.

- Where two playlists' or shows' times overlap, the row higher up the list plays first, and the
  other starts once it's finished. The same goes for two scenes. Drag ⠿ (or press **↑** and **↓**) to
  change the order.
- A playlist or show takes the lights over from a scene, and the scene comes back once it's finished.
  For example: **Candy cane** from sunset to midnight, and your show playlist from 18:00 to 20:00. The
  lights glow from sunset, the shows take over at six, the scene comes back once they've finished, and
  everything goes off at midnight.

#### Sunset and the clock

Sunset times are worked out for Home Assistant's location (**Settings → System → General** in Home
Assistant). Without Home Assistant, or to use another place, type your latitude and longitude in the
boxes at the bottom of the **Schedule** tab (they appear once a row starts at sunset), and press
**Save**. **Use Home Assistant's** goes back to Home Assistant's location. On Google Maps, right-click
your house and click the numbers at the top to copy them, then paste them into the first box. Sunset
is worked out to within a couple of minutes. The page shows today's sunset next to the clock.

The schedule goes by HA-liday Show's own clock, which the **Schedule** tab shows. The app uses Home
Assistant's time zone. With Docker, set `TZ` in `docker-compose.yml` to your time zone (such as
`Europe/London`); with Python, it uses your computer's clock.

Schedules you'd set on a playlist or scene before 0.2.233 were moved to the **Schedule** tab for you.

### The public page

The public page lets people passing by start a show from their phone, usually by scanning a QR code
on a sign outside. They see the shows and playlists you've picked, and nothing else of HA-liday Show.

1. Open **Setup → Settings** and turn on **Let visitors start shows** under **Public page**. A **Public
   page** tab appears along the top.
2. On the **Public page** tab, open **Shows** and, under **What visitors can pick**, choose a show or
   playlist next to **+ Add** and press it. Add as many as you like.
3. To try it, open the **Visitors' link** (on **Access**, under **Who can start shows**) on your phone, connected to
   your home Wi-Fi. It's HA-liday Show's address with `:18099` and your code on the end, such as
   `http://192.168.1.20:18099/?c=5fjzqr26`.

Down the left (along the top on a phone) is a list of five pages, as in **Library** and **Setup**, and
the last one you had open is remembered. **▶ Open the page**, at the top, opens your real visitors'
link in a new tab.

| Page | What's there |
| --- | --- |
| **Access** | [Who can start shows](#who-can-start-shows) and [Opening hours](#opening-hours) |
| **Shows** | [What visitors can pick](#what-visitors-can-pick), and [On the page](#on-the-page): how long each lasts and the flashing lights warning |
| **Look** | [How the page looks](#how-the-page-looks): title, welcome, picture, colours, style and the link at the bottom |
| **Words** | [Every message visitors read](#words), to change to your own |
| **Queue** | [The visitors' queue](#visitors-queue) and its limits |

Beside them (below them on a narrower screen) the **Preview** shows the page as visitors with your
code see it, and catches up as soon as you change something. Its buttons don't start anything.

#### Who can start shows

Visitors need the link with your code in it; the QR code on your sign holds it. Opening the page
without the code just says "Scan the code on the sign to start a show".

- **Public address** is the web address your tunnel or proxy gives the public page, such as
  `https://lights.yourdomain.com`. The **Visitors' link** uses it. Leave it empty if visitors only use
  your home Wi-Fi.
- **Copy** copies the link. **New code…** makes a new one, if the link has been shared somewhere it
  shouldn't be. The old link (and any QR code you've printed) stops working.
- **Print sign…** opens an A4 sign in a new tab: your **Title** (in your heading colour, if it reads
  well on white paper), "Scan to start a light show", a big QR code with your visitors' link, your
  opening hours, the **Message on the sign** you type above the button, and the link written out
  for anyone without a camera app. Press **Print sign** there, or **Download QR code** for the code on
  its own as a picture. Set the **Public address** first, so the code takes people to your page from
  the street. Check your phone's camera reads it before you put the sign up, and print a new one
  after **New code…**.
- **Nearby only within … m** (on to start with, at 100 m; anything from 25 to 2000 m): a phone
  reaching the page through the internet must be that close to your house to start a show.
  - As the page opens, the phone asks to share its location. It's only used for this check and isn't
    kept.
  - **▶ Start** only appears once they're close enough. Further away, they see "You're too far away to
    start a show", with the shows listed but no buttons. The page keeps checking while it's open, so
    walking up brings the buttons.
  - A phone that won't share its location is told how to allow it, with **Try again**.
  - Phones on your home Wi-Fi aren't asked. Anyone coming through a tunnel or proxy always is, even
    one set up on the Home Assistant machine itself. (With Docker, keep the host networking from the
    example `docker-compose.yml`, so HA-liday Show sees which phone is which.)
  - Your house is your home location in Home Assistant (**Settings → System → General**), or the one
    you typed in for sunset on the **Schedule** tab. Without either, visitors
    through the internet can't start shows at all until you set one, and the tab says so.
  - The distance is measured generously: a phone that isn't sure where it is gets up to 150 m extra.
    The check stops casual use from afar, but a determined person could fake where their phone is,
    so keep **Queue length** small.

#### Opening hours

Off to start with, so visitors can start shows at any time. Turn on **Only open at set times** to choose
when:

- **Opens**: at a time, or at sunset with a number of minutes after it (or before, if less than
  0), so the opening time moves with the sunset through the year.
- **Closes**: at a time. With a set start, a time before it means after midnight, such as 17:00 until
  01:00. With a sunset start, a closing time before midday is the next morning, and any other is
  that evening; on a day the sun sets after it, the page doesn't open (in summer, say, with a 22:00
  close).
- **On these days**: press a day to turn it on or off.

The line underneath says whether the page is open now, or when it next opens. Sunset is worked out
for your home location, as for playlists; without one, a sunset start never opens, and it says so.

Outside the hours, visitors see when to come back ("Shows start at 5pm. Come back then!", "Shows
start tomorrow at 4:32pm" or "on Saturday at 5pm"), with your shows listed but no **▶ Start**
buttons. Their phones aren't asked for their location until it opens. Anyone already waiting in the
queue at closing time still gets their show. Each show's own dates (below) still apply within the
hours.

#### How the page looks

On the **Look** tab, in four groups: **Title and welcome**, **Picture at the top**, **Colours and
style** and **Link at the bottom**. The preview beside them shows each change as you make it.

- **Title** replaces "🎄 Light show" at the top, and **Welcome** adds a line or two under it.
- **Picture at the top**: **None**, **Your house photo** (from **Setup → House**), or **Your own
  picture**, chosen with **Choose picture…** (JPEG, PNG or WebP). Your own picture is kept with your
  other settings, and in **Export…**, even while another is picked, so you can switch back. Visitors
  with the page open see a new picture within a few seconds.
- **Colours**: **Plain**, **Classic Christmas**, **Frosty** or **Halloween**, with **Light or dark**:
  **Follow the phone**, **Light** or **Dark**. Every combination is easy to read.
- **Your own colours**, the last choice under **Colours**, gives you pickers for **Background**,
  **Cards**, **Text**, **Headings** and **Buttons**. Small print and borders are mixed from your text
  and background, and the words on buttons are black or white, whichever reads better. Underneath,
  it says whether everything is easy to read, or which pairs aren't.
- **Spacing** (**Compact**, **Normal** or **Roomy**), **Corners** (**Square**, **Soft** or **Round**),
  **Text size** (**Small**, **Normal** or **Large**) and **Card borders** (on or off) change the
  layout, and always fit a phone.
- **Falling snow** drifts behind the page. It's left out for anyone whose phone is set to reduce
  motion.
- **Link at the bottom**: its **Web address** and **Its words**, for a charity, donation or social page, if
  you like.

The title, words and picture only show to people with your code.

#### What visitors can pick

- **+ Add** offers your saved shows and playlists. Archived shows aren't offered, nor are playlists
  made only of archived shows, and visitors never see them. A show you archive later disappears from
  the public page straight away, and from inside any playlist visitors pick. The tab still lists it,
  marked as archived, so it comes back if you restore it.
- **Only from … until … every year**: each show or playlist is available all year until you turn on
  **Only from** and pick the first and last day, such as 1 Dec until 6 Jan. The dates come round every
  year, and can run over New Year. Outside them, visitors see it greyed out under **Coming soon** with
  the day it starts ("From 1 December"). When nothing can be picked yet, the page says when the first
  one starts: "Coming soon on 1 December".
- **Remove** takes something off the public page; the show or playlist itself stays.

#### On the page

Also on the **Shows** tab:

- **Show how long each lasts** (on to start with) puts "About 3 minutes" under each show's name,
  worked out from the show. Turn it off for just the names.
- **Flashing lights warning**, for shows with strobes or fast flashes:
  - **Off** (to start with).
  - **A note at the top**: a boxed warning above the shows, always there.
  - **Ask visitors to accept it before Start**: the same note with an **I understand** button, and no
    **▶ Start** buttons until it's pressed. It's asked once per visit.

  The warning's words, and the button's, are on the **Words** tab.

#### Words

Every message visitors read is on the **Words** tab, in groups: the top of the page, the list of
shows, a visitor's own pick, opening hours, **Nearby only**, the flashing lights warning, the closed
and "scan the code" pages, and the sign's "Scan to start a light show". (Your title and welcome are
on the **Look** tab.)

- Each box starts with the wording shown. Type your own and it's saved when you leave the box; the
  preview shows it straight away.
- Parts in curly brackets are filled in as the page runs: `{name}` (a show), `{count}`, `{minutes}`
  ("2 minutes"), `{place}` ("3rd"), `{day}` ("1 December") and `{when}` ("at 5pm", "tomorrow at
  4:32pm"). Keep them where you'd like them, or leave them out.
- **Reset**, next to a word you've changed, puts it back. Emptying a box does the same. **Put every
  word back** resets them all; your title, welcome and link stay.
- The same words are used when HA-liday Show itself turns a request down ("The queue is full…",
  "You're too far away…"), so visitors see your wording there too.

#### Visitors' queue

What visitors get:

- **If nothing's on**, their pick starts straight away.
- **If something's on**, they're told where they are in the queue and roughly how long it'll be, such
  as "You're next, starting in about 2 minutes". They can **Cancel** while they wait.
- **During one of your playlists**, a visitor's pick plays after the show that's on, then your
  playlist carries on with its next show. A scheduled playlist that's due to start waits until a
  visitor's show has finished.
- **A playlist** a visitor picks plays its shows through once, not round and round, without its
  building blocks.
- **The music** plays on the show's **Show speaker** (or your default one), as it does for playlists.
  A show with no speaker plays its lights only, unless the
  [Show player](#music-with-no-speaker-the-show-player) is open.
- Visitors can't stop or skip anyone else's show.

Keeping it fair:

- **Requests per phone** is how many shows one phone can have waiting (1 to start with). Once a
  visitor's show starts, they can pick another. It's a courtesy limit that someone determined could
  get round; **Queue length** is the one that holds.
- **Queue length** is how many shows can wait in all (5 to start with). When it's full, visitors are
  asked to try again in a few minutes.

You stay in charge. Playing a show from the editor or an automation goes on straight away, and the
visitors' queue carries on afterwards. **■ Stop** (or stopping the song on the speaker) stops
everything and empties the queue, and so does **Clear the queue**. Turning off **Let visitors start
shows** empties the queue too, and visitors see "No shows right now".

#### The public page's port

The public page has its own port, **18099**, so nothing of the editor can be reached through it. The
port opens the first time you turn on **Let visitors start shows**. If another app already uses 18099,
pick another under **Public page port** on the app's **Configuration** tab in Home Assistant, then
restart the app. With Docker or Python, set `HALIDAY_SHOW_PUBLIC_PORT` instead.

#### Reaching the page from outside your home

Visitors' phones are usually on mobile data, not your Wi-Fi, so the page needs a web address the
internet can reach. Whichever way you choose:

- Point it at **port 18099 only**, never Home Assistant's own port (8123), so nothing but the public
  page is reachable.
- Use **https** (all the ways below give you that). Phones only share their location with secure
  pages, so with **Nearby only** on, visitors on plain http can't start shows.
- Put the address you end up with in **Public address** on the **Public page** tab, then press
  **Print sign…**.
- Aim it at your Home Assistant's **home network address**, such as `http://192.168.1.20:18099`
  (in Home Assistant: **Settings → System → Network**). It works however Home Assistant is set up.

**Cloudflare Tunnel** (recommended). Free, and nothing changes on your router. You need a free
Cloudflare account and a domain using Cloudflare for its DNS (a domain costs a few pounds a year).

1. Add the **Cloudflared** app to Home Assistant (see its own instructions for adding it to the
   **App store**).
2. On its **Configuration** tab, under **additional_hosts** (the names here are the app's own, at the
   time of writing; its instructions have the details), add one with **hostname** set to the
   address you want, such as `lights.yourdomain.com`, and **service** set to your Home Assistant's
   home network address on port 18099, such as `http://192.168.1.20:18099`.
3. Leave **external_hostname** empty, unless you also want to reach Home Assistant itself that way.
4. Start the app (it logs in to Cloudflare the first time and makes the address for you), then open
   `https://lights.yourdomain.com` and check you see "Scan the code on the sign".

If you manage your tunnel in Cloudflare's own dashboard instead, add a **public hostname** there with
the same address and service (type **HTTP**, URL `192.168.1.20:18099`).

**Tailscale Funnel**. Free, with no domain needed: you get an address like
`https://homeassistant.your-tailnet.ts.net:8443`. You need a free Tailscale account and Funnel
switched on for your tailnet.

1. Add the **Tailscale** app and log it in.
2. Funnel can only use ports 443, 8443 and 10000. Pick one Home Assistant doesn't already use (8443,
   say), and turn Funnel on for it, sending it to `http://localhost:18099`. How to do that depends on
   the Tailscale app you use, so follow its own instructions for sharing another app's port with
   Funnel.
3. Put the `https://…ts.net:8443` address in **Public address**.

**Your own reverse proxy** (NGINX Proxy Manager, Caddy, Traefik and similar, often with DuckDNS). If
you already run one, add a host for the address you want, sent to your Home Assistant's home network
address on port 18099, with an https certificate (Let's Encrypt). This needs ports 80 and 443 open on
your router to the proxy, which puts your home connection on the internet: keep the proxy up to date,
and send it nothing but this page.

**Wi-Fi only**. No internet at all: leave **Public address** empty and the link, and the sign's QR
code, use your Home Assistant's home address. Only phones on your Wi-Fi can open it, so it suits a
guest Wi-Fi that reaches the pavement, or an event with its own network. The nearby check doesn't
ask phones on your Wi-Fi, since being on it shows they're close.

**Home Assistant Cloud (Nabu Casa)** can't be used for this. It only reaches Home Assistant itself,
behind your login, so it can't show a public page.

With Docker or Python, it's the same: point the tunnel or proxy at port 18099 on the machine
HA-liday Show runs on.

#### Keeping it safe

- **Only the visitors' page is on the public port.** Nothing there can reach the editor, your lights'
  settings or Home Assistant.
- **Without your code, visitors see only the page's colours**: not your title, words, picture or
  shows. If the link gets shared somewhere it shouldn't be, press **New code…**; the old link and any
  printed sign stop working at once.
- **Your picture is shared without its hidden details.** Phone photos carry where they were taken (to
  the metre), the phone and the time, and some phones hide an extra picture or a short video in it.
  Visitors get a copy without any of that; for a phone photo, which way up it goes is kept. Your own
  copy, in your backups, is as you uploaded it.  A picture that can't be read well enough to be sure isn't shown at all; the
  preview leaves it out too, so try saving it again from your phone or computer.
- **Each visitor's phone has its own limit** on how often it can ask, so one person (or a script)
  can't slow your lights down or crowd everyone else out. Wrong guesses at the code don't count
  against real visitors.
- **Nearby only** keeps out casual visitors far away, but a phone reports its own location, so
  someone determined at a computer could get round it. **Clear the queue** and **New code…** deal with
  anyone who does.
- **Use a tunnel or proxy with https, not a plain port forward.** Phones only share their location
  with secure (https) pages, so through a plain port forward on your router visitors couldn't start
  shows with **Nearby only** on. Visitors on your home Wi-Fi skip the location check; HA-liday Show
  only counts phones on your home network as at home, never a tunnel or proxy, even one running on
  the Home Assistant machine itself.

## 6. Automations

### With MQTT

With the Mosquitto broker app and MQTT integration set up, HA-liday Show creates an **HA-liday
Show** device with a **Show** select, **Play** and **Stop** buttons, and a **Status** sensor
(the playing show's name, or `idle`). For example, to play a show at sunset:

```yaml
triggers:
  - trigger: sun
    event: sunset
actions:
  - action: select.select_option
    target:
      entity_id: select.ha_liday_show_show
    data:
      option: Halloween
  - action: button.press
    target:
      entity_id: button.ha_liday_show_play
```

You can also publish a show's name or id to the `haliday_show/play` MQTT topic.

Your [scenes](#scenes) are on the same device:

- **A scene for each of yours**, such as `scene.ha_liday_show_candy_cane`. They're in Home Assistant's
  **Scenes**, so you can turn one on from a dashboard, an automation or by voice ("activate Candy cane").
- **One light**, `light.ha_liday_show`, for all of them. Its **Effect** list is your scenes. Turning it
  on plays the scene you pick, or the last one; turning it off turns the scene off. Its **brightness**
  dims scenes only: shows always play at their own brightness (see **Brightness** in **⚙ Show
  settings…**).
- A scene turned on while a show or playlist is playing waits for it to finish, then comes on.
  The light shows as on meanwhile.

For example, a scene from sunset to midnight:

```yaml
triggers:
  - trigger: sun
    event: sunset
actions:
  - action: light.turn_on
    target:
      entity_id: light.ha_liday_show
    data:
      effect: Candy cane
      brightness_pct: 60
```

and `light.turn_off` at midnight.

### Without MQTT

Without MQTT, use the app's stdin:

```yaml
actions:
  - action: hassio.app_stdin
    data:
      app: <slug>_haliday_show   # pick HA-liday Show in the UI editor
      input:
        action: play
        show: Halloween
        media_player: media_player.garden   # optional; defaults to the show speaker
```

To start a playlist instead, send `input: {action: play, playlist: Halloween night}` (its name, in
any case). Send `input: {action: stop}` to stop. For a scene, send
`input: {action: scene, scene: Candy cane}`, or `scene: "off"` to turn it off. **Setup → Speakers** shows the exact input for the open show, under Automations.
Automations that use the older `hassio.addon_stdin` action with `addon:` keep working, and that's
the one to use on Home Assistant before 2026.2.

## Arrange the editor

The Show, Music and Playlist editors are all made of panels you can arrange, and each editor keeps its
own arrangement:

| Editor | Panels | Can't be hidden |
| --- | --- | --- |
| Show | Show, Song, Playback, Beats, Describe it, Preview, House, Timeline and Selection | Timeline |
| Music | Song (with **Make song file**), Playback, Waveform (with the **Mixer**), Selection, Beats and sections, Edit, Splice and Smoothing | Waveform |
| Playlist | Playlist (its name, **▶ Play** and **Delete playlist**), Building blocks, Your shows, Running order and When it plays (what the schedule does with it) | Running order |

The Music editor's **Selection** panel is where you change whatever you clicked: a section, a ⚑ mark, a
clip on a layer or a ✂ join, and the **EQ** faders. If it's folded, clicking one opens it; if you've
hidden it, bring it back to use them.

Drag any editor panel by its
title to move it to the top, left, middle, right or bottom, or to change its order there; a blue
bar shows where it will land. The **⋯** button in its corner does the same from a menu: it shows a
small picture of the page, so click the area you want the panel in. **Earlier** and **Later**
change its order, which also works on a touch screen. Any panel except the Timeline can be
**Hidden**. To keep a panel to hand but out of the way, press the **▾** before its name to
collapse it to its title, and **▸** to open it again. On a phone, some panels start collapsed so the
main one is near the top: **Preview** and **House** in the Show editor, **Splice** and **Smoothing** in
the Music editor, and **Building blocks** in the Playlist editor. Open them with **▸** whenever you want
them.

Each editor panel has a **?** beside its **⋯**: it shows a few tips for that panel, and **More in Help →**
opens the rest in the **Help** drawer (see [Help](#help)).

The **page layout** sets how those five areas fit together. Pick it at the bottom of any panel's
**⋯** menu or under **Settings → Layout** (each editor has its own):

| Page layout | Arrangement |
| --- | --- |
| Classic | Top and bottom run the full width; left, middle and right sit side by side between them. |
| Side columns | Left and right run the full height of the page, with top, middle and bottom stacked between them. |
| Right column | Right runs the full height; top and bottom span the left and middle. Handy for keeping Selection beside everything. |

Out of the box, in the Show editor, the Show and Playback panels run along the top, Song, Preview, House and Beats sit
down the left, Selection and Describe it down the right, and the Timeline takes the middle, so the
timeline and the selected clip are on screen together. The Music editor starts with Song and Playback
along the top, the waveform in the middle with Selection beside it, and the other panels along the
bottom; the Playlist editor with Building blocks and Your shows down the left, the running order in the
middle and When it plays along the bottom. Each editor's **Reset** button under **Settings → Layout**
goes back to these. While the top area is
short enough, it stays in view as you scroll, so **Play** is always to hand.

An area with no panels in it takes no space. On a narrow screen every area stacks in one column. With Selection hidden, clips can still be moved, resized, copied and
deleted on the timeline, but adding or editing effects needs it back. The layout is saved in your
browser, so each computer or phone keeps its own.

## Settings

**Setup → Settings** holds the rest. Timing and Automations sit with the speakers, under **Setup →
Speakers**: **Light offset** for playing in the browser (positive values delay the lights), or the
picked speaker's delay, and the exact `hassio.app_stdin` input for the open show.

| Section | What's there |
| --- | --- |
| Layout | Pick **Show**, **Music** or **Playlist**, then that editor's page layout, where every panel sits (including hidden ones) and its **Reset** button. |
| Live music | What a WLED with a microphone hears (see [Live music](#live-music)). |
| Public page | **Let visitors start shows**, which adds the **Public page** tab (see [The public page](#the-public-page)). |
| AI | Which AI the ✨ features use (**Describe it**, Generate's **AI** option and the rest), or how to set one up (see [Setting up the AI](#setting-up-the-ai)). |
| Your data | **Export…**, **Import…** and **Start afresh…**, and the copies kept before an import or a fresh start (see [Your data](#your-data)). |
| Setup guide | **Run the setup guide**, the step-by-step window that opens on a fresh install (see [Quick start](#quick-start)). |
| Demo | **Try the demo** on a fresh install, or **Remove the demo** (see [The demo](#the-demo)). |
| Experimental | **Show the Labs tab**. |

**Labs** is a tab under **Setup** for working out new ways to drive Govee lights. It's hidden until you
turn on **Show the Labs tab** under **Experimental**; that's saved in this browser, so each computer or
phone has its own. It holds:

| Section | What's there |
| --- | --- |
| Packet lab | Sends hand-made messages to one Govee light, for trying out new ways of driving it (below). |
| Listen for Govee traffic | Records what your Govee lights say to each other, to help support new ways of driving them (below). |

## Your data

**Setup → Settings → Your data** puts everything HA-liday Show saves in one file, and back:

- **Export…** downloads a `.zip` of your lights (with their parts and groups), shows (archived ones
  too), scenes, palettes, presets, playlists, the schedule, settings (the public page's and your
  song folders too), the Music editor's drafts, what **Detect** found in each song and your notes on it, the house photo and where each light is traced
  on it, and the public page's own picture. Your songs stay in your songs folder and aren't in it.
  It's the same on every install, so you can move your shows to another Home Assistant, or between
  HA-liday Show and a Docker or pipx install.
- **Import…** replaces all of that with what's in an exported file. A file that isn't an HA-liday Show
  export is refused and nothing changes.
- **Start afresh…** removes it all, so HA-liday Show is like new and the setup guide opens. It also resets
  this browser's layout and choices (like **Show the Labs tab**). Your songs are kept.

Before an import, a fresh start or deleting a show or song for good, HA-liday Show keeps a copy of what
you had, listed under **Your data**
(the newest five). **Put back** restores one, and **Download** saves it as an export. So to try the
setup guide without losing anything: **Start afresh…**, try it, then **Put back** the copy *Before a
fresh start* (or **Import…** your export).

Home Assistant's own backups include all of this too, as the app's config folder.

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

## Setting up the AI

**Describe it**, **✨ Make presets**, **✨ Make palettes**, Generate's **AI** option, the AI's section
notes and its pick of [suggested cuts](#suggest-cuts) need one of these:

- **Claude, with your own API key.** Create a key at console.anthropic.com, then in Home Assistant open
  **Settings → Apps → HA-liday Show → Configuration**, paste it into **Claude API key** and save.
  Each request costs a few US cents on your Anthropic account (it uses Claude Opus 5.5 at low effort).
- **Home Assistant's AI Task.** With no key, HA-liday Show asks Home Assistant, which uses whichever AI
  integration you've set up there with an AI Task entity: Anthropic, OpenAI, Google Gemini, or a local
  model through Ollama, which keeps everything on your network. If you have several, set **AI Task
  entity** on the Configuration tab, or Home Assistant's preferred one is used. Smaller local models
  may follow the instructions less well.

The **Settings** tab shows which one is in use. The AI is sent your lights' names and segment counts,
the effect list, the song's tempo, beats and sections, your palettes, the selection and the effects
already on the lights (for suggested cuts: the song's name, sections, notes and marks, and the cuts
found). It's never sent the song itself.

## Packet lab

**Setup → Labs → Packet lab** is for experiments with Govee lights: it sends one light a message you
choose and lists anything the light sends back. You won't need it to make shows. To see **Labs**, turn on
**Show the Labs tab** under **Setup → Settings → Experimental**.

1. Pick the **Light** (only Govee lights on the Devices tab with an IP address are offered).
2. Pick a starting point under **Start from**, such as **Ask for its status** or **Realtime: rainbow**,
   and set **Segments** and **Colour** for it. The message appears in the box, where you can change it.
3. Choose how many times to send it and how often. Realtime messages are sent 50 times, a tenth of a
   second apart, with **Realtime on first**, because lights drop back to their own scene within a
   moment otherwise.
4. Press **Send**. **Stop** ends it early. A playing show is stopped first.

The three types are a whole **JSON message**, a **Realtime (razer) packet** (type the command byte
and its data in hex; the header, length and checksum are added, and **Length field** overrides the
length), and an **App command (ptReal)**: one Govee app command per line, in hex.

### Reaching past the realtime window

Some lights, like the 30 m Christmas String Lights 2 (H70C5) and the icicle lights, only take
realtime colours for their first few dozen bulbs (44 on the H70C5). **Run sweep** tries nine guesses
at how the rest of the bulbs might be reached, one after another for about 45 seconds. Each guess
asks for the bulbs just past the window in its own colour. Film the whole light while it runs. A colour appearing past the window means that guess
works; the list under the button says which colour is which.

A Govee TV sync box does get colour onto the whole of these lights, so it may switch them into a
different mode first. **Try ways to switch on** tries seven guesses at that, one after another for about
50 seconds, each followed by a rainbow over the window. Watch the
whole light: if the rainbow reaches past the window or stretches along the whole string, note the number
shown under the buttons at that moment.

All four sweeps use the window of the light's model when it's known (44 for the H70C5, whatever
**Segments** says), and otherwise **Segments**, so set **Segments** to the window for other lights.

Two more sweeps try other ways past the window, each step in its own colour, with the list under the
buttons saying which is which. **Try other
flags** sends a frame of one colour with nine different values in the byte that switches crisp or blended
colours, for about 45 seconds. **Try app modes first** switches the light into twenty Govee app modes in
turn, each followed by a frame in its colour, for about a minute and a half; the light goes plain white
between steps. For either, watch for a colour lighting more than the first bulbs.

## Listen for Govee traffic

Some Govee features drive lights in more detail than HA-liday Show can. In **Scene Stage**, for example,
one light (the sync centre) plays a picture across all the others. **Setup → Labs → Listen for
Govee traffic** helps work out how, so HA-liday Show can learn to do the same:

1. Start Scene Stage (or whatever you want recorded) in the Govee Home app.
2. Press **Listen for 60 seconds**. Nothing is sent to your lights, and a playing show is stopped.
3. When it finishes, the table shows which lights sent what. Press **Download** and attach the file to
   an issue on HA-liday Show's GitHub page.

If it hears nothing, the lights are talking to each other directly, where Home Assistant can't hear.

## Troubleshooting

| Problem | Try |
| --- | --- |
| Scan finds no WLED strips | Check they're switched on and on the same network. Add the strip by IP instead (it's on the WLED app's **Info** page). |
| Only part of a WLED strip lights up | In WLED, open **Config → Sync Interfaces** and untick **Use main segment only**. |
| A pixel controller doesn't light | For DDP, check DDP is switched on in the controller's settings. For E1.31, check it takes E1.31 as **unicast** and that **universe** and **channel** in the light's window match the controller's set-up. Then check **LEDs** matches the number on the string. |
| Scan finds no Govee lights | Check **LAN Control** is on for each light in the Govee Home app, and that Home Assistant and the lights are on the same network with multicast allowed. Add the light by IP instead. |
| Test only turns a Govee light on | Change **Protocol** on the Devices tab and test again. |
| Only the first part of a Govee light lights up | Some Govee lights only accept a few segments in realtime mode. The 30 m Christmas String Lights 2 (H70C5) stops at 44 bulbs. **Whole light (one colour)** lights the whole string, one colour at a time. Run from a WLED controller, every bulb lights: see [Moving a Govee light to WLED](#moving-a-govee-light-to-wled). |
| A Home Assistant light lags behind the music | They change at most 4 times a second (a switch once a second), so fast effects look steppy. Use fades, colour changes and pulses on them. |
| A Twinkly light doesn't light | Twinkly support is experimental and hasn't been tried on a real Twinkly yet. Please say what happens on GitHub. |
| Effects run from the wrong end | Turn on **Reverse** on the Devices tab. |
| Lights run ahead of or behind the music | In the browser, adjust **Light offset** under **Setup → Speakers**. On a speaker, adjust its **Delay ms** in the same place. |
| A speaker can't be added | The test shows Home Assistant's reason. Some integrations can't play files from the media folder; use another media player for the song. |
| A show from an automation plays no music | Set a **Show speaker** for the show, or a **Default show speaker** on the Speakers tab. |
| House lane effects do nothing | Trace the lights on the House tab first. |
| The House view looks sparse | Set **Bulbs** on the Devices tab to the real count. |

## Where things are stored

Shows, scenes, devices and their groups, palettes, your presets, playlists, the schedule and
building blocks, each song's beats, parts, notes and marks, your song folders, the Music editor's
drafts, the house photo, the public page's own picture and settings live in the app's config folder (`/addon_configs/<slug>_haliday_show/`), so
they are included in Home Assistant backups. Uploaded songs go to `/media/haliday_show/` (samples to its
`Samples` folder) so media
players can play them. The editor layout, the editing speaker, the song volume, the Show player's light offset,
**Show the Labs tab** and a few other editor choices (such as **Snap**, zoom and **Loop**) are kept in each browser.

## Running without Home Assistant

You don't need this if you use the app. It's for running HA-liday Show on another always-on
machine, such as a NAS, a Raspberry Pi or a Linux PC, for example if your Home Assistant can't
install apps. You can run it [with Docker](#with-docker) or [with Python](#with-python).

It works the same as the Home Assistant app, with a few differences:

- There's no sidebar panel. Open `http://<that machine's address>:8099/` in your browser.
- On that machine itself it opens straight away. From any other device you need a password, which
  you set with `HALIDAY_SHOW_PASSWORD`. Your browser asks for it once; any user name works.
  Or set `HALIDAY_SHOW_ALLOW_ALL=1` to let anyone on your home network in without one.
- It must be on the same network as your lights, with full network access (for Docker, host
  networking), as the app is.
- There's no `hassio.app_stdin` action. Use the MQTT entities in automations instead, or the
  [Schedule](#schedule).
- There's no Home Assistant speaker unless you connect one (below). For music with scheduled shows,
  leave the [Show player](#music-with-no-speaker-the-show-player) open on a computer with speakers.

You set everything with these settings (environment variables). All are optional.

| Setting | What it does |
| --- | --- |
| `HALIDAY_SHOW_PASSWORD` | The password other devices need. |
| `HALIDAY_SHOW_ALLOW_ALL` | `1` lets anyone on your network in, with no password. |
| `HALIDAY_SHOW_CONFIG` | The folder your shows, lights and settings are kept in. It holds the same files as the app's, so you can copy shows across. |
| `HALIDAY_SHOW_MEDIA` | The folder your songs are kept in. |
| `HALIDAY_SHOW_PORT` | The web port, `8099` unless you change it. |
| `HALIDAY_SHOW_PUBLIC_PORT` | The [public page](#the-public-page)'s port, `18099` unless you change it. It only opens once you've set up the public page. |
| `TZ` | Your time zone, such as `Europe/London`, for the schedule. Docker only; with Python it uses your computer's. |
| `HA_URL`, `HA_TOKEN` | Your Home Assistant address (e.g. `http://homeassistant.local:8123`) and a long-lived access token (your profile in Home Assistant → **Security**). Needed for speakers, Home Assistant's AI, and Home Assistant lights and switches in shows. |
| `ANTHROPIC_API_KEY` | A Claude API key for the AI, instead of Home Assistant's. |
| `HALIDAY_SHOW_AI_TASK_ENTITY` | Which Home Assistant AI Task to use, if you have several. |
| `HALIDAY_SHOW_MQTT_HOST` | Your MQTT broker, for the show entities. Also `_PORT`, `_USERNAME` and `_PASSWORD`. |

> **Speakers:** Home Assistant plays songs from its own **media** folder, so a speaker can only play
> a song if `HALIDAY_SHOW_MEDIA` is that same folder (shared over the network, for example).
> Otherwise, play the music in your browser, and for playlists and schedules leave the
> [Show player](#music-with-no-speaker-the-show-player) open on a computer with speakers.

### With Docker

This works on Linux, most NAS boxes (Synology, Unraid, QNAP) and a Raspberry Pi. It doesn't work
with Docker Desktop on a Mac or Windows PC, because that can't give it the network access the
lights need. On a Raspberry Pi, use the 64-bit Raspberry Pi OS (a Pi 3 or newer) and
[install Docker](https://docs.docker.com/engine/install/raspberry-pi-os/) first.

1. Make a folder for it, for example `haliday-show`.
2. Download [docker-compose.yml](https://github.com/gdeboos/ha-liday-show/blob/main/standalone/docker-compose.yml)
   into that folder.
3. Open the file and change `change-me` to your own password. Uncomment any optional settings
   you want (remove the `#`).
4. In that folder, run `docker compose up -d`.
5. Open `http://<that machine's address>:8099/` and type your password when your browser asks.

Your shows go in the `config` folder next to the file and your songs in `media`. To bring shows
across from the app, copy the files from its folder (see
[Where things are stored](#where-things-are-stored)) into `config`, and its `haliday_show` songs
folder into `media`.

To update, run `docker compose pull` and then `docker compose up -d` in that folder.

The image is `ghcr.io/gdeboos/ha-liday-show`. If your `docker-compose.yml` is from before
version 0.2.113 and its `image:` line says `gavin-vbmedia`, change that to `gdeboos`, or updates stop.

### With Python

This works on a Mac, Linux and a Raspberry Pi, without Docker. Windows may work but isn't tested,
because Windows often blocks the network traffic the lights use. It needs Python 3.12 or newer and
[pipx](https://pipx.pypa.io/stable/installation/).

1. Install it:
   `pipx install git+https://github.com/gdeboos/ha-liday-show`
2. Start it with your own password:
   `HALIDAY_SHOW_PASSWORD=your-password haliday-show`
3. Open `http://localhost:8099/` on that computer, or `http://<its address>:8099/` from another
   device, and type your password when your browser asks.

It keeps your shows in `haliday-show/config` and your songs in `haliday-show/media`, in your home
folder. It runs while that window is open; to keep it running, start it the way your computer
starts other programs (on Linux, a systemd service).

To update, run `pipx upgrade haliday-show`.

## Notes

- Each kind of light is driven its own way: WLED strips and DDP pixel controllers with DDP; E1.31
  controllers with E1.31 sent straight to their IP; Govee lights with Govee's realtime ("razer")
  protocol, which the Govee app's own LAN API doesn't document; Home Assistant lights and switches through Home
  Assistant; and Twinkly lights with Twinkly's own realtime mode. While a show plays, the lights ignore
  other commands; they go back to what they were doing when it stops.
- As a Home Assistant app, HA-liday Show uses the host network to find WLED and Govee lights and to send to every light, but its web
  server only answers Home Assistant's ingress proxy, so the editor isn't reachable directly on your LAN.
