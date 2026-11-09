<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Play it and playlists

[← Effects](effects.md) · [Contents](README.md) · [The public page →](public-page.md)

## 5. Play it

### Saving

**Save** stores the show and bakes every frame for playback (Play saves first if
needed). With **Auto save** on in the show's settings (the default), the show also saves itself a couple of seconds
after each change and when you switch shows; the note next to it says whether everything is saved.
A new show is saved once it has its first effect. Auto save waits while a show is playing.

When you've changed a show (or your lights) and press **▶ Play** with **Lights** on, it gets the
lights ready first, which can take a little while on a phone or for a long show. The button says what
it's doing meanwhile (**Preparing…**, then **Sending…** with how far it's got) and turns to
**⏸ Pause** once the show starts. A show you open again with nothing changed since starts straight
away: HA-liday Show remembers which lights it was last got ready for. Likewise **Edit** in **Library → Shows** says **Opening…** while the show's song
arrives.

Whenever something saves (a show, your lights, palettes, presets, playlists or the house photo), the
top right of the page lights up green for a few seconds, then settles to a small **✓ Saved** with the
time, so you can always see when something last saved. If a save fails, or something else goes wrong,
the message shows in red and stays until you press it, or until the same thing works again. A nudge
such as "Choose a song first" shows in orange and fades by itself.

### While you edit

The Playback panel chooses where the song plays. This is kept in your browser
and never changes where the real show plays:

- **Song in this browser**: the song plays in your browser and HA-liday Show streams the lights in
  sync. Turn off **Lights** to preview in the browser only. If the lights lead or lag, adjust
  **Light offset** under **Setup → Speakers**. The 🔊 slider next to the clock sets how loud the song
  plays in your browser. The **Music editor** shares the same level, and your browser remembers it.
- **Speaker: …**: HA-liday Show starts the song on that speaker and the lights with it, and the
  playhead follows along. Line the lights up with the speaker's **Delay ms** under **Setup →
  Speakers** (also shown under Timing there while that speaker is picked).

### The real show

**Show speaker** in **⚙ Show settings…** (Show panel) is where the song plays when the show is
started from an automation or the MQTT Play button. Leave it on **Default** to use the default show
speaker from the Speakers tab, or pick a speaker for this show only. So you can design on a speaker
indoors and the real show still plays outside. With no show speaker and no default, the lights play
on their own.

### Scenes

A scene sets every light at once, like a preset in WLED or a one-tap scene in a lights app, and
plays until you choose something else. Use one for the hours your lights are on between shows.

Your scenes are under **Library → Scenes**, and **Edit** opens one in the **Scene editor**. Each scene shows its colours, a **Basic** or **Advanced** pill (which editor it was made in) and what it plays, with **▶ Play** (or **■ Stop**
while it's on), **Edit**, and under **⋯**, **Rename…**, **Duplicate** (a copy called "… copy", ready to play
and not on the schedule) and **Remove…**.

- **+ New scene** takes three steps, like **+ New show**: its name, its colours, then **Basic** (a row
  per light, below) or **Advanced** (straight into the Show editor, further down). The palette starts on
  the season's, or the one you last used. Each light starts on a steady colour from it, one colour after
  another along your lights. Pick **None** and every light starts on a warm white instead. Either way it does something the moment you play it.
- **Palette**, above the lights, is the scene's palette, as a show has one. Any effect you pick for a
  light takes its colours, going round the palette from light to light, and the effect window shows
  every effect in them. That includes **WLED's own effect**, which then uses the WLED palette
  **\* Colors Only**, so the WLED draws in your colours. Change the palette and you're asked whether to
  recolour the lights already on. You can still set a light's own colours afterwards with its colour
  boxes or **Palette…**.
