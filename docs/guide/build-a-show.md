<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Build a show

[← Your house](house.md) · [Contents](README.md) · [Effects →](effects.md)

## 4. Build a show

A show is a song plus effects on each light's track. The usual path is: pick a song, **Detect** its
beats and sections, then **Generate** a draft or **Describe it**, and fine-tune clips on the
timeline.

- **The song:** [Shows](#shows) · [Sharing shows](#sharing-shows) · [Songs](#songs) · [Samples](#samples) · [Editing a song](#editing-a-song) · [Drafts](#drafts) · [Layers](#layers) · [Mixer](#mixer-bass-mid-treble-and-tempo) · [Suggest cuts](#suggest-cuts) ·
  [Marks](#marks) ·
  [Detecting](#detecting-in-the-music-editor) · [Sections](#editing-sections) · [Beats](#beats)
- **Let it help:** [Suggestions](#suggestions) · [Describe it](#describe-it) · [Generate](#generate)
- **By hand:** [The timeline](#the-timeline) · [Adding effects](#adding-effects) ·
  [Editing a clip](#editing-a-clip) · [Transitions](#transitions) · [Settings that change over a clip](#settings-that-change-over-a-clip) · [Mixing lanes with the lights](#mixing-lanes-with-the-lights) · [Presets](#presets) · [Your own presets](#your-own-presets) ·
  [Copying](#copying) · [Colour palettes](#colour-palettes)
- **Odds and ends:** [Lights that are gone](#lights-that-are-gone) · [Working on one part](#working-on-one-part) ·
  [Undo](#undo) · [Shortcuts](#shortcuts)

### Shows

Your shows are under **Library → Shows**, and nothing changes in a show until you open it in the
**Show editor**. Each show is listed with its song, its length and when it last changed, newest first, and the
one you were last editing has a **Last edited** badge.

**Folders** sort your shows, and the same works in **Scenes**, **Playlists**, **Palettes** (your own)
and **Presets**: press **+ New folder** beside the **+ New …** button and name it, then pick it under
**Folder** on a row. Each folder folds away (press its name) and remembers whether you left it open;
what's in no folder is listed after them, under **Not in a folder** (presets there stay grouped by
effect). **Rename…** and **Delete…** are under each folder's **⋯**; deleting one leaves what was in it, just in no
folder. Folders only sort the list, and they're saved with your settings, so they're in **Export…** too.

- **Edit** a show to change it, or press **+ New show** to start one. A short window asks for:
  1. a **Name**, a **Song** (or **+ Add a song…**, or **No song, lights only** with its length) and a
     **Palette** (see [The show's palette](#the-shows-palette)). The name fills in from the song until
     you type your own, and each show needs its own name.
  2. with an AI set up, how it starts: **Start empty**, or **Generate with AI**, which needs a song
     and at least one light and shows the same choices as **✨ Generate** (in the show's palette: **Style**,
     **Build up**, **Longest effect** and, with lights traced on the house photo, the sweep across the
     house). Without an AI, the show starts empty straight after step 1. For a quick draft
     made by rules, press **✨ Generate** in the editor (see [Generate](#generate)).

  **Create show** (or **Create and generate**) saves it straight away; **Cancel** makes nothing.
- Each show's row has **Edit**, and **⋯** for the rest: **Duplicate**, **Rename**, **Share**, its
  **Folder** (once you have folders) and, last, **Remove…**. Rows elsewhere in the Library work the same
  way: their main button, then **⋯**.
- **Duplicate** makes a copy called "… copy", ready to play straight away.
- **Rename** lets you type a new name in the list; press Enter to keep it, or Escape to put it back.
  Each show needs its own name. An automation that starts the show by its name needs the new name.
- **Share** downloads the show as a file you can send to anyone with HA-liday Show (see [Sharing shows](#sharing-shows)).
- **Remove…** archives or deletes a show (see [Archiving and deleting](#archiving-and-deleting)).
- **← All shows**, at the start of the Show panel, takes you back to **Library → Shows**. Going to
  another tab instead keeps your show open, with **↩** at the top to come back to it (see
  [Finding your way](getting-started.md#finding-your-way)).

The Show panel shows the open show's name beside **← All shows**; to switch to another show, go back
to the list. **⚙ Show settings…** opens the show's settings: its **Name**, its **Palette** (below), its **Show speaker**
(below), **Brightness** (below), **Save automatically a couple of seconds after each change**, and **Remove show…** to archive or delete it.

#### The show's palette

Each show can have its own palette, picked in the **New show** window and changed in **⚙ Show
settings…**. Effects you add take its colours, and the effect chooser previews every effect in them.
The palette picker under a clip's colours starts on it too; picking another palette there is just for
colouring that clip. Change the show's palette later and you're asked whether to recolour the effects
already in the show; say no and only new effects use it. **None** keeps each effect's own colours, as
shows made before this had. If you change the colours of one of your palettes, shows using it follow;
if you delete or rename it, they keep the colours it had (the open show follows a rename).

**Brightness** in **⚙ Show settings…** dims this show without changing any of its effects:

- **Whole show** dims every light in the show.
- **Each light in this show** has its own slider, so you can bring down one light that's too bright
  next to the others. A light split into parts is dimmed as one.

The two work together with each effect's own **Brightness %** on the timeline, and with each light's
brightness under **Setup → Devices**, which applies to every show. For example, a show at 50% with a
light at 50% plays that light at a quarter. The preview and the house photo show the result as you
drag. Shows you made before keep playing at 100%.

### Sharing shows

You can swap shows with friends, or post one on a forum, without either of you changing your lights.

- **Share** on a show's row downloads a small file ending in `.halidayshow`. It holds the show's effects,
  its beats and sections, its **Brightness** levels from **⚙ Show settings…**, the song's name and length,
  and a short description of each light it uses
  (its name, what kind of light it is, how many segments and parts it has, and roughly where it is on
  your house photo). It doesn't hold the song, your house photo, IP addresses or any settings. Lights
  with no effects in the show are left out.
- **Import show…**, beside **+ New show**, asks for a `.halidayshow` file, then opens a short window.
  It always makes a new show, so nothing you already have changes.
  1. **Name and song.** Songs aren't shared, so pick your own copy. The song with the closest name is
     picked for you. If your copy is a different length, a ⚠ says so: the show still imports, and you
     can move effects in the editor afterwards. You can also pick **No song for now** and add it later.
  2. **Match your lights.** Each light in the show has a row, with a small map of where it was on their
     house. Pick which of your lights plays it. Your lights are suggested for you, most alike first,
     and each suggestion says why, such as "✓ Suggested: same model, 3 parts each". A light that isn't
     much like any of yours starts on **Leave it out**, and its effects don't come across.
     - Effects stretch to fit your light, however many bulbs it has.
     - A light with parts shows a **Parts** box, so you can pick which of your light's parts plays each
       of theirs, or **Whole light**.
     - Two of their lights can play on one of yours: the picker says "(also playing …)". Where both
       have an effect at the same time, the one that started later shows.
     - Effects across the whole house, on the **House** lane, always come along.
     - **▶ Preview on your house** plays the show on your house photo, with the pairings as they are
       now and your song in this browser, so you can see it before you import it. Change a pairing
       while it plays and the preview follows. Nothing is sent to your lights, and nothing is saved.
       Press **■ Stop preview** to stop it. It needs your lights on the house photo
       (**Setup → House**).

  The show's **Brightness** comes along: the whole-show level as it was, and each light's level on
  the light of yours that plays it. Where two of their lights play on one of yours, the brighter level
  is used. You can change them afterwards in **⚙ Show settings…**. A show shared from an older
  HA-liday Show, before brightness, imports at 100%.

  **Import show** saves it and opens it in the editor. Effects a light can't show are marked as usual
  (see [Effects a light can't show](#effects-a-light-cant-show)).

### Songs

The Song panel shows the show's song with its length, tempo and sections. Press
**Change…** to pick another from your Home Assistant **media** folder, or **+ Add a song…** (MP3,
M4A, AAC, OGG, Opus, WAV, FLAC or WebM; see below). Songs you add go to `/media/haliday_show/` so media
players can play them. For a lights-only show, choose **No song, lights only** and set its **Length with no song**.

**Library → Songs** lists every song in your media folder: its length, what **Detect** found (its
tempo and sections) or "not detected yet", and which shows use it. Type in **Find** to narrow the
list by name, folder or show. **Edit** opens a song in the **Music editor**, and **Remove…** archives
or deletes one. The song you last opened in the Music editor has a **Last edited** badge.

Each song you added is one card, marked **Original**. Inside it, under **Edits of this song**:

- **✂ Edit · song file** (purple): a song file made in the Music editor from this song, with its length,
  the shows that use it and the [draft](#drafts) it was made from. **Edit draft** reopens that draft. Under **⋯**:
  **Rename…** renames the song file (shows, drafts and folders that use it follow), **Duplicate**
  makes a new draft from its draft, to take another way and make its own file, and **Remove…** archives
  or deletes the file (the draft stays). An edit of an edit sits under the first
  song. Edits made before drafts existed (named "… (edit)") are found by their name; **Edit** on one
  starts a new draft.
- **✎ Draft · no file yet** (amber, dashed): a draft that hasn't made a song file, so shows can't use
  it yet. **Edit** it, or under **⋯**, **Rename…**, **Duplicate** or **Delete…** it.
- Songs in HA-liday Show's own folder have **Rename…** and **Duplicate** (a copy of the file,
  "… copy") under **⋯** too. Renaming one while it's open in
  the Music editor isn't allowed: press **← All songs** there first.

**All**, **Originals**, **Edits** and **Drafts**, beside **Find**, show just those, and the count says
how many songs, edits and drafts there are.

**Folders** sort your songs, such as **Christmas**, **Halloween** or **Party**. Press **+ New folder**
under the list and name it, then pick it under **Folder** on a song; the song's edits and drafts go
with it. Each folder folds away (press its name), and remembers whether you left it open; songs in no
folder are listed after them, under **Not in a folder**. **Rename…** and **Delete…** are under each
folder's **⋯**; deleting one leaves its songs, just in no folder. Folders only sort the list: the song files
stay where they are, so shows and speakers still find them. They're saved with your settings, so
they're in **Export…** too.

**+ Add a song**, under the list, opens a short window:

1. **Choose a file…** and give it a **Name**. It's saved under that name in `/media/haliday_show/`; if
   a song there already has it, the window asks for another, so nothing is replaced by mistake.
2. How to get it ready, then press **Add song**:
   - **Detect, then let the AI name the parts** (picked to start with when an AI is set up): finds its
     tempo, beats and parts, then the AI names the parts and writes their notes a little later (see
     the section notes under [Detecting in the Music editor](#detecting-in-the-music-editor)).
   - **Detect only** (picked to start with without an AI): the same, with the simple notes.
   - **Add it as it is**: leaves it for later (**Detect** in the Music editor).

   Detected songs are ready to use: a show that picks one gets its beats and parts straight away.

The same window opens from **+ Add a song…** in the **New show** window and in a show's **Choose a
song** window, and the song comes back picked.

Songs of any size up to 200 MB can be added. Home Assistant won't pass on more than 16 MB at once, so
a bigger song goes up in pieces, with the window showing how far it's got. Long shows on lots of
bulbs are saved in pieces the same way. If something goes wrong
while a window is open, the message shows inside the window as well as at the top.

### Archiving and deleting

**Remove…**, on a show or a song, opens a window that says where it's used and offers two ways to
take it away:

- **Archive** keeps it, out of the way. Archived shows and songs are listed, folded, under **Archived
  shows** and **Archived songs** at the foot of each list, and **Restore** brings one back.
- **Delete for good…** removes it, after asking you once more. Before it does, HA-liday Show keeps a copy
  of your shows and settings under **Setup → Settings → Your data** (*Before deleting*). A deleted song
  file itself can't be brought back.

**Shows.** An archived show is skipped by playlists (they show it as *archived*) and can't be started
by an automation, and comes back to the same places in its playlists when you restore it. If another
show has taken its name meanwhile, it comes back as "… (restored)". Deleting a show for good also
takes it out of its playlists. Archived shows are included in **Export…**. A show that's playing when
you archive or delete it plays to the end; a playlist skips it from then on. An archived show can't be
edited from another browser that still has it open until you restore it.

**Songs.** Only songs in HA-liday Show's own folder (`haliday_show` in your media folder, where uploads
and the Music editor's saves go) can be archived or deleted here, as the rest of your media folder
may belong to other apps; **Remove…** is greyed out for the others. If shows use the song, choose what
they play instead: **Another song**, or **No song for now** (they keep their effects and beats, and
play the lights only). An archived song moves to an **Archived** folder inside HA-liday Show's
folder, where it's out of HA-liday Show's song lists but still in Home Assistant's Media. Restoring it
puts it back and gives it back to the shows that were left without a song.

### Samples

**Library → Samples** keeps short sounds, such as sleigh bells, a "ho ho ho" or a voice saying "Merry
Christmas", ready to layer over a song in the Music editor. There are two ways to make one:

- **From a song:** in the Music editor, select the stretch you want and press **Save as sample…** (in
  the **Edit** panel), then give it a name. It's saved as it sounds in your edit, layers and all.
- **From a file:** press **+ Add a sample** and pick one or more files (the same kinds as songs).

They go in a **Samples** folder inside `/media/haliday_show/`, kept out of **Library → Songs** and a show's
song list so those stay tidy. Use them on a [layer](#layers) in the Music editor. Each sample has **▶** to hear it (press **■** to stop), and under **⋯**, **Rename…**, **Duplicate**
(a copy, "… copy") and **Delete…** to remove it for good. Layers that use a renamed sample follow it.

To sort them, press **+ New folder** and give it a name, then pick the folder under **Folder** on each
sample (or pick **New folder…** there). A folder's title folds it away, and **Rename…** and
**Delete…** are under its **⋯**; deleting a folder keeps its samples, which move to **Not in a folder**. The
files themselves stay where they are, so songs that use them still find them. In the Music editor, a
layer's **+ Add a clip** list shows the samples under their folders.

### Editing a song

The **Music editor** cuts, shortens and splices songs before you build a show. Press **Edit** on a
song under **Library → Songs** (with **+ Add a song**) to open it; nothing is touched until you do. The open
song's name sits beside **← All songs**, which goes back to the list to open another. The song you open is never changed: your
first change starts a [draft](#drafts), kept as you go, which you make into a new song file when you're
happy. Drag across the waveform to select (clicking moves the playhead and keeps the selection; press **✕**
next to its times or Esc to clear it), then **Cut selection** to remove it or
**Keep only selection** to shorten the song to it, or let **✂ Suggest cuts…** find the cuts for you (see
[Suggest cuts](#suggest-cuts)). **Insert at playhead** and **Add to end** splice in
another song, which is then selected so you can trim it. Joins blend over the **Crossfade at joins**
time (a few hundredths of a second hides the click, a few seconds blends one song into the next), and
**Fade in** and **Fade out** soften the ends. Zoom with the wheel, or type the selection's times for
precision. **⏮** goes back to the start, and **⏪** and **⏩** go back or on a bar (5 seconds before the song
is detected), carrying on playing if it was. The 🔊 slider by the clock sets how loud it plays in your browser. Once the song is detected, selection edges snap to bars
(hold Shift to place them freely), clicking a section in the lane selects exactly its stretch (Shift-click
adds the next), and **Preview cut** plays the join before you cut, with the playhead jumping over the selection as the cut would. Beats and sections follow your edits
and are kept when you make the song file. Edit the song before placing clips, because cutting it
afterwards won't move them.

Each join shows as a dashed line with a **✂** at the top. Click the **✂** to hear a few seconds either
side of the join; the **Selection** panel says what was cut there (how much, and from where in the
song). To change that cut, press **Adjust cut**: the part comes back and is selected, so drag its edges
(or type the times) and press **Cut selection** again. **Put back** undoes just that cut, leaving the
others as they are. Both are one step for **Undo**. A join where another song was spliced in only has
**▶ Hear join**. When you zoom out, the beat lines thin out to every bar, then every 2nd or 4th bar, so
the music stays visible; zoom in to see every beat.

You can also use the keyboard: press Tab until the waveform is outlined, then **←** and **→** move the
playhead a beat at a time (a second at a time before **Detect**), and holding Shift selects as you go.
Space plays, Home goes back to the start, , and . go back or on a bar, Delete cuts the selection, M adds a
[mark](#marks), Ctrl+Z undoes and Ctrl+S makes the song file.

#### Drafts

An edit is kept as a **draft**: a note of which parts of which songs it uses, with its crossfade and
fades, but no audio of its own. Your first change to a song (a cut, a splice, a crossfade or a fade)
starts one, named after the song, such as "sample-song (edit)"; type a better name under **Draft** at
the top. **Draft kept** beside it says it's saved, which happens a moment after every change, so you
can close the page or carry on from another device. If a change can't be kept (HA-liday Show stopped,
say), the status bar says so, even for a draft you've moved on from, and it's tried again with your
next change; closing the page then asks first. A song can have several drafts, such as a "Short
version" and a "Party mix": press **Edit** on the song again to start another.

**Library → Songs** lists each song's drafts inside its card (see [Songs](#songs)): as **✎ Draft · no
file yet** until a song file has been made from it, then with that file as **✂ Edit · song file**.
**Edit** (or **Edit draft**) carries on where you left off (**Undo** starts afresh each visit),
**Rename…** renames it, and **Delete…** deletes the draft (not the song, or any file it made).

**Make song file** (Ctrl+S) writes the draft as a WAV in `/media/haliday_show/`, named after the draft,
so every speaker can play it; pick it under **Song** in a show. Its beats, sections and marks go with it.
The draft stays open, so you can keep changing it. Making it again asks whether to **Replace it** (the
same file, so shows and playlists using it get the new version; the window lists those shows, since
their effects don't move with the music, and any other drafts that splice that file in, which will play
the new version too) or **Make a new file** (such as "Short version 2.wav"). Making a
song file without changing anything is a quick way to get a WAV copy of a song.

**Even out the volume**, beside **Make song file** and on unless you turn it off, turns the new file up
or down so it plays at about the same loudness as other songs made here, the level most streaming
services play at. That way one song doesn't blast out after a quiet one in a playlist. Only the overall
level changes, and a song is never turned up so far that its loudest moments would distort, so a very
spiky one may stay a little quieter. The status bar says how much it was turned up or down. The switch
is remembered in this browser.

Songs you edited before drafts existed are ordinary songs: press **Edit** on one to start a draft from
it. A draft can't be opened if a song it uses has been archived or deleted; restore the song first
(under **Archived songs**). Until then, drafts whose song has gone are listed together at the end of
**Library → Songs**, under **Drafts of songs that aren't here any more**, so you can still delete them.

#### Layers

Layers play samples or other songs on top of the song: sleigh bells over the intro, a "ho ho ho" on the
last chorus, a voice saying "Merry Christmas", or another song fading in under the end.

1. Under the waveform, in the **Mixer**, press **+ Add layer** (up to four). Its row has a name, a
   **Volume**, **EQ** (see [Mixer](#mixer-bass-mid-treble-and-tempo)), **Quieten the song**, **Match
   tempo** and **Remove**, and a lane appears under the waveform for its clips.
2. Put the playhead where you want a clip to start, then pick a sample or song from **+ Add a clip at
   the playhead…** on the layer's row. It starts a little quieter than the song, so it sits in the mix;
   change that with the clip's **Volume**.
3. Drag a clip to move it (it snaps to bars, beats and marks; hold Shift to place it freely). Drag its
   left or right end to trim it. Click a clip to pick it (the playhead goes where you clicked): its panel
   has **Volume**, **Fade in**, **Fade out**, **▶ Hear it**, **✂ Split at playhead** (or press S) and
   **Delete** (or press Delete). Each clip shows its own waveform and, once its song has been detected,
   its sections in their colours, so you can see where its chorus or drop is. To use just parts of a
   song on a layer, split it where each part starts and ends, delete what you don't want and drag the
   rest where it goes.
4. To make a layer stand out, such as a voice saying "Merry Christmas", tick **Quieten the song** on its
   row. The song dips a little while that layer's clips play (starting just before each one) and comes
   back up gently after. It's off for new layers.

Each clip is pinned to the moment in the song it starts at, so it moves with your cuts: cut a bit
earlier in the song and it moves earlier with the music; cut the part it sits on and it's left out
(**Undo** or **Put back** brings it back). A new clip is trimmed to the song's end. One that runs past it (after a cut, say) stops there, and
its end sits at the song's end so you can drag it in.
If you delete a sample a draft uses, its clips show greyed out and silent until you delete them or add
the sample back. Layers are part of the draft and every change is one
**Undo** step. **Make song file** mixes the layers into the new file, keeping the mix from
distorting where they pile up. The waveform, **Detect** and **Suggest cuts** go by the song alone, and a
sample saved with **Save as sample…** includes the layers.

#### Mixer: bass, mid, treble and tempo

The **Mixer** under the waveform works like a DJ's, for mash-ups and for making a layer sit well with
the song. The song has a row, and so does each layer.

- **EQ** opens that row's **Bass**, **Mid** and **Treble** faders in the **Selection** panel (press it again,
  or **✕**, to close them; another row's **EQ** swaps to its faders). Each goes from +6 dB down to **off**
  at the bottom: take the bass out of the song while a layer's bass carries it, say, or the treble off a
  layer so it sits behind. The **EQ** button is highlighted when anything is changed.
- **Changes partway through:** put the playhead where it should change, press **+ Change here**, then
  move the faders. From there the sound glides to the new settings over **Glide** seconds (1 by
  default; 0 for an instant switch). The faders always show, and change, the setting at the playhead:
  before the first change that's the row's own setting. A change shows as a small diamond: the song's
  along the bottom of the waveform, a layer's in its lane. Click one to put the playhead on it, drag it
  to move it, and press **Delete change** (or Delete) to remove it. Changes move with your cuts, like
  clips.
- **Match tempo** on a layer speeds up or slows down its clips to the song's tempo, keeping their pitch,
  so a loop or another song stays in time. The song needs **Detect** first, for its tempo. Each clip's
  own tempo is taken from its beats if it's been detected, or found when it's added (a clip needs a few
  seconds of steady beat). If it's wrong or missing, click the clip and type it under **Tempo**. A clip is
  never stretched more than about 1.4 times either way: one at half or double the song's tempo plays
  in time at about its own speed. Line the clip's first beat up with a bar (clips snap to them).

All of it is part of the draft, every change is one **Undo** step, and **Make song file** includes it.
The waveform still shows the song as it was, without the mixer.

#### Suggest cuts

**Suggest cuts** finds places to make the song, or one section of it, shorter without the join being
heard: for when the intro goes on too long, say, or the song is longer than your show needs. It works
in whole bars, so the song needs to be detected first (**Detect**).

1. Press **✂ Suggest cuts…** in the **Edit** panel, or pick a section in the lane and press **✂ Shorten…**.
   A window opens, set to the section you've picked (or **the whole song** if you haven't picked one).
2. Under **Shorten**, choose **the whole song** or a section. Under **To about**, type how long you'd
   like it, as 1:30 or 90. It starts at half the section, or three quarters of the song, and shows how
   long it is now.
3. Press **Find cuts →** (or Enter). You get up to three options.
4. Press a cut's **▶** to hear a few seconds either side of its join. What it would take out shows in
   red on the waveform.
5. Press **Use** on the one you like. The cut is made and the window closes. **Undo** in the **Edit**
   panel (or Ctrl+Z) takes it back. To try another length instead, press **← Back**.

It only takes out whole bars, in 4- or 8-bar phrases where it can, and only where the music either side
of the join matches, such as a loop that repeats or a verse and chorus that come round again. For the
whole song, an option can be several cuts, taken from parts that are heard again elsewhere, and it never
cuts off the ending (use **Fade out** for that). Each option says how many bars go, how much shorter it
makes things, and how well its join matches: **smooth join**, **good join** or **join may be heard**.
If nothing fits, it says so; try a length a little longer or shorter.

With an [AI set up](editor-and-settings.md#setting-up-the-ai), it's also asked which option works best musically. The
options show straight away, so you can listen while it thinks. When it answers, the one it thinks
works best is marked **AI's pick** and each gets a short reason under it (such as "Drops the repeated
second verse; keeps the 1:12 crash"); they stay where they are, so nothing moves as you reach for
**Use**. It asks once each time you press **Find cuts →** (and only when there's more than one option),
which counts as one AI request. It goes by the song's name (it may know the song), your section names and notes
(the ones you wrote count most) and your [marks](#marks), so it steers away from cutting a moment you've
marked. It can't hear the song, so listen to the joins yourself. If it can't answer, the options are
still there, without its pick.

Nothing changes until you press **Use**, and the song you opened is never changed: a cut you use goes
into your [draft](#drafts), and **Make song file** turns it into a new song file.

### Marks

Marks flag moments in a song you want to light, such as a big hit, the bells coming in or the last
note. They're kept with the song, so every show that uses it gets them, and they don't change when you
**Detect** again.

- **Add one:** in the Music editor, put the playhead where you want it and press **⚑ Add mark** (in the
  **Beats and sections** panel), or press **M**. **M** works while the song plays, so you can tap
  it along with the music and name the marks afterwards. You don't need to **Detect** the song first.
- **Name, colour or delete it:** click its flag in the beat lane (the playhead jumps to it), and change it
  in the **Selection** panel. Type a
  **Name**, pick a **Colour**, or press **Delete**. **Move to playhead** moves it to where the playhead is,
  and **✕** or Esc closes it. Each new mark takes the colour you picked last.
- **Move it:** drag its flag. It snaps to beats and bars; hold Shift to place it freely.

In the **Show editor**, a song's marks show as coloured flags on the **Beats** lane, with a line down
through every light, and clips snap to them (when **Snap** is on) so you can line an effect up with
the moment. They're read from the song each time you open the Show editor, so marks you add in the
Music editor show straight away. To change them, go back to the Music editor.

Marks follow your cuts: a mark in a part you cut out disappears from the edit, and the rest move with
the music and go with the song file when you **Make song file**. You can add, change and move marks while you're
editing too. They're saved on the song you opened as well, at the same moment in it, and that song keeps
all its marks, even ones in parts you cut out of the edit. A song spliced in brings its own marks,
shown faintly with a dashed line; they go with the song file too, but you change them on that song
itself. The one place you can't add a mark until you've made the song file is a part spliced in.

### Detecting in the Music editor

**Detect** in the Music editor finds a song's beats, bars and sections and keeps them with the song file,
drawn over its waveform. A song file you make from a draft keeps the beats and sections that followed
your cuts. A song spliced in brings its own beats, sections (with their names and notes) and marks, so
nothing is lost. Only if a song in it hasn't been detected yet is the new file detected afresh (the
marks still go with it). When a show picks that song
under **Song**, it takes them automatically (asking first if the show already has beats), and **From
song** in the Beats panel brings them back later. Detect in the editor also saves its results with the
song. Each show keeps its own copy, so moving beats in one show doesn't change the song or other shows.

### Editing sections

In the Music editor, the lane above the waveform shows each section in its colour.
Click one to change it in the **Selection** panel: rename it or pick its colour (every section with the same name changes colour together),
**✂ Shorten…** it (see [Suggest cuts](#suggest-cuts)),
**Split at playhead**, **Merge with next** or **Delete** it, and drag the line between two sections to
move it. Changes save with the song; a show that already uses the song picks them up with **From song**.
Give a section **Notes** to tell **Describe it** what happens there or how you'd like it lit, such as
"bells only, very gentle" or "big drop at the end, everything flashes"; the AI follows them.

You don't have to write them all yourself. **Detect** writes notes for every section, and **✨ Describe
sections** writes them again for the sections as they are now (after you've split or moved them,
say). It listens to each section and notes how loud it is, whether it builds up or fades, whether it's
busy or sparse, bass-heavy or bright, any big hits or moments it goes quiet (with their times), and
which earlier section it's like. It then suggests how to light it, for example: "Loud, busy, lots of
hits; builds up through it; big hit at 0:42. Everything on, moving and flashing on the beat; flash
everything on the hit." Notes you've typed or changed are never replaced, and nor are names you've
given sections: pressing **Detect** again carries them over to the new section that covers the same
stretch of the song. Edit anything it writes; once you do, it's yours.

With an AI set up (see [Setting up the AI](editor-and-settings.md#setting-up-the-ai)), the AI then rewrites those notes,
usually within a minute, while you carry on. It can't hear the song, so it works from the same
measurements and the song's name. If it knows the song, it uses what it knows: which part is the verse
or the chorus, where it builds. It also gives the sections Detect named itself better names, such as
**Part B** becoming **Verse**, but never a name you gave. If you edit the sections before it's done,
its notes aren't used, so press **✨ Describe sections** to ask again. Without an AI, or if it can't
answer, the simpler notes stay.

### Beats

Press **Detect** to have the editor listen to the song and find its tempo, every beat,
where each bar starts (drawn as stronger markers) and its sections, which show as tinted, named bands
behind the waveform (Intro, Verse, Chorus, Bridge, Outro). It runs in your browser in a few seconds,
with nothing sent anywhere. Detection reads songs as 4/4 and prefers a lively tempo, so a slow ballad
may come out at double time; type the BPM you want and press **Fill** if so. You can also press **B**
(or **Tap beat**) in time with the music while it plays, type a **BPM** and press **Fill** to add beats
from the playhead, or click the beat lane to add or remove one. **Clear** removes the beats and
sections. With **Snap** on, clips and selections snap to beats and to each other; hold Shift to
place freely.

### Suggestions

Once the song has been analysed, **＋ Add effect…** on a selection starts with looks
suggested for that part of the song: soft ones for a quiet verse, fast ones that move on the beat for
a loud chorus, with speeds set from the tempo and colours from the palette picked in the palette bar.

### Describe it

Type what you'd like in the **Describe it** panel and press **✨ Create**, for example
"red and green chase on the roof in every chorus, gentle white twinkle on the tree the rest of the time"
or "strobe everything on the last four bars". An AI turns it into effects on the lights you name, lined
up with the beats and sections, and they replace what those lights had at those times. If you select a
stretch first and the request doesn't say where or when, it works on the selection. Anything the AI gets
wrong (a light or effect that doesn't exist) is left out and listed in the status bar, and Ctrl+Z undoes
the lot. It needs an AI to be set up first; see [Setting up the AI](editor-and-settings.md#setting-up-the-ai).

The AI knows every effect and what it looks like, and can also use
[transitions](#transitions), [settings that change over a clip](#settings-that-change-over-a-clip) and
[mixing lanes with the lights](#mixing-lanes-with-the-lights): ask for "fade the roof in over two bars" or
"speed the chase up into the chorus". A whole new show still builds up: a few lights in quiet parts,
more as the music builds, and every light together only for the biggest moments.

### Generate

**✨ Generate** in the Show panel opens **Generate a show**, which makes a first draft of the whole show
from the song.
Pick the **Colours** (any palette) and a **Style** (Calm, Balanced or Lively), and it fills your lights
with effects that follow the song: soft, slow looks in quiet parts, faster ones that move on the beat
as it gets louder, every light moving together in the chorus, the same looks each time a section comes
back, and a change every few bars. Looks include fairy lights, waves and aurora when it's quiet, theatre
chases, juggling dots and dissolves in the middle, and fireworks and ripples at the loudest. Each new
section crossfades in, lights that come on or go dark fade, and quiet starts and ends fade in and out.
With lights traced on the house photo, turn on **Sweep across the house as the music lifts** for a sweep
from one side to the other as the music lifts, and a ring of colour across the house when every light
comes in together. It runs **Detect** first if the song hasn't been analysed. It replaces the lights' effects, so Ctrl+Z brings them back; press it again for a
different take, then edit whatever you like. The colours start on the show's palette, or else the one for the time of year
(Halloween in October, Christmas in December…) when there is one.

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

With an AI set up (see [Setting up the AI](editor-and-settings.md#setting-up-the-ai)), **Made by** picks who makes it:
**Rules** is instant, as above; **AI** sends the whole song to the AI with the same colours and style,
and it follows the **notes** you've written on the song's sections in the **Music editor** ("the guitar
solo, make it flash", "keep this bit dark"). It takes 10 to 60 seconds. Meanwhile a window headed **Generating** with your
show's name covers the editor with a spinner and the time so far, so nothing changes underneath it.
**Cancel** (or Esc, or Back on a phone) stops waiting and leaves the show as it was.

### The timeline

Each light has a track, with the **House** lane at the top. The timeline is never taller than
your screen: with lots of lights it scrolls them inside itself, and the times, song and beats stay at
the top. Scroll through the lights with the mouse wheel over their names (or drag the scroll bar), and
along the song with the wheel over the tracks; zoom with the **−** and **+** buttons in the Timeline panel, the + and − keys, or
Ctrl+wheel (or a trackpad pinch) around the pointer. Click the ruler to move the playhead. The **▸**
before **House** folds the [group lanes](effects.md#group-lanes) away, and the one before a split light's name
folds its parts (see [The whole light as one](lights.md#the-whole-light-as-one)); **▾** brings them back.

### Adding effects

Drag across a light's track to select a stretch of time (drag up or down to
cover several lights; a plain click selects up to the next beat; hold **Alt** to start a selection
on top of an existing clip). Press **＋ Add effect…** in the Selection panel to open the effect
chooser: a button for every effect, each with a strip playing it on that light for the selection's
length, so you can see it first. Click one to add it (Esc or ✕ closes it without adding). The last
effect you added also gets an **Add … again** button, for laying down a run of the same thing. With
the House lane and lights selected together, the chooser has a section for each. To clear a stretch,
select it and press **Delete effects here** or the Delete key: effects inside it are removed and
ones crossing its edges are trimmed.

### Editing a clip

Click a clip to select it. Drag it to move it (onto another light too), drag
its edges to resize it, and change its effect, colours and settings in the Selection panel. While a
clip is selected it loops on its own in a strip at the top of its settings, so changes show
straight away. To swap the effect, press **Change…** beside **Effect**: it opens the same effect
chooser used to add one, playing on that light for the clip's length, with the current effect
outlined. Changing effect keeps the clip's colours, brightness and transitions.

### Transitions

Under **Transitions** in the Selection panel, a clip can come **In** and go **Out** gently rather than
switching on and off. Pick how, and how many seconds it takes:

- **Fade**: the whole light at once.
- **Wipe** and **Wipe back**: along the light from one end or the other.
- **From the middle**: spreading out from the middle of the light.
- **Dissolve**: bulbs switching one by one in a random order.

When two clips are back to back on one light, the transition is a crossfade: the old look turns into
the new one with no dark gap. Use the second clip's **In** (or, if it has none, the first clip's
**Out**). On the House lane and group lanes, a clip fades in and out over the lights' own effects.
The timeline shows each transition on its clip.

### Mixing lanes with the lights

A clip on the House lane or a group lane covers the lights' own effects by default. Under **Clip**,
**Lights' own effects** changes how it mixes with them:

- **Cover them**: the lane's colours replace the lights' own (as before).
- **Add to them**: both together, so a sweep of white brightens a red chase as it passes.
- **Brighter of the two**: whichever is brighter on each bulb.
- **Only where they're lit**: the lane's colours show only where a light's own effect is lit, at its
  brightness. A rainbow wave over a chase gives a chase in rainbow colours.

### Settings that change over a clip

Any number setting (a speed, a size, how many, brightness) can change over the length of a clip,
like xLights' value curves. Turn on **Changes** under the setting, give the value it should reach,
and pick how it gets there: **Steady**, **Ease in** (slow at first), **Ease out** (slow at the end)
or **Up and back** (to the new value halfway, then back again). For example, make a chase speed up
into the chorus, or let brightness swell and fade. A speed that changes moves smoothly from one
speed to the next, so nothing jumps backwards. The setting box keeps the value the clip starts at.

Previews show what the real light will do. A light on **Whole light (one colour)**, or a Home
Assistant light or switch, can only change a few times a second, so its previews (the timeline,
**Preview**, the house photo, the Selection strip and the effect chooser) step at that pace rather than
moving smoothly, and a **Whole light (one colour)** light shows the single colour it really will.

On one of these slow lights, the Selection panel warns **⚠ Too fast for this light** when a clip's effect changes
faster than that, such as a quick chase, sparkle or strobe. It would look steppy on the real light.
Slow the effect down, or use a fade, pulse or colour change instead.

House lane effects are checked the same way, light by light: the warning names each slow light the
effect is too fast for, such as **⚠ Too fast for Porch (a Home Assistant light)**. Realtime lights in the
same sweep or wave are fine.

### Effects a light can't show

Not every effect works on every light. A light set to **Whole light (one colour)** shows one colour at a
time, so a chase, comet or two-colour blocks come out as one steady colour. A light with only a few
segments can't show a chase wider than itself.

- In the effect chooser, effects that won't work on the light are greyed out. Click one to see why.
  Turn on **Allow effects that won't work** to pick them anyway.
- Effects that work, but not quite as meant (too fast for a slow light, a House lane effect that is
  too fast for one of your slow lights, or one that leaves out lights you haven't traced on the photo),
  are marked **⚠**.
- On the timeline, clips that won't work are hatched with a red corner and a **⚠**; ones that only
  partly work get an orange corner. Select one and the Selection panel says why. When you open a show,
  a message says how many of its clips won't work.
- Nothing is changed or removed for you: such clips stay in your show and play as before. They are
  marked again whenever you change a light under **Setup → Devices**, say from **Realtime** to **Whole
  light (one colour)**.
- **Copy to all lights**, paste and adding an effect to several lights at once leave out the lights it
  won't work on, and say which. **Generate** and **Describe it** only use effects that work.
- A light whose realtime mode only reaches part of it, like the 30 m Christmas String Lights 2 (H70C5)
  at 44 bulbs, shows **⚠ first 44 bulbs only** under its name on the timeline.

### Presets

Most effects can look very different depending on their settings (Three colours can sit
still, alternate, or run as a slow or fast marquee). Turn on **Show presets** in the effect chooser and
each effect becomes its own boxed group: **Default** first, then its presets, each previewed. Picking
a preset sets just the settings it names. When adding an effect it uses the effect's default colours;
when changing a clip your colours stay. The Effect button shows the preset a clip matches, such as
**Three colours · Wide marquee**. The chooser remembers whether presets were showing.

Some presets come from WLED's favourites: **Heartbeat** (Pulse), **Meteor** (Comet), **Twin scanner** (Scanner)
and **Dark sparkle** (Twinkle: lit all over in your colour, with bulbs blinking out).

### Your own presets

Get a clip looking right, then press **Save as preset…** under its settings.
Name it and choose whether to **Include colours** (on by default; turn it off to save just the
movement and other settings, so the preset takes on whatever colours a clip already has). Your
presets appear in the effect chooser after the built-in ones, marked with a ★, and **★ My presets
only** narrows the chooser to them.

### The Presets tab

**Library → Presets** lists your presets by effect, each with a live preview, **Edit…**, and
**Rename…**, **Duplicate** and **Delete…** under **⋯**. **Edit…** opens the preset in a window with a larger preview (choose
which light's segments with **Preview on**). Rename it, change its **Effect** (or start again from one
of that effect's presets), turn **Include colours** on or off, and change its colours (palettes work
here too), settings and brightness; the preview follows every change. **Save** keeps the changes and
**Cancel** leaves the preset as it was. **+ New preset** starts one from scratch: pick an effect, or
any built-in preset, to start from, then **Add preset** in the window. Or describe a look in
the box above, such as "slow icy shimmer" or "warm fire flicker", and press **✨ Make presets**: the AI
suggests up to three, each with a live preview, and **Keep** adds one to your presets (it needs an AI
set up, as for **Describe it**). Changing or deleting
a preset doesn't change clips that already used it. They're saved in HA-liday Show, so every browser
sees the same ones.

Turn on **Show on the light** to loop it on the real light too while the show is
stopped; the light goes back to normal when you click away. Every effect has a **Brightness %**
slider, so one section can glow softly and the next hit full brightness.

### Copying

Select a clip, or click a light's name to select all its effects, press **Ctrl+C**,
click another light's name and press **Ctrl+V**. Pasted effects keep their times so the lights stay
in step; pasting onto the same light puts them at the playhead. With a light's name selected you
can also **Copy all effects to** another light or all of them, optionally replacing what they had.
Effects scale to each light's segment count. **D** duplicates the selected clip.

### Colour palettes

An effect's settings show the **Palette** in use, with its colours: press **Change…** to pick
another from a window of colour bars (built-in ones first, then yours). Click a colour to put it in
the colour field you last clicked, or press **Apply palette** to fill them all in order. Click a
light's name to **Recolour this light** or **Recolour all lights**: each light steps through the
palette effect by effect, so the lights stay matched (backgrounds are left alone). **Library →
Palettes** lists your palettes, each with **Edit…**, and **Rename…**, **Duplicate** and **Delete…** under **⋯**, then the built-in
ones (seasonal ones, plus looks such as **Classic C9 bulbs**, **Lava**, **Aurora** and **Ice and fire**). **Edit…** opens a window to rename the palette and change its colours: pick each colour, move it
up with **↑**, take it out with **✕**, or **+ Add a colour** (up to 12). **Save** keeps the changes.
**+ New palette**, or **Copy…** on a built-in one, opens the same window for a new palette. Or describe some colours in the box above, such as
"frosty winter night" or "tropical sunset", and press **✨ Make palettes**: the AI suggests up to three, each
shown as a colour bar, and **Keep** adds one to your palettes (it needs an AI set up, as for
**Describe it**). Your palettes are available in every show.

### Lights that are gone

A track whose light was removed from the Devices tab shows as **Missing
device**, and isn't played. Click its name and press **Remove from show** to take it out with its
effects (Ctrl+Z brings it back), or **Remove all unplayed tracks** when there are several.

### Working on one part

Drag along the time ruler to set a **play region**, or select a stretch
and press **▶ Play this part**. Play then plays just that part, and Home goes back to its start.
Turn on **Loop** to repeat it (or the whole show when there's no region), and clear the region with
its ✕. Region and Loop apply when the song plays in the browser; on a speaker the whole show plays.

### Undo

Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, even after a change has been saved.

### Shortcuts

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Home | Back to the start (of the play region, if there is one) |
| B | Add a beat at the playhead |
| Delete or Backspace | Delete the selected clip, or clear the selected stretch |
| D | Duplicate the selected clip |
| Esc | Deselect |
| Ctrl+C / Ctrl+V | Copy and paste effects |
| Ctrl+Z / Ctrl+Shift+Z | Undo and redo |
| Ctrl+S | Save |
| + / − | Zoom the timeline in and out |
| Ctrl+wheel | Zoom round the pointer |
| Shift while dragging | Place without snapping |
| Alt while dragging | Start a selection on top of a clip |

---

[← Your house](house.md) · [Contents](README.md) · [Effects →](effects.md)
