# The public page: security notes

The public page (`public.py`, `static/public/`) is the only part of HA-liday Show meant to face the
internet. These notes record the review of 26 October 2026 (0.2.177): what was checked, what was fixed
and the limits that remain. Re-read them before changing `public.py`.

## How it's kept apart

- Its own aiohttp app on its own port (18099), with only the page, its three files, `/picture` and
  three POSTs (`request`, `cancel`, `near`). The editor's `ingress_only` doesn't apply to it, and
  nothing on it reaches the editor's routes, settings or Home Assistant.
- Bodies capped at 4 KB (`client_max_size`), JSON only, every field checked (`_ticket`, `_code_ok`,
  choices matched against the settings).
- Headers: `nosniff`, `no-referrer`, and a CSP of `default-src 'self'` (no inline or outside scripts),
  `frame-ancestors 'none'`, `form-action 'none'`, `base-uri 'none'`.
- Owner's text (title, welcome, link words) is only ever set with `textContent`; the bottom link must
  match `^https?://` (no `javascript:`) and opens with `noopener noreferrer`.

## The code

- 8 characters from 31 (about 8.5 × 10¹¹), compared in constant time, in every call. Without it,
  `state` returns only the colours (`locked`), and `/picture` is a 404.
- It's in the URL, so it can end up in browser history and screenshots of the sign; **New code…** is
  the remedy and is in the user guide.

## Listening on phones (0.2.318)

Off unless `public.listen` is on. Four more routes on the public port, all needing the code:

- `POST /api/listen`: the nearby check (as for `request`), then, if `listen_pin` is set, the PIN or a
  remembered PIN pass (an HMAC of the code and PIN, so changing either ends it). Wrong PINs are
  counted per address (`client()`): 5 within 10 minutes, then that address waits out the 10 minutes,
  right PIN or not. Phones sharing a carrier's address share that count, so one person guessing can
  hold up others for up to 10 minutes. Gives a pass (HMAC with an expiry) good for 15 minutes; the
  phone renews it with its location, so walking away ends listening within 15 minutes.
- `GET /api/listen/now`: needs a pass. Says only whether a show is on, its name, length, position and
  a signed link to its song.
- `GET /listen/song`: the playing show's song only (its key must match the song on now), with a
  signature of the code, PIN and song key. The signature doesn't expire, so anyone who saw the link can
  fetch that song while it's playing, until the code or PIN changes. Accepted: it's the song phones
  are meant to hear anyway, and it's useless once another show is on.
- `GET /listen/silence.wav`: a fixed fifth of a second of silence, no code needed.

