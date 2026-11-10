<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Automations

[← The public page](public-page.md) · [Contents](README.md) · [The editor, settings and your data →](editor-and-settings.md)

## 6. Automations

### Home Assistant integration

The **HA-liday Show** integration gives Home Assistant your shows, playlists, scenes and season
switches without needing MQTT. It's the same set of entities as with MQTT below, with the same names,
so automations and dashboards you've already made keep working.

To install it:

1. In Home Assistant, go to **Settings → Marketplace**, press **Add from link** and paste
   `https://github.com/gdeboos/ha-liday-show`. The first time, Home Assistant asks you to connect
   GitHub; approve it on GitHub's page.
2. Pick **HA-liday Show** in the list, press **Download**, then restart Home Assistant.
3. Go to **Settings → Devices & services**. **HA-liday Show** should be waiting under
   **Discovered**: press **Add**. If it isn't there, press **+ Add integration**, search for
   **HA-liday Show** and keep the address **127.0.0.1** and port **8099**.

Once it's added, the MQTT entities move across to the integration: Home Assistant shows them on an
**HA-liday Show** device under the integration instead of under MQTT, with the same names. Publishing
to the MQTT topics below still works. Any name, icon or area you'd given an entity comes with it.

If you **delete** the integration, the MQTT entities come back. Delete it while the app is running: if
the app is off at the time, they come back on their own after a week without the integration. If you
only **disable** it, its entities go away but the MQTT ones stay away too, until you enable it again or
delete it.

Update the integration whenever you update the app: the Marketplace offers the update alongside it.
If they get out of step, the integration says so.

For Docker and pipx installs, add the integration by hand and give the address of the computer
HA-liday Show runs on, its port (8099 unless you changed `HALIDAY_SHOW_PORT`) and the password you set
with `HALIDAY_SHOW_PASSWORD`.

#### Sensors and the player

As well as the entities it shares with MQTT, the integration adds these to the **HA-liday Show** device:

- **Player** (`media_player.ha_liday_show_player`): what's playing, with the song, its cover art, the
  playlist it's part of and how far through it is. Its **Source** is the show to play, **Play** plays
  it, **Stop** stops, and **Next** skips a visitor's pick. It shows on a dashboard's media control card
  like any speaker. A scene shows on the light, not here.
- **Next on the schedule**: when the next row on your **Schedule** starts, with its name.
- **Visitors waiting**: how many picks are in the queue, or votes cast in **Vote** mode, with the names.
- **Phones listening**: how many visitors are listening on their phones now.
- **Last pre-show check**: `ok`, `warn` or `fail`, with how many problems and warnings it found, and when.
- **Visitors' page open**: on while the public page is switched on and within its opening hours.

#### Dashboard cards

The integration comes with cards for your dashboards. Edit a dashboard, press **+ Add card**, and search
for **HA-liday Show**:

- **HA-liday Show: Player**: what's playing, its cover art and how far through it is, and what's next on
  the schedule. When nothing's on, pick a show and press **Play**. While a show plays, **Stop** stops it
  and **Skip** ends a visitor's pick.
- **HA-liday Show: Browse**: your shows and playlists as tiles, in the same folders as in **Library**.
  Press a folder to go in, and the path at the top to come back out. **Find in every folder** searches
  them all. Press a show or playlist to play it. A show's tile has its picture, else its song's cover
  art, else its palette's colours.
- **HA-liday Show: House**: your house photo with your lights on it, as they are right now, a few
  times a second, just like the editor's **House** tab. Lights you haven't placed on the photo under
  **Setup → House** don't show. In the card's YAML, `max_height:` sets how tall it can get (420 pixels
  unless you change it). It only fetches the lights while it's on screen.
- **HA-liday Show: Scenes**: a button for each of your scenes. Press one to put it on; the one that's
  on is highlighted. **Brightness** dims the scene that's on, and **Off** turns scenes off.
- **HA-liday Show: Visitors and checks**: whether the visitors' page is open, how many picks are
  waiting (or votes, in **Vote** mode) with the next few, how many phones are listening, and how the last
  pre-show check went. **Skip this pick** ends the visitor's pick that's playing.

The cards work for everyone who uses your Home Assistant, on phones too, away from home: they go through
Home Assistant rather than to HA-liday Show itself.

Each card has its own options in the card editor (press the card while editing the dashboard). Every
card has a **Title** (leave it empty for the usual one) and **Hide the title**. The rest:

