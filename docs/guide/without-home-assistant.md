<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Running without Home Assistant

[← Troubleshooting and storage](troubleshooting.md) · [Contents](README.md)

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
  [Schedule](play-it.md#schedule).
- There's no Home Assistant speaker unless you connect one (below). For music with scheduled shows,
  leave the [Show player](play-it.md#music-with-no-speaker-the-show-player) open on a computer with speakers.

You set everything with these settings (environment variables). All are optional.

| Setting | What it does |
| --- | --- |
| `HALIDAY_SHOW_PASSWORD` | The password other devices need. |
| `HALIDAY_SHOW_ALLOW_ALL` | `1` lets anyone on your network in, with no password. |
| `HALIDAY_SHOW_CONFIG` | The folder your shows, lights and settings are kept in. It holds the same files as the app's, so you can copy shows across. |
| `HALIDAY_SHOW_MEDIA` | The folder your songs are kept in. |
| `HALIDAY_SHOW_PORT` | The web port, `8099` unless you change it. |
| `HALIDAY_SHOW_PUBLIC_PORT` | The [public page](public-page.md#the-public-page)'s port, `18099` unless you change it. It only opens once you've set up the public page. |
| `TZ` | Your time zone, such as `Europe/London`, for the schedule. Docker only; with Python it uses your computer's. |
| `HA_URL`, `HA_TOKEN` | Your Home Assistant address (e.g. `http://homeassistant.local:8123`) and a long-lived access token (your profile in Home Assistant → **Security**). Needed for speakers, Home Assistant's AI, and Home Assistant lights and switches in shows. |
| `ANTHROPIC_API_KEY` | A Claude API key for the AI, instead of Home Assistant's. |
| `HALIDAY_SHOW_AI_TASK_ENTITY` | Which Home Assistant AI Task to use, if you have several. |
| `HALIDAY_SHOW_MQTT_HOST` | Your MQTT broker, for the show entities. Also `_PORT`, `_USERNAME` and `_PASSWORD`. |

> **Speakers:** Home Assistant plays songs from its own **media** folder, so a speaker can only play
> a song if `HALIDAY_SHOW_MEDIA` is that same folder (shared over the network, for example).
> Otherwise, play the music in your browser, and for playlists and schedules leave the
> [Show player](play-it.md#music-with-no-speaker-the-show-player) open on a computer with speakers.

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
[Where things are stored](troubleshooting.md#where-things-are-stored)) into `config`, and its `haliday_show` songs
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

---

[← Troubleshooting and storage](troubleshooting.md) · [Contents](README.md)
