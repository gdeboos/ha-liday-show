# Govee protocols: what we know and how we found it

Developer notes for whoever works on how lights are driven next (person or AI). Everything here was
worked out on the owner's real lights in October 2026, mostly in issue #74. Code references are to
`haliday_show/app/halidayshow/` unless they say otherwise.

## The ways the add-on can drive a light

Each light picks one **Protocol** on Setup → Devices (`PROTOCOLS` in `protocol.py`). Since **0.2.206**
only `standard` (**Realtime**) and `whole` (**Whole light (one colour)**) are offered. The other four were
taken out once the owner moved his string lights to WLED: `razer` and `v2` never helped on his lights,
and `segments` and `pixels` were slow, experimental workarounds for the H70C5's 44-bulb window. Lights
saved on them move to `standard` at start-up (`migrate.retire_govee_protocols`, which also cuts a
light down to its model's realtime `reach` or 255 segments). Govee scenes (`ptReal` `33 05 04`, from
Govee's public scene library) went at the same time. **The code for them is in git history (0.2.205)**,
and the findings below are kept so nobody repeats the work. The table is how they stood:

| Protocol | Wire format | Speed | Notes |
| --- | --- | --- | --- |
| `standard` (Realtime) | razer `BB <len16> B0 <flag> <n> <rgb…> <xor>` | 40 fps | What OpenRGB sends. One byte for the count, so ≤ 255 segments. |
| `razer` | same, length field fixed at `0x0E` | 40 fps | SignalRGB's "Razer". |
| `v2` | razer `B4` with a zone byte after each colour | 40 fps | SignalRGB's "DreamView V2". |
| `whole` | official `colorwc` with the average colour | ≤ 10/s | Fades every change. |
| `segments` (App segments) | `ptReal` of BLE packets `33 05 15 01 r g b 00×5 <mask LE>` | see below | The Govee app's own segment colour command. |
| `pixels` (Per bulb) | `ptReal` of a Finger sketch picture (below) | see below | Every bulb, any light whose app has Finger sketch. |

`whole`, `segments` and `pixels` are the "slow" protocols (`static/js/lightspeed.js`): Generate and
the AI pick slow-friendly looks for them, and the Selection panel warns when a clip is too fast.

`ptReal` is the LAN API's unofficial command `{"msg":{"cmd":"ptReal","data":{"command":[base64…]}}}`
carrying the same 20-byte packets the Govee app sends over Bluetooth: up to 19 bytes padded with zeros,
then the XOR of those 19 bytes. **Over the LAN these are not encrypted**, even on lights whose Bluetooth
is (see below). Bigger payloads go as an `a3` multi-packet upload (`multi_packets()`): `a3 00 01 <lines>
<kind> …`, then `a3 01`, `a3 02` … with the last line numbered `ff`. Scenes are kind `02`, Finger sketch
pictures kind `03`.

## Realtime (razer) on newer string lights: a 44-bulb window

The 30 m Christmas String Lights 2 (**H70C5**, 300 bulbs, `Pillars` on the owner's network) in razer
mode, tested from the packet lab:

- It only ever lights the **first 44 bulbs**. The count byte splits bulbs 1–44 into that many equal
  slots, and each colour in the frame (as many as the length field holds) fills the next slot; slots with
  no colour stay off. Owner's tests, Oct 2026: count `0a` with 10 colours lit all 44; with 1 colour about
  5 bulbs; with 2 colours about 10 (flag `01` or `02` alike). More than 44 colours (true length) is
  **rejected**: the light ignores the frame.
- The flag byte (byte after `B0`) only switches crisp/blend (`01`, `02` both lit the same 44 bulbs).
  LeoSko/GoveeDreamView documents it as `00` per segment, `01` stretch across all LEDs; `00` with 10
  colours on the H70C5 still only lit the first 44 bulbs.
- `B4` (v2) is ignored. The fixed-length 14 variant lit 4 bulbs (the light honours the length field).
- The **Run sweep** in the packet lab (`labtemplates.js` `windowSweep`) tries nine ways to address
  bulbs past the window (two-byte count, start offsets, commands `b2`/`b3`/`b5`, zone bytes). Run on the
  H70C5: **none got past bulb 44**.
- **Try ways to switch on** (`startSweep`: `b1 01` with extra bytes, gradient switch `33 14 01`, video
  mode `33 05 00 …` before the usual frame) was also run on the H70C5: **none of the seven changed
  anything**; the rainbow stayed on the first 44 bulbs.
- **Try other flags** (`flagSweep`, 0.2.84): flags `03 04 05 08 10 20 40 80 ff` with a 44-colour frame,
  run on the H70C5: each lit the first 44 bulbs in its colour, as `01` does; **none got past bulb 44**.
- **Try app modes first** (`modeSweep`, 0.2.84): a bare `33 05 <mode>` for modes `01`–`15` (not `00`,
  `0a`), then the usual frame, run on the H70C5: every step showed its colour on the first 44 bulbs only;
  **none got past bulb 44**. (A first run with Segments at 300 sent 255-colour frames, which the light
  ignored entirely, so both sweeps now use the model's known `reach` as the window.)
- The **"dreams" header** (`BB 00 FA B0 00 <count> …`: length field fixed at 250, flag `00`), which a
  published H61F5 (Strip Light 2 Pro) example says reaches the whole strip with 50 pixels where the usual
  header covers only part of it, doesn't help the H70C5 (owner's packet lab, Oct 2026): 44 pixels lit
  the first 44 bulbs only; 50 pixels were rejected (the light went off), as with the usual header.
- `b1 00` with extra bytes (e.g. `b1 00 10 fa b0 00`) is just realtime off: the light flashes and goes
  back to its own colour.
- The Govee app has no setting for the window, and Govee Desktop doesn't offer screen sync for it.
- The newer icicle lights (H70D1/H70D2) also light only part of the string, but differently. Owner's
  10 m **H70D1**, packet lab, 27 Oct 2026, "Realtime: every segment one colour" / "Realtime: rainbow":
  - 44, 128 and 129 colours all lit up to the same place, roughly halfway along the string; 255 colours
    turned the light off. (The H70C5 goes off above 44.) Where between 129 and 255 it gives up isn't known.
  - A 128-colour rainbow showed every colour, red to violet, within that half, and a 10-colour rainbow
    reached the same place. So unlike the H70C5 (one colour per bulb, bulbs 1–44), the H70D1 **stretches
    whatever it's sent across a fixed window** of about half the string; more colours only add detail.
  - **Per bulb doesn't get further** (same day). The box says 400 LEDs. Speed test "Every bulb" with
    Segments 300 stopped about halfway with random colours at the end; with 400, no random colours but
    still stopped about halfway. Hand-made pictures (ptReal lines): the **background colour shows on the
    first half only** (black, then red), and bulbs listed in groups never lit, whether written the
    H70C5 way (1 byte below 256) or every bulb as 2 bytes LE (bulbs 0–49 green on red: all red, first
    half). "First 10 bulbs" speed test: the light just went off. An 18-packet picture (four 50-bulb
    blocks on black) showed no change.
  - **The Govee app's Finger sketch does reach the far end**, and is noticeably slower to apply each
    paint than on the H70C5. So the app sends something different for the icicles (perhaps two
    pictures, one per half, or a different kind); only a Bluetooth capture of the app on the H70D1 will
    show what. Not yet tried: the 20 m H70D2, the window sweeps on the icicles.

Govee's product data (SignalRGB's copy) marks **none** of the 54 Scene Stage models as
realtime-capable, including the Permanent Outdoor Lights Pro (H706A/B/C) that do work (owner's, and
signalrgb-govee's 60/90/108 LEDs). Since 0.2.82 that flag isn't used at all: `static/models.json` is our
own list. Since 0.2.86 names come from Govee's own list of lights with LAN Control (the API behind
app-h5.govee.com/user-manual/wlan-guide, `app2.govee.com/bff-app/v1/user/guide/device/info?market=US`,
280 models in Oct 2026; `tools/build_models.py` adds new ones and marks listed ones `lan: true`). That list
isn't complete (the DreamView T1, H6199, isn't on it), so a missing model isn't marked unsupported. Older
names came from SignalRGB's data;
`status` (`works` / `limited`, else untested), the default `protocol`, `segments`, `bulbs`, `reach` and
`note` are only what real lights showed, and are edited by hand. New lights start with a model's
defaults (`static/js/models.js`); `reach` (bulbs its realtime mode lights) drives the timeline warning
(`compat.js`). Add to it when the owner tests a light.

