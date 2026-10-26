<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Labs and experiments

[← The editor, settings and your data](editor-and-settings.md) · [Contents](README.md) · [Troubleshooting and storage →](troubleshooting.md)

## Packet lab

**Setup → Labs → Packet lab** is for experiments with Govee lights: it sends one light a message you
choose and lists anything the light sends back. You won't need it to make shows. To see **Labs**, tick
**Show the Labs tab** under **Setup → Settings → Experimental**.

1. Pick the **Light** (only Govee lights on the Devices tab with an IP address are offered).
2. Pick a starting point under **Start from**, such as **Ask for its status** or **Realtime: rainbow**,
   and set **Segments** and **Colour** for it. The message appears in the box, where you can change it.
3. Choose how many times to send it and how often. Realtime messages are sent 50 times, a tenth of a
   second apart, with **Realtime on first**, because lights drop back to their own scene within a
   moment otherwise.
4. Press **Send**. **Stop** ends it early. A playing show is stopped first.

The three types are a whole **JSON message**, a **Realtime (razer) packet** (type the command byte
and its data in hex; the header, length and checksum are added, and **Length field** overrides the
length), and an **App command (ptReal)**: one Govee app command per line, in hex.

### Reaching past the realtime window

Some lights, like the 30 m Christmas String Lights 2 (H70C5) and the icicle lights, only take
realtime colours for their first few dozen bulbs (44 on the H70C5). **Run sweep** tries nine guesses
at how the rest of the bulbs might be reached, one after another for about 45 seconds. Each guess
asks for the bulbs just past the window in its own colour. Film the whole light while it runs. A colour appearing past the window means that guess
works; the list under the button says which colour is which.

A Govee TV sync box does get colour onto the whole of these lights, so it may switch them into a
different mode first. **Try ways to switch on** tries seven guesses at that, one after another for about
50 seconds, each followed by a rainbow over the window. Watch the
whole light: if the rainbow reaches past the window or stretches along the whole string, note the number
shown under the buttons at that moment.

All four sweeps use the window of the light's model when it's known (44 for the H70C5, whatever
**Segments** says), and otherwise **Segments**, so set **Segments** to the window for other lights.

Two more sweeps try other ways past the window, each step in its own colour, with the list under the
buttons saying which is which. **Try other
flags** sends a frame of one colour with nine different values in the byte that switches crisp or blended
colours, for about 45 seconds. **Try app modes first** switches the light into twenty Govee app modes in
turn, each followed by a frame in its colour, for about a minute and a half; the light goes plain white
between steps. For either, watch for a colour lighting more than the first bulbs.

### Per bulb speed test

For lights on **Per bulb (experimental)**: **Run speed test** changes the picture for six seconds,
at the number of **Pictures a second** you pick. **First 10 bulbs** flips them between red and blue;
**Every bulb** moves a red, green and blue pattern along the whole light one bulb at a time. Set
**Segments** to the light's number of bulbs. If the light changes every time, it keeps up at that
rate; if it skips or stalls, it doesn't.

## Listen for Govee traffic

Some Govee features drive lights in more detail than HA-liday Show can. In **Scene Stage**, for example,
one light (the sync centre) plays a picture across all the others. **Setup → Labs → Listen for
Govee traffic** helps work out how, so HA-liday Show can learn to do the same:

1. Start Scene Stage (or whatever you want recorded) in the Govee Home app.
2. Press **Listen for 60 seconds**. Nothing is sent to your lights, and a playing show is stopped.
3. When it finishes, the table shows which lights sent what. Press **Download** and attach the file to
   an issue on HA-liday Show's GitHub page.

If it hears nothing, the lights are talking to each other directly, where Home Assistant can't hear.

## Experimental: Govee scenes

For Govee lights only. Turn on **Settings → Experimental → Govee scenes** to add a **Govee scene**
effect. Its clip hands the light to one of the scenes built into the Govee app (the app's Scenes list, not your own saved
snapshots or DIYs) for as long as the clip lasts, then the show takes the light back.

- Pick the scene in the clip's settings. The list comes from Govee's public scene library for the
  light's model, so the light needs a model (scan for it on the Devices tab) and Home Assistant
  needs internet access the first time. The list is then cached for a week.
- It sends the light the same commands the Govee app sends over Bluetooth, through the LAN API's
  unofficial `ptReal` command. Not every light accepts it.
- The preview shows a purple shimmer where a scene runs, because the editor can't know what the
  scene looks like. The light may blink as it switches in and out of a scene.

---

[← The editor, settings and your data](editor-and-settings.md) · [Contents](README.md) · [Troubleshooting and storage →](troubleshooting.md)
