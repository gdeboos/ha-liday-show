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

## Fixed in 0.2.177

| Finding | Seen | Fix |
| --- | --- | --- |
| Wrong-code POSTs counted towards everyone's 120 a minute, so anyone could lock out every visitor | 120 wrong guesses, then a real visitor got 429 | The shared limit counts only requests with the code; each client also has its own (`MAX_POSTS_PER_CLIENT_MIN`) |
| `GET /api/state` had no limit, and each call read the settings file, in the process that sends frames | 1000 calls in 0.5 s, all 200 | Per-client limit (`MAX_STATE_PER_CLIENT_MIN`, also `/picture` and `near`); `load()` keeps the settings until the file changes |
| Photos were served exactly as uploaded: GPS, phone, time | By reading `storage.save_house_photo` | `imagemeta.strip` on the way out (JPEG APP1/APP3–13/APP15/COM, PNG text and eXIf, WebP EXIF/XMP); Orientation is kept so phone photos stay upright |

`client()` decides who's asking: behind a proxy (the connection comes from a private address) the
proxy's header (`CF-Connecting-IP`, `X-Real-IP`, the **last** `X-Forwarded-For` entry); straight from the
internet, the connection's own address, as visitors can write those headers themselves. Remembered
addresses are capped (`MAX_CLIENTS`).

## Limits that remain

- **Nearby only trusts the phone's own location.** It's a deterrent, not a lock; a script can send the
  house's coordinates. The house's location is not on the page, but anyone outside knows it.
- **A determined person with the code** can keep the queue full from many addresses, with a fresh
  ticket each time. Per-client limits slow them; **Clear the queue** and **New code…** stop them.
- **"On your own network" (`is_local`)** is true for a private address with no proxy headers. A proxy
  that adds none, or a router port forward that keeps private source addresses (unusual), would let
  everyone skip the location check. The user guide says to use a tunnel or proxy.
- The `Server` header names aiohttp and Python. Left as is: it reveals nothing that isn't public.
