<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Troubleshooting and storage

[← Labs and experiments](labs.md) · [Contents](README.md) · [Running without Home Assistant →](without-home-assistant.md)

## Troubleshooting

| Problem | Try |
| --- | --- |
| Scan finds no Govee lights | Check **LAN Control** is on for each light in the Govee Home app, and that Home Assistant and the lights are on the same network with multicast allowed. Add the light by IP instead. |
| Scan finds no WLED strips | Check they're switched on and on the same network. Add the strip by IP instead (it's on the WLED app's **Info** page). |
| Test only turns a Govee light on | Change **Protocol** on the Devices tab and test again. |
| Only the first part of a Govee light lights up | Some Govee lights only accept a few segments in realtime mode. The 30 m Christmas String Lights 2 (H70C5) stops at 44 bulbs. Set **Protocol** to **Per bulb (experimental)** and **Segments** to the number of bulbs (300 for the H70C5). **App segments (experimental)** and **Whole light only** also light the whole string, more coarsely. |
| Only part of a WLED strip lights up | In WLED, open **Config → Sync Interfaces** and untick **Use main segment only**. |
| A pixel controller doesn't light | For DDP, check DDP is switched on in the controller's settings. For E1.31, check it takes E1.31 as **unicast** and that **universe** and **channel** in the light's window match the controller's set-up. Then check **Segments** matches the number of LEDs. |
| A Home Assistant light lags behind the music | They change at most 4 times a second (a switch once a second), so fast effects look steppy. Use fades, colour changes and pulses on them. |
| A Twinkly light doesn't light | Twinkly support is experimental and hasn't been tried on a real Twinkly yet. Please say what happens on GitHub. |
| Effects run from the wrong end | Turn on **Reverse** on the Devices tab. |
| Lights run ahead of or behind the music | In the browser, adjust **Light offset** under **Setup → Speakers**. On a speaker, adjust its **Delay ms** in the same place. |
| A speaker can't be added | The test shows Home Assistant's reason. Some integrations can't play files from the media folder; use another media player for the song. |
| A show from an automation plays no music | Set a **Show speaker** for the show, or a **Default show speaker** on the Speakers tab. |
| House lane effects do nothing | Trace the lights on the House tab first. |
| The House view looks sparse | Set **Bulbs** on the Devices tab to the real count. |

## Where things are stored

Shows, devices, palettes, your presets, playlists with their schedules and building blocks, each
song's beats, parts, notes and marks, the Music editor's drafts, the house photo, the public page's
own picture and settings live in the app's config folder (`/addon_configs/<slug>_haliday_show/`), so
they are included in Home Assistant backups. Uploaded songs go to `/media/haliday_show/` so media
players can play them. The editor layout, the editing speaker, the song volume, the Show player's light offset,
**Govee scenes**, **Show the Labs tab** and a few other editor choices (such as **Snap**, zoom and **Loop**) are kept in each browser.

---

[← Labs and experiments](labs.md) · [Contents](README.md) · [Running without Home Assistant →](without-home-assistant.md)