## Per bulb: the Finger sketch picture

The Govee app's **Finger sketch** colours any bulb on these lights. Its format, from a decrypted
Bluetooth capture and confirmed by replaying it over the LAN (`pixel_picture()` / `pixel_packets()`):

```
a3 upload of kind 03 holding:
  <effect> <speed> <brightness> <background r g b> <groups, 2 bytes LE>
  per group: <bulbs, 2 LE> <r g b> <bulbs ≥ 256, 2 LE>
             <each bulb < 256, 1 byte> <each bulb ≥ 256, 2 bytes LE>
then the packet 33 05 0a 20 03 to show it.
```

- Bulbs count from 0 at the plug. Bulbs in no group show the background colour.
- Effect `13` = Twinkle, `14` = Breathe, `0f` = Gradient. `00`, `01`, `02`, `10`, `11`, `12`, `15` turn the
  light off (invalid). **Gradient at speed 0 holds still**: that's what `pixels` sends. Speed `32`/`64`
  animate (Gradient at `64` flashes). Brightness `64` = 100%.
- The app's background colour is the header's rgb (white by default). We send the **most common colour**
  as the background so only the other bulbs need listing.
- **A picture listing no bulbs (zero groups) doesn't work** on the H70C5: sent while the light showed a
  `colorwc` green, a red zero-group picture made it fade out slowly; and in shows, an all-black frame
  didn't turn it off (it kept the last colour). Listing one bulb fixes both (owner's packet lab tests,
  Oct 2026: red with bulb 0 blue showed exactly that; all black with bulb 0 listed black went dark at
  once). So a frame all one colour lists bulb 0 in that colour too: 3 packets.