| Card | Options |
| --- | --- |
| **Player** | **Hide the cover art**, **Hide how far through it is**, **Hide the show picker and Play** (for a card that only shows what's on), **Hide what's next on the schedule** |
| **Browse** | **Show**: shows and playlists, shows only or playlists only; **Open on**: Shows or Playlists; **Tile size**: small, medium or large; **Hide Find in every folder** |
| **Scenes** | **Only these scenes**: pick the scenes the card shows, in the order you pick them (leave it empty for all of them); **Columns**: how many buttons across (leave it empty to fit); **Hide Brightness**, **Hide Off** |
| **Visitors and checks** | Hide any of: the visitors' page, picks waiting, phones listening, the list of picks, the pre-show check, **Skip this pick** |
| **House** | **Tallest it can be** (420 pixels unless you change it), **Hide the line under the picture** |

Every option is off unless you switch it on, so a card you added before the editor came along shows
everything, as it did.

On a sections dashboard you can make the cards any size in the card editor's **Layout** tab. They start
half the width (Player, Scenes, Visitors and checks) or the full width (Browse, House), and fit their
content's height. Make one narrower and it tidies itself up (the cover art gets smaller, **Off** becomes
just its icon). Give one a set height and what doesn't fit scrolls inside it; the **House** card's
picture grows or shrinks to fill the space.

#### Actions

The integration adds four actions for automations and scripts:

- **HA-liday Show: Play** (`haliday_show.play`): give a **Show**, a **Playlist** or a **Scene** by name.
  For a show you can also pick a **Speaker** (instead of the show's own) and **Start at** a number of
  seconds in.
- **HA-liday Show: Stop** (`haliday_show.stop`): stops whatever's playing.
- **HA-liday Show: Skip** (`haliday_show.skip`): ends the visitor's pick that's playing, so the next one
  waiting starts.
- **HA-liday Show: Season props** (`haliday_show.season`): puts a season's props out, or packs them away.

For example, to play a show on the garden speaker from 30 seconds in:

```yaml
actions:
  - action: haliday_show.play
    data:
      show: Halloween
      media_player: media_player.garden
      start_at: 30
```

If something's wrong (no show by that name, say), the action stops with a message saying what.

#### Events

The **HA-liday Show** device has four event entities, so what happens shows in the logbook, and you can
start an automation from any of them in the automation editor:

| Entity | Fires when |
| --- | --- |
| **Show** | a show **starts** or **ends** (with its name, and its playlist if it's part of one) |
| **Visitors** | a visitor **picks** a show on the public page, or **votes** for one |
| **Pre-show check** | a pre-show check **finishes** (with how it went: `ok`, `warn` or `fail`) |
| **Lights** | a pre-show check finds a light that's **not answering** (with the light's name) |

Events are only sent while Home Assistant is connected. If a show ends while Home Assistant is
restarting, its **ended** event arrives when it's back.

The same events are also on Home Assistant's event bus, as `haliday_show_show_started`,
`haliday_show_show_ended`, `haliday_show_visitor_pick`, `haliday_show_visitor_vote`,
`haliday_show_preshow_check` and `haliday_show_light_not_answering`. For example, a phone notification
when a light doesn't answer:

```yaml
triggers:
  - trigger: event
    event_type: haliday_show_light_not_answering
actions:
  - action: notify.mobile_app_my_phone
    data:
      message: "{{ trigger.event.data.light }} didn't answer the pre-show check."
```

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

To start a [playlist](play-it.md#playlists) instead, use the **Playlist** select and the **Play playlist** button
in the same way:

```yaml
actions:
  - action: select.select_option
    target:
      entity_id: select.ha_liday_show_playlist
    data:
      option: Halloween night
  - action: button.press
    target:
      entity_id: button.ha_liday_show_play_playlist
```

Or publish a playlist's name or id to the `haliday_show/playlist/play` MQTT topic. This works the same
in Docker and pipx installs, where there's no `hassio.app_stdin`. **Stop** stops a playlist too.

Your [scenes](play-it.md#scenes) are on the same device:

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

Each [season](lights.md#seasons) is a switch on the same device, such as `switch.ha_liday_show_halloween_props_out`:
on while that season's props are **Out**, off while they're **Packed away**. Switching it does the same as
the switch on **Setup → Devices**. So an automation can put the Halloween props out on 1 October:

```yaml
triggers:
  - trigger: time
    at: "00:00:00"
conditions:
  - condition: template
    value_template: "{{ now().month == 10 and now().day == 1 }}"
actions:
  - action: switch.turn_on
    target:
      entity_id: switch.ha_liday_show_halloween_props_out
```

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
`input: {action: scene, scene: Candy cane}`, or `scene: "off"` to turn it off. To put a
[season](lights.md#seasons)'s props out, send `input: {action: season, season: Halloween, out: true}`, and
`out: false` to pack them away (or just the text `season Halloween out` or `season Halloween away`). It does the same as the switch on **Setup → Devices**: packed-away props go
dark straight away. **Setup → Speakers** shows the exact input for the open show, under Automations.
Automations that use the older `hassio.addon_stdin` action with `addon:` keep working, and that's
the one to use on Home Assistant before 2026.2.

---

[← The public page](public-page.md) · [Contents](README.md) · [The editor, settings and your data →](editor-and-settings.md)