The passes' key is a random file, `.listen-secret`, in the config folder; backups leave out hidden
files. The PIN is kept as typed in the settings (it's shown in the editor) and isn't a password.
Listening polls have their own per-address limit (`MAX_LISTEN_PER_CLIENT_MIN`, 1,500 a minute, about
25 phones on one address). Song copies (`songcopy.py`) are made with ffmpeg from the owner's own files
only, one at a time, with a 3-minute limit, in a temporary folder.

## Admin PIN (0.2.324)

Off unless `public.admin_pin` is set (4 to 8 digits). One more route, `POST /api/admin`, needing the
code: right PIN gives an admin pass, an HMAC of `admin|code|admin_pin` with the listening key, so
changing the code or the admin PIN ends every pass. Wrong PINs are counted per address as for the
listening PIN, in their own count (`admin_pin|<address>`), so guessing one doesn't hold up the other.
With no admin PIN set the route always refuses.

The phone sends the pass as an `X-Admin` header (not in addresses, so it stays out of tunnel logs).
`is_admin()` checks it on `state`, `request`, `near`, `listen` and `listen/now`, and it skips: Nearby,
opening hours, the listening PIN, `per_phone`, `queue` (a ceiling of `MAX_QUEUE` stays) and `on`. It doesn't skip the no-repeats rule (0.2.328): a show already waiting or playing can't be queued again. The
code is always still needed. The song link for an admin phone is signed separately
(`song-admin|code|admin_pin|key`, with `a=1`), so only that signature gets past `on` being off.

The visitors' page offers no visible way in: five quick taps on the title open the PIN box. That's
obscurity on top of the PIN, not instead of it. The admin PIN is shown in the editor like the
listening PIN, and the editor warns when the two are the same.

## Admin controls (0.2.332)

`POST /api/admin/skip`, `/api/admin/stop`, `/api/admin/remove` need the code and a valid `X-Admin` pass
(`_admin_only`), else 403. For an admin phone the state gives every queued pick's id (never tickets).

## Installing as an app (0.2.330)

Two more routes: `GET /manifest.webmanifest?c=<code>` (404 without the right code, since it carries the
title and the code in `start_url`) and `GET /icon.png?s=192|512` (no code; drawn from the theme's two
colours only, by `appicon.py`, cached in memory). No service worker, so nothing is cached for offline
use and every call still goes through the usual checks.

## Fixed in 0.2.177

| Finding | Seen | Fix |
| --- | --- | --- |
| Wrong-code POSTs counted towards everyone's 120 a minute, so anyone could lock out every visitor | 120 wrong guesses, then a real visitor got 429 | The shared limit counts only requests with the code; each client also has its own (`MAX_POSTS_PER_CLIENT_MIN`) |
| `GET /api/state` had no limit, and each call read the settings file, in the process that sends frames | 1000 calls in 0.5 s, all 200 | Per-client limit (`MAX_STATE_PER_CLIENT_MIN`, also `/picture` and `near`); `load()` keeps the settings until the file changes |
| Photos were served exactly as uploaded: GPS, phone, time | By reading `storage.save_house_photo` | `imagemeta.strip` on the way out (JPEG APP1/APP3–13/APP15/COM and the MPF index, PNG text and eXIf, WebP EXIF/XMP); a JPEG's Orientation is kept so phone photos stay upright |
| Phones' extra pictures after a JPEG's end (HDR gain maps, motion-photo video), each with its own Exif | Second review | `_jpeg_end` finds the first picture's end, through every scan of a progressive JPEG; the rest is dropped |

`client()` decides who's asking: behind a proxy (the connection comes from a private address) only
what the proxy itself writes, the **last** `X-Forwarded-For` entry, else `X-Real-IP`; straight from the
internet, the connection's own address, as visitors can write those headers themselves.
`CF-Connecting-IP` is deliberately not used: Cloudflare sets it, but Nginx Proxy Manager and most other
proxies pass it on as the visitor wrote it, which would give each request a new identity. IPv6
addresses count by their /64. At `MAX_CLIENTS` remembered addresses, the half not heard from for
longest are forgotten (never everyone's at once).

## Limits that remain

- **Nearby only trusts the phone's own location.** It's a deterrent, not a lock; a script can send the
  house's coordinates. The house's location is not on the page, but anyone outside knows it.
- **A determined person with the code** can keep the queue full from many addresses, with a fresh
  ticket each time. Per-client limits slow them; **Clear the queue** and **New code…** stop them.
- **"On your own network" (`is_local`)** is true for a private address with no proxy headers. A proxy
  that adds none, or a router port forward that keeps private source addresses (unusual), would let
  everyone skip the location check. The user guide says to use a tunnel or proxy.
- **Phones sharing one address** (a mobile network's, a venue's, or every visitor when a proxy adds no
  address header) share one visitor's limits. `MAX_STATE_PER_CLIENT_MIN` (300) leaves room for a dozen
  or so phones polling every 3 s; beyond that some see "That's a lot of asking" for a minute.
- **A photo that can't be read isn't shown** (`imagemeta.clean` gives None, `/picture` a 404, and the
  editor's preview leaves it out too), rather than shown with its details. The log says which.
- **Proxies:** with only `X-Real-IP` (no `X-Forwarded-For`) a visitor could add their own
  `X-Forwarded-For` and dodge their limit; with Cloudflare in front of Nginx Proxy Manager the last entry
  is a Cloudflare edge address shared by many visitors (they share limits). IPv4 visitors written as
  `::ffff:` addresses by a dual-stack proxy count as their IPv4 address.
- **Orientation is kept for JPEGs only.** PNG and WebP lose theirs with the rest; phone photos are
  almost always JPEG.
- The `Server` header names aiohttp and Python. Left as is: it reveals nothing that isn't public.