- In the editor, each light has its own row: its **Effect**, its **Colours** (a colour box for each,
  and **Palette…** to use one of your palettes), and **Speed**, **Brightness** and **Glitter** sliders
  (white sparkles over the effect; all the way left is none). A light on **WLED's own effect** has
  **Speed**, **Brightness** and **Intensity** instead, named on its row: its Speed and Intensity are the
  WLED's own sliders for that effect, and there's no Glitter, as it can't reach the WLED. Press the
  effect to change it: the same window as the Show editor's opens, with every effect moving in the
  light's own colours. Tick **Show presets** there to pick a preset; the effect then shows its name,
  such as **Three colours · Still blocks**. **Off** beside it turns the light off in this scene.
- A light split into parts plays one look across the whole light. Turn on **Each part on its own**
  under its name to give every part its own row instead, each starting on the light's look. A light set to play only as parts always
  has a row for each part.
- A light not split into parts can play a **Live music** effect that follows what a WLED with a
  microphone hears (see [Live music effects](#live-music-effects)). Its row then has **Follows** (and
  **Fills** or **Burst**) under the effect.
- A WLED light can play one of **WLED's own effects** instead: pick **WLED's own effect** under
  **On this WLED**, the blue box at the top of the effect window. A light split into parts offers it on its own row (with
  **Each part on its own** off), and the WLED plays it across all its segments. With **Each part on
  its own** on, each part made from the WLED's segments (with **Fetch segments**) can have its own:
  say Fire on Left and Twinkle on Right. Parts you drew yourself don't offer it. The **WLED effect** window
  then opens: every effect the WLED has, read from the light itself (so the light needs its IP address),
  each moving as the WLED draws it in the light's colours. Type in **Find a WLED effect** to narrow them
  down, and press one to pick it. To change it later, press its name (**Change…**) under **WLED's own
  effect**. The button under that, with a strip of colours, is the WLED's palette: press it to see every
  palette your WLED has as a strip of its colours, and pick one. **Default** shows the colours the effect
  uses when no palette is picked. Its colours,
  **Speed**, **Brightness** and **Intensity** go to the WLED too. When the scene starts, HA-liday Show
  tells the WLED to play that effect and sends it nothing else; your other lights play as usual. The
  **Preview** shows the effect moving as the WLED draws it, worked out with WLED's own code, for all of
  WLED's effects for a strip of lights (such as **Fire 2012**, **Pacifica**, **Twinklefox**, **Aurora**,
  **Noise 1** to **4**, **Bouncing Balls**, **Halloween Eyes** and **TV Simulator**). The 2D, sound-reactive
  and particle (**PS**) effects show a rough stand-in, their palette or colours drifting along the light,
  and the light's row says so. On the **Default** palette, some effects (such as **Fill Noise**) show a
  single colour, on the WLED as in the preview: pick a palette to see them properly. When it
  switches the WLED to an effect, HA-liday Show also has the WLED load that effect's own settings for
  its extra sliders and options (your speed, intensity, palette and colours still apply), so effects
  such as **Palette** and **Scanner** play as WLED intends; the preview uses the same settings.
  WLED's sound-reactive effects follow the WLED's own microphone, while **React to music**, the scenes'
  brightness, and House lane or group lane effects don't reach this light. When a show starts, the
  light is taken back as usual. When the scene stops, the WLED carries on with its effect (as a WLED
  goes back to its own effect after a show), so turn it off in WLED or Home Assistant if you want it
  dark. A WLED that doesn't answer just stays as it was. On a WLED you've added as a light per segment,
  only that light's segment plays the effect. Your other lights on the same WLED (and the light's
  other parts) can't get frames while it does (they'd stop the effect), so they show what WLED has set
  for their segments, unless you give them WLED's own effect too; their rows say so.
- **Same for every light** puts one row in charge of all your lights. Turn it off again and each
  light starts from that look, ready to change one at a time.
- The **Preview** shows the scene moving on your house photo. Changes save as you make them.
- **▶ Play on lights** plays it on your real lights, round and round. Change it while it plays and
  the lights follow.

