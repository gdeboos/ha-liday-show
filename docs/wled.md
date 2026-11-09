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

### A light per segment (0.2.431)

Adding a WLED with several segments asks whether to make **one light with parts** or **a light per
segment**. A segment light is a WLED light with `first` (its segment's first LED, 1-based, as for DDP
pixel controllers) and `segment` (WLED's segment id); a whole WLED light saves neither, as before
(`server._clean_device`; a matrix can't be one). Frames go to `ip#first` (`output.address`), so each
light's DDP packets start at its own offset and the lights stream side by side, each with its own push.
`wled.own_effect_state(look, segment)` sends `seg: {id, ...}` so WLED's own effect goes to just that
segment. Frames to any other light on that WLED would put it back into realtime and end the effect, so
`runner._scene_devices` gives no frames to WLED lights sharing an IP with one on its own effect; they
show what WLED has for their segments. Editor logic in `static/js/wledsegments.js` (node-tested);
**Convert to WLED…** can pick a segment, and **Update from WLED** re-reads it.

A WLED's web server drops requests that arrive together: seen on Gavin's Gledopto (7 Nov 2026), where the pre-show check asked its three segment lights at once and only one answered. Since 0.2.433 `wled.fetch` and `wled.set_state` take a per-IP lock (one request at a time to each WLED), and the pre-show check asks each controller once.

From 0.2.432 a WLED light linked to an IP (typed into a planned one, or **Just one segment…**) picks its segment the same way (`app.js` `linkWled`), stretching its own parts like a conversion.

Checked on the wire with a fake WLED at 127.0.0.1: a light on segment 1 (LEDs 151–210) sent DDP at offset
LED 150 (0-based) for 60 LEDs. Not yet on a real WLED: on Gavin's Gledopto (three outputs, three segments),
check that each string lights only its own LEDs in a show, and that WLED's own effect on one segment
plays while the others hold.

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

From 0.2.315, scene lights can play **live music effects** (`liveeffects.py`; plan: the project doc
`claude/dreamview-plan.md`, release 3). The editor bakes each such light at 21 levels (0-100 % in fives)
into `house-scenes/<id>.live.gshow` (a bake whose tracks also say `kind: "level"` and `follows`). The
player picks the frame for the level heard (`Follower`: gliding over 0.15 s, starting from dark; idle
after 4 s below **Counts as music from**, when the scene's own bake, with the effect's idle glow,
plays). Checked on the wire at 127.0.0.1 with fake sound sync: a 60-LED Level meter following the bass
lit 30 LEDs at bands of 128 and 60 at 255, and showed its idle glow with nothing sent. From 0.2.316 a live set can also hold "burst" tracks (Beat burst): the burst from start to end at
40 frames a second, `count` frames, the last dark. The player starts it again on each new `beat_at`
(`liveeffects.Bursts`) and scales it by the level it follows (0.3 to 1). On the wire, with a beat
flag every half second, the burst restarted each time and faded in between. From 0.2.317 a "spectrum" track (Spectrum bars) is baked
like a level track (all bars at each level), with `regions` (each LED's region, along the wire) and
`bands` (each region's [first, last + 1) of WLED's 16). The player glides the 16 bands, and
`liveeffects.Spectrum` puts the light together run by run from each region's frame. On the wire, a
60-LED strip with bands 0-3 at 255 and 4-7 at 128 lit the first four sections fully, the next four
by half, and the rest not at all.

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

## WLED's own effects in scenes

From 0.2.314 a scene can give a whole WLED light the `wled` effect; from 0.2.434 a WLED light split into
parts can have it too, on its own row or lane (`sceneeditor.js` `wledOK`, `app.js` `sceneLight`). Its
parts' clips are then not played (the light gets no frames). From 0.2.435 a part read from WLED's
segments (id `w<segment id>`) can have it too, keyed `light#w<id>` in a Basic scene's `lights` or as an
Advanced lane (`housescenes.js` `wledSegmentPart`). `scenelib.wled_device` turns that key into the light
with `segment` set, so `seg: {id}` reaches only that segment; the whole WLED gets no frames, so its other
parts show what WLED has set for them. In a Basic scene it's the
light's look, `{effect: "wled", params: {fx, palette, speed, intensity, color, color2, color3,
brightness, fxName, palName}}`; in an Advanced scene, a clip with those fields covering the lane's whole
loop. Plan: the project doc `claude/effects-plan.md`, round 2.

### Previews (from 0.2.438)

`static/js/wled-effects/` is WLED 0.15.5's effect code translated to JavaScript, under WLED's EUPL 1.2
(its own `LICENSE`; the rest of the repo is MIT). `engine.js` is WLED's `Segment` and the FastLED
helpers it uses, `palettes.js` WLED's gradient palettes (generated from `wled00/palettes.h`),
`effects.js` the ported modes keyed by WLED effect id, and `index.js` runs one frame per 23 ms
(`FRAMETIME`, 42 fps) up to the moment asked for, keeping each light's state between calls (going back in
time starts afresh; more than 20 s ahead starts 5 s before). `EFFECTS.wled.render` calls `wledPixel`.

- Output is turned back from WLED's gamma 2.8 (`ungamma`), as WLED gamma-corrects picked colours and
  simple palettes but HA-liday Show's previews show colours as picked.
- `own_effect_state` sends no `fxdef`, so a WLED keeps the extra settings (`c1`-`c3`, `o1`-`o3`) it had;
  the preview assumes WLED's segment defaults (128, 128, 16, all off). With those, **Palette** (65) is one
  colour and **Scanner** (40) pauses about 3 s at each end, on the WLED as in the preview.
- Batch 1 (0.2.438): 0-3, 8-13, 15-17, 20, 23, 28, 40, 52, 57, 60, 64-67, 76, 80, 81, 88, 89, 97, 101,
  102. The rest of the strip effects follow in batches; others show `standIn` (palette, or the colours
  when the palette is Default, drifting).
- Updating to a newer WLED: compare `wled00/FX.cpp` for the ported modes and regenerate `palettes.js`.

- The editor reads the light's own lists from `POST /api/wled/info`. `wled.fetch` now returns
  `effects` and `palettes` from `/json` (`body.effects`, `body.palettes`), by number, with reserved
  slots ("RSVD", "-") blank. The scan leaves them out.
- `scenelib.wled_looks(scene, devices)` finds those lights. `Runner._scene_devices` leaves them out of
  the player's devices (so no DDP goes to them), and `Runner._wled_own` POSTs
  `wled.own_effect_state(look)` to `/json/state` in the background:
  `{"on": true, "live": false, "seg": {"fx", "sx", "ix", "pal", "col": [[r, g, b] × 3], "bri"?}}`.
  This applies to scenes and to scene blocks in playlists. A WLED that doesn't answer is logged and
  left as it is. Missing colours default to the editor's defaults (`wled.OWN_COLOURS`, tested against
  effects.js).
- `seg` is sent as one object, which WLED applies to its selected segments. For a light split into
  parts read from WLED (part ids `w<segment id>`), `wled.own_segments` lists those ids and `seg` is
  sent as a list with the look on each, so every segment plays it whichever are selected. Hand-made
  parts fall back to the single object. `live: false` is there
  to leave realtime mode at once, rather than after the 2.5 s timeout. `bri` on a segment is its own
  brightness (newer WLED). None of this has been checked on a real WLED yet (only against a fake
  answering `/json` and `/json/state`). On the first real one, check that the effect starts straight
  after a show, that a WLED with several segments plays it on all of them, and what `bri` does. Also
  check whether `live: false` really leaves realtime, or whether `lor` (live override) is what's needed;
  either way WLED leaves realtime by itself 2.5 s after the last DDP packet.
- The background POSTs are cancelled when anything else starts (`Runner._stop`), so a slow WLED can't
  drop out of the next show's realtime. A React to music bass or treble scene's frames skip the lights
  that scene hands to WLED's own effects.
- Nothing is sent when the scene stops; the WLED goes on with its effect until a show sends frames
  again (it switches to realtime on the first DDP packet, as ever).

## Open questions

- Matrices: whether WLED really untangles a 2D layout for DDP data (see above), and how a mega-tree is
  usually set up in WLED's 2D configuration (release 2 in the plan).
- Strips over 1000 LEDs: only the first 1000 are driven.
- Finding WLED lights automatically (mDNS, or Home Assistant's WLED integration): would need a new
  library or HA's websocket API; adding by IP covers it for now.