- Colours are plain RGB. When a frame has more than 24 colours they're merged (`_palette`).
- **Breathe (`14`) animates only the listed bulbs**; the background holds still (all-background red
  stayed steady). Breaths a second by speed byte, H70C5: `32` ≈ 0.1, `4b` ≈ 0.5, `64` ≈ 2 (×4–5 per 25).
  **Twinkle (`13`) didn't animate** at `4b` or `64`, listed bulbs or background. Handing Pulse clips to
  Breathe was considered and parked: issue #103 (owner's packet lab tests, Oct 2026).

**Speed (H70C5, measured with the packet lab's Per bulb speed test):**

| Picture | Packets | 2/s | 4/s | 8/s |
| --- | --- | --- | --- | --- |
| 10 bulbs | 3 | keeps up | | drops some |
| every bulb | 23 | keeps up (odd drop) | drops every run | |

So each picture costs about **0.12 s + 0.018 s per packet**, and sending faster makes the light drop
pictures (it then shows about one in three). `output.py` waits `PIXELS_PICTURE_S + PIXELS_PACKET_S ×
packets` (0.13 s + 0.02 s) between pictures and splits each into `ptReal` messages of ≤ 12 packets
40 ms apart (govee-lan-bridge found 24 packets in one message dropped, 18 fine). Result: about 6
pictures a second for mostly-one-colour looks, about 1.5 for a full 300-bulb rainbow. The owner's
verdict: "ok but not amazing"; it's the light's processing, not the transport, so a faster link won't
help. Fast chases look steppy; fades, colour changes and beat flashes look good.

## App segments: 33 05 15

`33 05 15 01 <r g b> 00 00 00 00 00 <segment mask LE, bit 0 = segment 1>` colours the app's own
segments (10 on the H70C5). Separate datagrams sent back-to-back get dropped, so commands are bundled
in one `ptReal`. Sending ~100 commands a second made the H70C5 lag behind; `output.py` now sends at
most 3 per send, biggest change first (`SEGMENTS_PER_SEND`), skipping changes ≤ 12/255. Not retested on
the light after that fix. govee-lan-bridge's notes agree (≤ 12 commands per message; `33 05 15 02` is
per-segment brightness).

## Bluetooth: encrypted, but decryptable

Newer Govee lights encrypt Bluetooth (handshake `e7 01` / `e7 02`). The published scheme
(govee-ble-local, bartekpacia/govee, openHAB #20976) worked on the H70C5:

- Pre-shared key `MakingLifeSmarte` (the first 16 bytes of "MakingLifeSmarter").
- Each 20-byte packet: AES-128-ECB on bytes 0–15, RC4 (restarted per packet, same key) on 16–19.
- The phone sends `e7 01` + random, under the pre-shared key. **The light's `e7 01` reply carries the
  session key in bytes 2–17.** Then `e7 02` both ways, then everything uses the session key.
- After that the plaintext is ordinary Govee BLE: `aa 01` keep-alive every 2 s, `aa 40` reports the
  bulb count (`01 2c` = 300), `aa a5` the segment colours, `33 05 …` commands, `a3` uploads.

`tools/govee_btsnoop.py` decrypts an Android `btsnoop_hci.log` with this.

**How the captures were made (Samsung Android):** Developer options → Bluetooth HCI snoop log =
Enabled, toggle Bluetooth, turn Wi-Fi *and* mobile data off so the app must use Bluetooth, use the app,
then take a bug report (Developer options → Bug report → Full; it takes a few minutes with no feedback)
and pull `FS/data/log/bt/btsnoop_hci.log` (or search the extracted zip for `btsnoop`). `*#9900#` →
SysDump is the fallback. With Wi-Fi on, the app goes through Govee's cloud instead (AWS IoT MQTT on
port 8883, TLS, seen with PCAPdroid): nothing goes to the light over the LAN, so a LAN capture shows
nothing useful.