**Advanced** (beside the scene's name) opens the scene in the **Show editor**, for a scene that changes
over time or runs across the house: effects can start and stop on the timeline, and the **House** lane
works as in a show. Each light's look becomes one effect across the whole timeline to start with.

- The banner under the Show panel's title has the scene's **Palette**, which works as a show's does:
  effects you add take its colours.
- The timeline is one time round. The banner says how long:
  **Goes round every** 20 seconds to start with, up to 10 minutes. Making it shorter cuts effects at the
  new end; dragging an effect past the end makes it longer.
- There's no song, so the song, beats, ✨ **Generate** and **⚙ Show settings…** are hidden, and
  **Loop** is on. **▶ Play** plays the scene on your lights from the playhead; **⏸ Pause** turns it off.
- It saves as you go, like a show. **← All scenes** goes back to the list, where **Edit** opens it in
  the Show editor again.
- On a WLED light's own lane, the effect window offers **WLED's own effect**, as in a Basic scene. A
  light split into parts offers it on its own lane, and its parts' effects then don't play. Each part
  made from the WLED's segments offers it on its own lane too. It always covers the whole loop and is that lane's only effect: picking it replaces the
  lane's other effects, and other effects can't go on that lane until you change or delete it. Its clip
  says **WLED:** and the effect's name, and the **Selection** panel picks the WLED's effect and palette.
  Transitions and Glitter do nothing on it, and it can't be copied to other lights or saved as a preset.
- **Switch to Basic** goes back to a row per light. It's only offered while nothing would be lost: each
  light with one effect across the whole loop, played on the whole light, and nothing on the House lane.

Scenes come on and off by themselves from the [Schedule](#schedule) tab. **When it plays** at the foot
of the Scene editor (or **Schedule…** in the banner for an Advanced scene) says what the schedule does
with the scene, with **+ Add to schedule** and **Open Schedule**. **Library → Scenes** says it too.

Scenes are also in Home Assistant, as a scene each and one light whose brightness dims them (see
[With MQTT](automations.md#with-mqtt)).

While a scene is on, starting a show or a playlist (from an editor, an automation, a schedule or a
visitor) takes the lights over. When it finishes, or you stop it, the scene comes back after a
couple of seconds, and its row says **Comes back after the show** meanwhile. To turn the lights off,
press **■ Stop** on the scene, or **Stop** while only the scene is playing. **Remove…** deletes a
scene for good, keeping a copy of all your data first under **Setup → Your data**.

Scenes are made for the lights you have when you edit them. If you add or change lights, open
HA-liday Show and scenes are made again for the new lights.

### Live music

**Setup → Live music** shows what a WLED light with a microphone hears: how loud it is, each
beat, and the bass, middle and treble. A scene with **React to music** switched on follows it (see
[React to music](#react-to-music) below).

A WLED hears music with a small microphone wired to its controller (an INMP441, say, on an ESP32 board),
with the **AudioReactive** usermod that most ESP32 builds of WLED 0.14 and later include. It doesn't
need to be one of your show lights: a small board by the speaker works well. To have it send what it
hears:

1. In that WLED's web page, open **Config → Usermods** (on some versions it's under **Config → Sync
   Interfaces**) and find **AudioReactive**.
2. Check the microphone is set up and the WLED's own sound effects react to music.
3. Under its sync settings, set **Mode** to **Send**, and leave the port at **11988**.

Within a few seconds it appears under **Listen to**. With more than one WLED sending, pick one, or leave it
on **Any WLED that sends sound** to use the loudest. **Counts as music from** sets how loud counts as music,
so chatter in the garden doesn't. A ⚠ note says if nothing is heard, or if a WLED sends in an older
format (update it to 0.14 or later).

It works on your home network only, and needs nothing from Home Assistant. If HA-liday Show can't listen
on UDP port 11988 (another program on the machine has it), the card says so. With Docker, keep the host
networking from `docker-compose.yml`, or the sound won't reach it; with pipx, let UDP port 11988 in
through your computer's firewall.

#### React to music

Any scene can follow the music. Open it, and under **Music** switch on **React to music** (for an Advanced
scene, press **React to music…** in the bar above the timeline). Then:

- **When it's quiet, down to** sets how dim the scene gets in the quiet parts. The louder the music, the
  brighter the scene, up to its normal brightness.
- **Flash on each beat** lifts every light towards white on every beat, the dark gaps too, dying away
  over a quarter of a second. **Flash strength** sets how far.
- **Strong bass plays** and **Strong treble plays** pick another of your scenes to switch to while the bass
  (or the treble) is loud and well above the other. It stays at least a second, so it doesn't flicker.
  Leave them on **None** to stay on this scene. Changes to those scenes show the next time this one
  starts.
- **Back to normal after** sets how many quiet seconds it waits, with the music stopped or no WLED heard,
  before gliding back to the plain scene at its normal brightness.

The card says whether a WLED is sending sound now. Which WLED it listens to, and how loud counts as
music, are set on the **Live music** card. A reacting scene plays like any other: from **▶ Play**, the
schedule, a playlist, Home Assistant's scene list, and after a show. **Scenes' brightness** (the
HA-liday Show light in Home Assistant) still sets how bright it is at its loudest. Your lights' limits
are the same as for shows.

#### Live music effects

A light in a scene can also play an effect that follows the music itself. Pick one from the **Live
music** group in its effect window: on a light's row in a Basic scene (a light not split into parts),
or on a light's lane in an Advanced scene, where, like **WLED's own effect**, it covers the whole loop as
the lane's only effect.

- **Level meter** fills the light with the level: **from the start**, **from the middle** or **from both
  ends** (pick under **Fills**), in its colours from the first to the last (a palette fills them).
- **Beat burst** plays a short burst on every beat the WLED hears: a **ripple** out from the middle, a
  **shockwave** along from the start, a **sparkle**, or a **flash** of the whole light. **Length** (in
  the Speed column of its row) sets how long each burst lasts, 0.2 to 2 seconds; between beats the
  light is dark. The level it follows
  sets how bright each burst is, never quite off.
- **Spectrum bars** shows the music from bass to treble: a bar for each part of the sound, side by side
  along a strip (each section filling along it) or up a matrix's columns (each rising from the bottom),
  up to 16 bars. It always shows every part of the sound, so it has no **Follows**.

**Follows** picks what it follows: **loudness**, **bass**, **mid** or **treble**. Give one light the bass
and another the treble, and they move to different parts of the music. With no music for a few seconds
(or no WLED heard), a live effect breathes gently in its colours instead, so the house never looks off.

While you edit, the preview follows what your WLED hears; with nothing sending, it follows a made-up
song so you can see it move. If **React to music** is on too, its brightness and beat flash work on top
(its strong bass and treble scenes don't change a light on a live effect). The idle glow breathes every
4 seconds, so in an Advanced scene keep **Goes round every** to a multiple of 4 seconds for a smooth loop.

### Playlists

To play several shows back to back, open **Library → Playlists**. Each playlist says how many shows it has, how
long it takes to play through once and when it plays, with **Edit**, **▶ Play**, and under **⋯**, **Rename…**, **Duplicate** (a copy called "… copy", not on the
schedule) and **Delete…**. Press
**+ New playlist**, or **Edit** one:

- **Building blocks**, at the left to start with, go between your shows (see below). Drag one in like a show.
- **Your shows**, below them, lists every show, in the same folders as **Library → Shows**: press a folder
  to go into it, and a name in the path above the list to go back up. Drag one by its card into
  **Running order** and let go where it should play; a blue line shows where it will land. Or press **+**
  to add it at the end. **Find a show** looks in every folder, and says which folder each match is in.
  The same show can go in more than once.
- In **Running order**, drag a show or block up or down to change when it plays, or drag it out of
  **Running order** (back to **Your shows**, say) to take it out. **↑**, **↓** and **✕** do the same with a press. On a phone or tablet, drag
  by the dots (⠿) at the left of a card, so the page still scrolls; there, **Running order** comes
  first and **Building blocks** starts folded.
- The coloured bar above the order shows one time through, each show and block as long as it plays,
  and next to **Running order** it says how long that takes.
- Type over the name at the top to rename the playlist. **Delete playlist** removes it but keeps its
  shows. **← All playlists** (or your browser's **Back**) goes back to **Library → Playlists**.

Changes save as you make them. A playlist holds up to 100 shows and 200 things in all, and you can
have up to 50 playlists.

**Building blocks** fill the time between shows. Each has its own length in **seconds** (up to an
hour), set on its card in **Running order**:

- **Pause**: your lights go back to how they normally look.
- **Colour**: every light shows one colour. Click the colour box on its card to pick it.
- **Off**: every light goes dark.
- **Effect**: an effect plays on every light, such as **Twinkle** or **Rainbow**. Press the effect's button
  (**Change…**) to open the same window as in the Show editor, with moving previews of each effect; tick
  **Show presets** for its ready-made settings, your own presets too. Its colours carry over when you
  change effect, and for effects with colours, **Colours…** picks them from your palettes. An effect longer than a minute repeats every
  minute or so, at a point where the join doesn't show.
- **Scene**: one of your [scenes](#scenes) plays, going round as it does on its own, at your scenes'
  brightness. Press **Change…** on the block's card to pick it: the window shows your scene folders, opening
  in the one the current scene is in, and **Find a scene** searches them all. It needs at least one scene, made in the **Scene** editor. If
  the scene is deleted later, the block says so and is skipped until you pick another.

Put a block wherever you like: between every show, only before the first, or several in a row (a
colour, then off for a moment, say). A playlist doesn't need any shows: one made only of scene blocks
plays your scenes in turn, on **Play** or on the schedule. Colour, Off and Effect blocks are got ready in your browser, like a show
when you save it: whenever HA-liday Show is open, and straight after you change a block or your
lights. A block that isn't ready yet (if you add lights and don't open HA-liday Show before the
playlist plays, say) is skipped. Playlists made before blocks have a **Pause** after each show,
as long as their old **Pause between shows**.

Press **▶ Play** and HA-liday Show plays the shows in order, then starts again from the top, until
you press **■ Stop**. It carries on with the page closed. A line at the top of **Library → Playlists**
and the Playlist editor says what's playing (a show or a block), which is also outlined in **Running order**. Each show plays on its own **Show speaker**, just as when an automation starts it.
Only saved shows play: a show you haven't saved yet, or have deleted, says so in the list and is
skipped. Playing a show from the editor, or stopping it, stops the playlist, and so does pausing or
stopping the song on the speaker.

#### Music with no speaker: the Show player

A show with no **Show speaker** (and no default one under **Setup → Speakers**) plays its lights only
when a playlist, its schedule or an automation starts it. Without Home Assistant, that's every show.
To hear the music too, use the **Show player**:

1. On a computer or tablet connected to your speakers, open the **Show player** link under
   the **Schedule** tab. Without Home Assistant, the address is `http://<HA-liday Show's address>:8099/player`.
2. Press **▶ Start the Show player** (browsers only play sound after a press on the page).
3. Leave it open. Each song plays there from the right point, and your lights follow it.

Keep that computer from going to sleep while your shows run. If the lights are ahead of the music,
make **Light offset** bigger; if they're behind, make it smaller. Shows you play from the editor, or
on a speaker, don't play in the Show player, so you never hear a song twice.

### Schedule

The **Schedule** tab is where playlists, shows and scenes play by themselves at set times, even with
the page closed. Each row is one thing it plays, then its times, days and dates.

- Press **+ Add to schedule**, then pick what it plays: a playlist, a show (it plays round and round
  for the whole time) or a scene. The window has a tab for each, and **Find by name** looks through all
  three. To change what a row plays, press its name. **+ Add to schedule** under **When it plays**, in the Playlist editor
  or the Scene editor, adds that playlist or scene.
- The same thing can be on the schedule more than once, such as your playlist 17:00 to 22:00 on
  weekdays and 16:00 to 23:00 at weekends.
- Untick **On** to pause a row without losing its times. **Delete** takes it off the schedule.
- A row whose playlist, show or scene you delete stays, greyed out, and is skipped.

Times work like this:

- **From** and **to** set the times, such as 17:00 to 22:00. An end time earlier than the start runs
  past midnight: 20:00 to 01:00 on a Saturday plays until 1 in the morning on Sunday.
- To start when it gets dark, change **From** to **sunset**. You can start up to 3 hours before or
  after it, such as 15 **minutes after**. Sunset moves through the year, so the row does too.
  An end time in the morning (before 12:00), such as 01:00, is the next morning. On an evening the sun
  sets after the end time (21:00 in midsummer, say), it doesn't play.
- Press the days it shouldn't play to turn them off.
- Turn on **Only between** to play just between two dates, such as 25 Oct and 31 Oct. They come round
  every year, and can run over New Year (1 Dec and 6 Jan).

Each row says when it next starts. At the start time a playlist or show starts, even if something else
is playing. At the end time the show that's on finishes, then it stops (a building block that's on
stops straight away), unless another row for the same thing carries straight on. If you press
**■ Stop**, pause the song on the speaker or play something else in between, it stays off until its
next start time. If HA-liday Show restarts during the scheduled time (after an update, say), it
starts again, and so does a row you turn on during its time. Changing the times while it plays
just moves when it stops.

A scene row puts the scene on at its start and off at its end. If a show or playlist is playing,
the scene waits for it to finish. If you turn it off, or put another scene on, before then, it's left
that way until its next start.

#### When times overlap

Playlists and shows take turns, and so do scenes; a scene can be on alongside a playlist or show.

- Where two playlists' or shows' times overlap, the row higher up the list plays first, and the
  other starts once it's finished. The same goes for two scenes. Drag ⠿ (or press **↑** and **↓**) to
  change the order.
- A playlist or show takes the lights over from a scene, and the scene comes back once it's finished.
  For example: **Candy cane** from sunset to midnight, and your show playlist from 18:00 to 20:00. The
  lights glow from sunset, the shows take over at six, the scene comes back once they've finished, and
  everything goes off at midnight.

#### The week

**Week**, under the list, shows what really plays when over seven days from today, a row per day.
Each row of the schedule is a bar in its own colour, with its name; a scene is the thin bar along the
bottom.

- Rows take turns, as the schedule really plays them: a row that has started plays until its end
  time, so another row due meanwhile waits, even if it's higher in the list. The time it waits is
  hatched in its colour, and it starts after the first one if its own time isn't over by then. A row
  whose whole time passes while another plays is only hatched: it doesn't get a turn that day. Where
  two rows are due at the same moment, the one higher in the list goes first.
- A scene's bar fades where it waits for a playlist or show to finish.
- Times that run past midnight carry on past **00:00** on the day they start, and sunset times move
  from day to day as they really do. A row that starts at sunset needs to know where you are (below).
- Rows switched off, and rows whose playlist, show or scene has been deleted, aren't shown.
- Hold the pointer over a bar for its times, and press it to find its row in the list. **‹** and **›**
  move a week at a time, and **From today** comes back.

#### Sunset and the clock

Sunset times are worked out for Home Assistant's location (**Settings → System → General** in Home
Assistant). Without Home Assistant, or to use another place, type your latitude and longitude in the
boxes at the bottom of the **Schedule** tab (they appear once a row starts at sunset), and press
**Save**. **Use Home Assistant's** goes back to Home Assistant's location. On Google Maps, right-click
your house and click the numbers at the top to copy them, then paste them into the first box. Sunset
is worked out to within a couple of minutes. The page shows today's sunset next to the clock.

The schedule goes by HA-liday Show's own clock, which the **Schedule** tab shows. The app uses Home
Assistant's time zone. With Docker, set `TZ` in `docker-compose.yml` to your time zone (such as
`Europe/London`); with Python, it uses your computer's clock.

Schedules you'd set on a playlist or scene before 0.2.233 were moved to the **Schedule** tab for you.

---

[← Effects](effects.md) · [Contents](README.md) · [The public page →](public-page.md)
