# WLED

How HA-liday Show drives WLED strips. Govee lights are in `govee-protocols.md`; nothing here changes them.

## Saved devices

A device with `"kind": "wled"` is a WLED strip. Devices saved before WLED support have no `kind` and
are marked Govee at start-up (`migrate.fill_device_kinds`, from 0.2.89), and a device that still arrives
without one (say, from an old backup) is read as Govee (`server._clean_device`). A WLED device always has `protocol: "ddp"`, `sku: ""` and no
blending, and can have up to `MAX_SEGMENTS` (1000) segments, one per LED.

## Sending frames: DDP

`wled.ddp_packets` and `output.WledDevice`. Frames go to UDP port 4048 as DDP:

- 10-byte header: flags `0x40` (version 1), `| 0x01` (push) on a frame's last packet; sequence 1–15;
  data type `0x0B` (8-bit RGB); destination `0x01`; data offset in bytes (4, big-endian); data length (2).
- At most 480 LEDs (1440 bytes) a packet, so any frame fits normal network packets.
- Up to 40 frames a second (the same cap as Govee realtime). An unchanged frame is repeated every
  second: WLED's realtime timeout is 2.5 s by default, after which it goes back to its own effect.
- Nothing is sent to start or stop: WLED switches to realtime on the first packet and back when they
  stop.

Chosen over WLED's own UDP realtime (port 21324, DRGB/DNRGB) because DRGB caps a packet at 490 LEDs,
DNRGB needs its own start index per packet and a timeout byte, and DDP needs no setup in WLED.

Not checked on a real WLED yet (none in reach of a cloud session): only on the wire, with a fake WLED
at 127.0.0.1 listening on UDP 4048.

## Parts from WLED segments

`POST /api/wled/info {ip}` reads `http://<ip>/json`: `info.name`, `info.leds.count` and `state.seg`.
Each segment (`start` 0-based, `stop` exclusive) becomes a part `w<segment id>` running `start+1`–`stop`,
named from its `n` or *Segment N*. One segment covering the whole strip isn't a split, so it gives no
parts. Overlapping or empty segments are skipped. Part ids follow WLED's segment ids so clips stay on
a part when **Use WLED segments** is pressed again.

During a show the add-on writes every LED directly, so WLED's segment effects, mirroring and grouping
don't apply. WLED's **Use main segment only** (Config → Sync Interfaces) limits realtime data to the
main segment, so it should be off. WLED's master brightness still scales the frames.

## Live music: listening to sound sync

`livemusic.py` listens on UDP 11988 (joined to multicast 239.0.0.1) for WLED's AudioReactive sound
sync, version 2: 44 bytes, little-endian, header `00002\0`, then sampleRaw and sampleSmth (f32),
samplePeak (u8), 16 FFT bands (u8), FFT_Magnitude and FFT_MajorPeak (f32), as `audioSyncPacket` in
WLED's `audio_reactive.h` (0.14 and later). Older `00001` packets are only reported as too old.
Loudness is sampleSmth scaled from 0-255; bass, middle and treble are bands 0-3, 4-9 and 10-15.

Written from WLED's source, not yet checked against a real WLED with a microphone (Gavin's will be the
first). Still to confirm there: where the sync **Send** setting is in WLED's pages on his version, the
range of sampleSmth with AGC on and off, and how often a beat flag arrives.

From 0.2.287, scenes with **React to music** (`react.py`, a scene's optional `react` setting) follow
`LiveMusic.now()`, which also gives `beat_at` (when the last beat flag arrived). The player calls
`Reactor.step` every frame time and only scales, lifts towards white or swaps baked frames: the level
follows sampleSmth, a flash starts on each new beat, and the strong bass or treble scene's loop is used
while bands 0-3 or 10-15 are at least 70 and 10 above the other. Checked on the wire at 127.0.0.1
with packets sent to 11988; not yet on a real WLED with a microphone.

## Matrices (2D)

From 0.2.278 a WLED light, DDP or E1.31 controller can be a matrix: a saved `matrix: {w, h, start,
order, zigzag}` (`server._clean_matrix`), with `segments` always w × h and up to 4,096 (`MAX_MATRIX`;
strips stay at 1,000). A matrix has no parts and no Reverse. Plan: the project doc `claude/matrix-plan.md`.

- The editor works in grid order (rows from the top left). `matrix.js` `toWire` puts a frame into the
  light's wiring order; `bake()` and the clip preview on the light apply it, so the player only plays
  frames, as ever.
- `POST /api/wled/info` returns `matrix: {w, h}` from `info.leds.matrix` when WLED is set up as 2D. Such a
  light is saved as plain rows from the top left, on the understanding that WLED applies its own 2D
  mapping (panels, serpentine, ledmap) to realtime data, as WLED's source suggests: realtime pixels
  go through `setPixelColor`, which looks each index up in the mapping table `setUpMatrix()` builds
  from the 2D configuration.
- 4,096 LEDs go out as 9 DDP packets (checked on the wire at 127.0.0.1).

Not checked on a real matrix yet (Gavin doesn't have one). **Test wiring** (top left white, top row red,
left column green) is how to confirm the WLED mapping assumption on the first real one; record it here.

## Open questions

- Matrices: whether WLED really untangles a 2D layout for DDP data (see above), and how a mega-tree is
  usually set up in WLED's 2D configuration (release 2 in the plan).
- Strips over 1000 LEDs: only the first 1000 are driven.
- Finding WLED lights automatically (mDNS, or Home Assistant's WLED integration): would need a new
  library or HA's websocket API; adding by IP covers it for now.