## Things tried that didn't help

- **Listening for Scene Stage** (Setup → Labs → Listen): a sync centre (Curtain Lights 2, not the
  Permanent Pro) drives other lights per bulb, but almost certainly unicast to each light, which the HA
  host can't hear. Not run; the Finger sketch route made it unnecessary. The owner doesn't have a
  sync centre: the Permanent Outdoor Lights Pro can't be one (checked in the app).
- **Wireshark on a laptop**: can't see phone ↔ light unicast. A UniFi access point can `tcpdump` its
  bridge (SSH), but the app used the cloud, not the LAN.
- **HA Bluetooth proxies**: only relay advertisements; can't sniff connections, and add-ons can't use
  them. Bluetooth control would be the same commands as `ptReal`, only slower.
- **Beshelmek/govee_ble_lights** and **SamWiIIiams/govee-lan-bridge**: same `33 05 15` segment
  command, nothing per bulb.
- **DreamView** (PC and TV sync) is the same razer protocol, not a new one: LeoSko/GoveeDreamView,
  thecristopher/lightsync and OpenRGB all send `BB … B0 <flag> <n> <rgb…>` (lightsync falls back to
  `33 05 15` for the rest). None handles long strings or anything past a light's window. Govee Desktop
  doesn't offer screen sync for the H70C5. A TV sync box does drive the String Lights 2 (a UK Amazon
  review of the 20 m set, Dec 2025: "the tree follows the colours of the tele" with the camera kit), and
  owners in the Govee Facebook group describe the set-up as "add the string lights to DreamView… then set
  the segments" (Nov 2024). The owner has seen video of the **whole** string following the TV, so the sync
  box gets colour onto all the bulbs live, which our razer frames can't (first 44 only). Unknown whether
  that's per bulb, the 44 live colours spread along the string, or (most likely, given "set the
  segments") the app's ~10 segments changed quickly, which **App segments** already does. Seven guesses
  at a set-up message found nothing (see above); only a capture of a sync box would settle it. Testing it
  would mean buying one and capturing on the UniFi access point; not done.

## Where this stands (Oct 2026)

For the H70C5 and the icicles (H70D1/H70D2) the add-on offers three ways, each a trade-off:
**Per bulb** (every bulb, a few pictures a second), **App segments** (about 10 bands, faster) and
**Realtime** (smooth, first 44 bulbs only on the H70C5; about the first half, stretched, on the H70D1). Everything we can send from the LAN to get past bulb 44 live
has been tried. The two leads left, Scene Stage and TV DreamView, both need a device the owner doesn't
have (a sync centre such as the Curtain Lights 2, or a DreamView sync box) and might still turn out to
be segments only or to go over Bluetooth or the cloud. Agreed with the owner to stop here unless one
turns up; if it does, capture its traffic (Listen first, then `tcpdump` on the UniFi access point) and
walk the owner through it one step at a time.
Since the owner has neither, `docs/capture-help.md` (Oct 2026) asks the community for set-up details, a
video and a router capture from their own sync box or sync centre; record anything that comes back here.

## Tools in the add-on for this kind of work

All under Setup → Labs (tick **Show the Labs tab** under Setup → Settings → Experimental first):

- **Packet lab** (`lab.py`, `static/js/labtemplates.js`): send JSON, razer or `ptReal` to one of the
  configured lights, repeated on a timer, and see replies. Has the **Run sweep** (past the realtime
  window), **Try ways to switch on** (`startSweep`: razer enable with extra bytes, the app's gradient
  switch `33 14 01`, video mode `33 05 00 …`, each then a 44-colour rainbow; a step's `before` messages go
  out ahead of it) and the **Per bulb speed test**.
- **Listen for Govee traffic** (`listen.py`): records Govee packets the HA host can hear.

## Open questions

- What does a DreamView sync box, or a Scene Stage sync centre, send to make the H70C5 show live colour
  along the whole string? (Needs one of those devices; see "Where this stands".)
- Does Per bulb light the whole H70D1/H70D2, and at what picture rate? Does the H70D2's realtime window
  also stop about halfway? Do other lights with Finger sketch accept it?
- App segments after the 0.2.71 lag fix: does it keep up now?
