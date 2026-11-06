<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Automations

[← The public page](public-page.md) · [Contents](README.md) · [The editor, settings and your data →](editor-and-settings.md)

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
