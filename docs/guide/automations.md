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

---

[← The public page](public-page.md) · [Contents](README.md) · [The editor, settings and your data →](editor-and-settings.md)
