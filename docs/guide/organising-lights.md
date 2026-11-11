<!-- The user guide is written here, a page per topic. tools/check_guide.py checks its links. -->

# Parts, groups, roles and seasons

Split lights into parts, group them, say what each follows in the music, and put seasonal props away.

## Splitting a light into parts

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

Put the parts in order from the plug: LED 1 is the end nearest it. If they're the wrong way round,
press **↑** (nearer the plug) or **↓** (further from it) on a part's line. It swaps places with the
part next to it, keeping its length, and its effects in your shows go with it. Retrace moved parts
under **Setup → House** if they're on the house photo. (Changing a part's LEDs to somewhere another
part is using isn't allowed, so ↑ and ↓ are the easy way to swap them.)

## The whole light as one

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

## Light groups

A group is a set of lights, or parts of lights, that a show can give one effect: the two strips of
roof icicles, say, or the left part of each pillar. Under **Groups**, below your lights on the
**Devices** tab, press **+ New group**, give it a name and turn on the lights and parts to put in it, then
press **Add group**. A part is in automatically when its whole light is. **Edit** changes a group and
**Delete…** removes it. Groups are listed like your lights: press a group's line to change it, and drag it
by its ⠿ handle (or use **↑** and **↓**) to change the order of their lanes in the Show editor. A light can be in as many groups as you like.

Each group gets its own lane in the Show editor, under **House** (see [Group lanes](effects.md#group-lanes)).

## Light roles

**Setup → Devices → Light roles** says which part of the music each light reacts to when **Generate**
makes a show: the **Kick drum**, the **Snare**, the **Crash cymbals**, the **Bass**, the **Vocals**, the
**Melody**, a steady **Background**, or **Nothing in particular**. A split light's parts each have their
own, under it.

Each light starts with a guess, shown as **Guess: …**: the biggest light carries the melody, a matrix
sings (it suits a Singing face), a light changed through Home Assistant is background (it can't keep up
with the drums), and the drums take turns over the rest. Pick a role to change it; pick the **Guess**
again to go back to it.

A show can give any light another role: in the Show editor, open **Show settings** and use **Light
roles**. Each light there says what it follows from your house (**House: …**) until you pick another
for that show, so your shows don't all look the same.

**Generate** uses each light's role to follow the drums and the words (see [Generate](generate.md#generate)).

## Seasons

Some props only go up for part of the year: a Halloween ghost, a Christmas Santa. Tell HA-liday Show
which season each belongs to, and switch a season off when its props are packed away.

- **Seasons** is below **Groups** on the **Devices** tab. **Halloween** and **Christmas** are there to
  start with. **+ New season** adds your own (Bonfire Night, Easter, a birthday), and each one has
  **Rename…** and **Delete…**.
- In a light's window, tick the **Seasons** it's put up for. A light with none ticked is an all-year
  light. A light can be in more than one season, such as orange lights for Halloween and Bonfire Night.
- Each season has a switch: **Out** while its props are up, **Packed away** when they're not. A light
  is packed away when every season it's in is packed away. Nothing is sent to a packed-away prop:
  shows, scenes and playlists play on everything else, and a prop packed away mid-show goes dark
  straight away. **Test** and previews on the light are off for it, it's marked **packed away** in the
  list, and the house view draws it dimmed.
- Deleting a season makes its lights all-year lights again.
- An automation can put a season's props out or pack them away: with MQTT, each season is a switch in
  Home Assistant (see [With MQTT](home-assistant.md#with-mqtt)); without it, send the app a season command (see
  [Without MQTT](home-assistant.md#without-mqtt)).
- **A show's season:** in **⚙ Show settings…** (or as you make it with **+ New show**), pick its
  **Season**. A Halloween show lists your all-year lights and your Halloween props, not your Christmas
  ones. **Any season** (the start for every show) lists every light. A light that's out of the show's
  season but already has effects in it keeps its lane, marked **Not in this season**, so changing
  seasons never loses anything. A show's row in **Library → Shows** names its season, and buttons above
  the list (**All**, then one per season) show just one season's shows (see [Shows](shows.md#shows)). Group lanes and
  the House lane in a show with a season only reach the lights it lists.

<!-- nav: made by tools/check_guide.py -->

---

← [Adding your lights](lights.md) · [Contents](README.md) · [Speakers](speakers.md) →
<!-- /nav -->
