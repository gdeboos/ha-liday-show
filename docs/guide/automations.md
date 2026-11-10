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
