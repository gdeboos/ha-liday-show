<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Effects

[← Build a show](build-a-show.md) · [Contents](README.md) · [Play it and playlists →](play-it.md)

## Effects

**Effects on a light** run along that light, from the plug end (or the other end with
**Reverse**):

| Effect | What it does |
| --- | --- |
| Solid | One colour |
| Two colours, Three colours | Solid colours side by side. **Split** divides the light into halves or thirds; **Alternate** repeats them along it, **Segments per colour** wide. **Move** slides them along like marquee lights (negative numbers go the other way). |
| Pulse | Breathes between a colour and the background |
| Gradient | Blends two or three colours along the light; **Move** slides it back and forth |
| Colour cycle | The whole light changes through two to four colours, fading or stepping |
| Fade | Fades from one colour to another over the clip; fade to a darker colour for a gentle dim |
| Chase | A block of colour running along the light |
| Rainbow | A moving rainbow |
| Comet | A bright head with a fading tail running along the light |
| Scanner | A dot bouncing from end to end |
| Flicker | Candle or fire flicker between two colours |
| Lightning | Random bright flashes over a dark background |
| Strobe | Flashes on and off |
| Twinkle | Segments sparkle at random |
| Wipe | Fills the light with colour over the clip |

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

Each [light group](lights.md#light-groups) has a lane under **House**, named after it. Press the **▸** before **House** to fold
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

---

[← Build a show](build-a-show.md) · [Contents](README.md) · [Play it and playlists →](play-it.md)
