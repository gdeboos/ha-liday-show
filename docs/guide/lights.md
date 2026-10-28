<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Your lights

[← Getting started](getting-started.md) · [Contents](README.md) · [Speakers →](speakers.md)

## 1. Devices

On the **Devices** tab press **+ Add a light**. First pick what you're adding under **A light you have**
(a Govee light, a WLED strip, a pixel controller, a Home Assistant light or switch, or a Twinkly), or
**Plan a light** for one that hasn't arrived yet. Then fill in what that kind needs and press **Add**. For a
Govee light or a WLED strip, press **Scan network** and **Add** each light it finds, or type its IP if it
doesn't show up. When it's added, press **Add another**
for the next one, or **Done**.

The list shows one line per light: its name, IP, model and a bar of its segments, with each part in its
colour and a count of its segments and parts. Press **Test** on a line to test the light. Press anywhere
else on the line (or **Edit**) to open the light's window, which has all its settings and its parts.
**Remove light** is at the bottom of that window. The settings are:

| Setting | What it does |
| --- | --- |
| Name | How the light is labelled in the editor and on the House tab. |
| Segments | How many separately controllable sections it has. For WLED, Twinkly and pixel controllers it's the number of LEDs, filled in or typed when you add it; a Home Assistant light has one. Govee doesn't report it, so set it with **Find** or **Test** (see [Govee lights](#govee-lights)); most Govee strips and outdoor lights have 10 to 15. |
| Bulbs | The real number of bulbs, so the House view draws each one. Leave blank to draw 4 per segment. |
| Brightness % | Caps the light in every show, handy when one string is much brighter than the rest. It applies straight away, to previews too, without re-saving shows. |
| Reverse | Turn it on if effects run from the wrong end. |
| Blend | Govee only: asks the light to blend smoothly between neighbouring segments. |
| Protocol | Govee only: how colours are sent (see [Govee lights](#govee-lights)). Other kinds show how they're driven, such as **DDP** or **E1.31**. |

Some kinds have a little more in their window: **first LED** for a pixel controller over DDP, **universe**
and **channel** for one over E1.31, and the light or switch for a Home Assistant one.

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

### WLED strips

WLED strips work like any other light. Press **+ Add a light**, pick **WLED strip** and press
**Scan network** to find it, or type its IP address (it's on the WLED app's **Info** page) and press **Add**. HA-liday Show asks the
strip for its name and number of LEDs, so there's nothing to work out: every LED is its own segment,
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
- **Segments** becomes the WLED's number of LEDs, and its parts keep their share of the light: on a
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

### Home Assistant lights and switches

Any light or switch in Home Assistant can join in: Zigbee and Hue bulbs, LIFX, or a smart plug driving an
inflatable or a lit-up prop. Press **+ Add a light**, pick **Home Assistant light or switch**, pick it from
the list and press **Add**. To swap it for another later, pick it in the light's window.

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

Press **+ Add a light** and pick **Plan a light**. Choose the **Kind of light** (a Govee light, a WLED
strip, a pixel controller, a Home Assistant light or switch, or a Twinkly), give it a name and press
**Add planned light**, then build shows with it straight away. Each kind only asks for what it needs: a
Govee light its **Model** (for example `H706A`, optional) and **Segments**, the strips, pixel controllers
and Twinkly their **LEDs**, and a Home Assistant light just a name. For Govee models, a badge next to the model flags anything we've
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
whole house. Press the light's line to open its window, then **Split into parts…**. The first part covers every
segment; set its first and last segment, then press **+ Add part** for the next stretch (it starts
just after the last part). For example, a 60-segment Permanent Outdoor Pro could be **Front roof**
3–23, **Side** 24–40 and **Back** 41–60. Segments are counted the way effects run, so with
**Reverse** on, segment 1 is the far end. Parts are listed one per line, each with its colour,
and the bar above them maps the light's segments: each part in its colour, unused ones grey.

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
ends. Press the **▸** before the light's name to fold its parts away under it, and **▾** to bring them back.

### Light groups

A group is a set of lights, or parts of lights, that a show can give one effect: the two strips of
roof icicles, say, or the left part of each pillar. Under **Groups**, below your lights on the
**Devices** tab, press **+ New group**, give it a name and turn on the lights and parts to put in it, then
press **Add group**. A part is in automatically when its whole light is. **Edit** changes a group and
**Delete…** removes it. Groups are listed like your lights: press a group's line to change it, and drag it
by its ⠿ handle (or use **↑** and **↓**) to change the order of their lanes in the Show editor. A light can be in as many groups as you like.

Each group gets its own lane in the Show editor, under **House** (see [Group lanes](effects.md#group-lanes)).

---

[← Getting started](getting-started.md) · [Contents](README.md) · [Speakers →](speakers.md)
