<!-- The user guide is written here, a page per topic. tools/check_guide.py checks its links. -->

# Let it make a show for you

Suggestions, Describe it and Generate: a first draft in seconds.

## Suggestions

Once the song has been analysed, **＋ Add effect…** on a selection starts with looks
suggested for that part of the song: soft ones for a quiet verse, fast ones that move on the beat for
a loud chorus, with speeds set from the tempo and colours from the palette picked in the palette bar.

## Describe it

Type what you'd like in the **Describe it** panel and press **✨ Create**, for example
"red and green chase on the roof in every chorus, gentle white twinkle on the tree the rest of the time"
or "strobe everything on the last four bars". An AI turns it into effects on the lights you name, lined
up with the beats and sections, and they replace what those lights had at those times. If you select a
stretch first and the request doesn't say where or when, it works on the selection. Anything the AI gets
wrong (a light or effect that doesn't exist) is left out and listed in the status bar, and Ctrl+Z undoes
the lot. It needs an AI to be set up first; see [Setting up the AI](ai.md).

The AI knows every effect and what it looks like, and can also use
[transitions](show-editor.md#transitions), [settings that change over a clip](show-editor.md#settings-that-change-over-a-clip) and
[mixing lanes with the lights](show-editor.md#mixing-lanes-with-the-lights): ask for "fade the roof in over two bars" or
"speed the chase up into the chorus". A whole new show still builds up: a few lights in quiet parts,
more as the music builds, and every light together only for the biggest moments.

## Generate

**✨ Generate** in the Show panel opens **Generate a show**, which makes a first draft of the whole show
from the song.
Pick the **Colours** (any palette), a **Style** (Calm, Balanced or Lively) and a **Feel**, and it fills your lights
with effects that follow the song: soft, slow looks in quiet parts, faster ones that move on the beat
as it gets louder, every light moving together in the chorus, the same looks each time a section comes
back, and a change every few bars. Looks include fairy lights, waves, aurora, candlelight and falling
snow when it's quiet, theatre chases, juggling dots, dissolves, icicle drips, stacking blocks and rainbows
in the middle, and fireworks, ripples, lightning and strobes at the loudest. Each new
section crossfades in, lights that come on or go dark fade, and quiet starts and ends fade in and out.
With lights traced on the house photo, turn on **Sweep across the house as the music lifts** for a few
big moments across the whole house: a sweep as the first chorus comes in, a ring of colour as the last
one does, and a ring on the song's final crash. It's kept to those, at most three, so they stay
impressive. It runs **Detect** first if the song hasn't been analysed. It replaces the lights' effects, so Ctrl+Z brings them back; press
**↻ Try again** (beside **✨ Generate** once you've generated) for a different take with the same choices, then edit whatever you like. The colours start on the show's palette, or else the one for the time of year
(Halloween in October, Christmas in December…) when there is one.

**What can be heard.** For a song HA-liday Show has listened to (see [Split into parts](songs.md#split-into-parts)),
each part of the song leans towards looks that suit what's playing there: twinkles and fairy lights for
sleigh bells and chimes, slow washes of colour for a choir or strings, chases and strobes for guitar,
rainbows for a synthesiser. On **Surprise me**, the first take also follows how the song sounds (a
scary song gets a spooky feel, a happy one a playful feel); **Try again** picks any feel.

**Feel** is the kind of looks the show leans towards: **Playful** (bouncing, juggling, stacking
blocks), **Elegant** (slow gradients, comets, candlelight), **Rock'n'roll** (strobes, lightning, chases),
**Retro** (theatre chases, rainbows, lighthouse sweeps), **Spooky** (flicker, lightning, drips) or
**Dreamy** (aurora, waves, fairy lights, snow). **Surprise me** picks a different feel each time, and the
message under the toolbar says which it went for, such as "Generated a spooky show for 4 lights". Each take
also steers clear of the effects your last few other shows lean on, so your shows don't all look alike.
With the **AI**, it first decides one idea for the whole show, such as "a frosty night that thaws into a
party", keeps every part true to it, and tells you the idea when it's done.

**Following the drums and the words.** Once a song is [split into parts](songs.md#split-into-parts) and has
[lyrics](effects.md#lyrics-for-a-singing-face), Generate follows them as well as the beat, using each light's
[role](organising-lights.md#light-roles):

- In lively parts, a light whose role is the **Kick drum**, **Snare** or **Crash cymbals** plays
  **Drum hits**, flashing on that drum's real hits. A crash light flashes only where there are
  crashes, and plays a normal look elsewhere.
- A **Vocals** light plays **Words**, pulsing on each word as it's sung.
- A **Bass** light pumps with the music in the loudest parts.
- **Melody** lights carry the main look, and **Background** lights stay calm and steady.
- Quiet parts keep their calm looks on every light.
- Looks change where a lyric line starts rather than part way through one, and a part of the song
  whose lines come back is treated as a chorus, even if it isn't called one.

The **AI** gets all of this too: each light's role, the drum hits in each part of the song, the
lyrics, and what can be heard in each part and how the song sounds. A song without parts or lyrics generates as before.

**Anything else?** appears when **Made by** is the AI: tell it anything else about how this take should
look, such as "keep the pillars steady white, save the big colours for the last chorus, no strobes". It's
kept with the show, so it's there next time you generate. Notes for each part of the song still go on its
sections in the Music editor.

**Generating just part of a show:** **Fill** picks what to fill: **The whole song**, one of the song's
sections (such as **Chorus: 0:45 to 1:05**, on every light), **The play region** (the green stretch you
drag along the time ruler, on every light), or **The selection** when you've dragged across some lights
on the timeline. Only that stretch is replaced; everything before and after it, and
every other light, stays as it was. To go straight there, press **✨ Generate here…** beside the play
region's times in the **Playback** panel, or select a stretch and press it in the **Selection** panel. With **AI** as **Made by**, the AI makes that part only.

**Longest effect** sets how long one effect may run before the look changes: **2 bars**, **4 bars**
(to start with), **8 bars** or **Any length**. A bar is four beats, so 4 bars is about 8 seconds at
120 BPM. **Rules** keep to it; an effect from the **AI** that runs longer is cut at bar lines into
pieces, each in the next colours of your palette, so the look keeps changing.

**Build up** (on to start with) lights the house the way you would by hand rather than lighting
everything all the time. Quiet parts use only a few lights and leave the rest dark. Middling parts
start with about half and bring in another every few bars, starting afresh in each part of the song.
Only the loudest parts and the chorus use every light at once (in a song with neither, its loudest
part does), so every light gets its moment. A part of the song that comes back uses the same lights
each time, and the parts of a split light (like **Pillars · Left** and **Pillars · Right**) go on and
off together. A song that hasn't been analysed into parts fills every light. Turn it off to fill every
light all the way through. It works for the **AI** too.

Lights on **Whole light (one colour)**, and Home Assistant lights and switches, can only change a few times a second,
so Generate gives them looks that suit that: colour changes, fades and pulses of the whole light, still
blocks and slow gradients, never faster than once a beat. The AI is told the same, and the effect ideas
in the **Selection** panel follow suit for those lights.

With an AI set up (see [Setting up the AI](ai.md)), **Made by** picks who makes it:
**Rules** is instant, as above; **AI** sends the whole song to the AI with the same colours and style,
and it follows the **notes** you've written on the song's sections in the **Music editor** ("the guitar
solo, make it flash", "keep this bit dark"). It takes 10 to 60 seconds. Meanwhile a window headed **Generating** with your
show's name covers the editor with a spinner and the time so far, so nothing changes underneath it.
**Cancel** (or Esc, or Back on a phone) stops waiting and leaves the show as it was.

<!-- nav: made by tools/check_guide.py -->

---

← [Your shows](shows.md) · [Contents](README.md) · [The Show editor](show-editor.md) →
<!-- /nav -->
