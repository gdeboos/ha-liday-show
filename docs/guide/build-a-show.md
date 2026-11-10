<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Build a show

[← Your house](house.md) · [Contents](README.md) · [Effects →](effects.md)

## 4. Build a show

A show is a song plus effects on each light's track. The usual path is: pick a song, **Detect** its
beats and sections, then **Generate** a draft or **Describe it**, and fine-tune clips on the
timeline.

- **The song:** [Shows](#shows) · [Sharing shows](#sharing-shows) · [Songs](#songs) · [Samples](#samples) · [Editing a song](#editing-a-song) · [Drafts](#drafts) · [Layers](#layers) · [Mashups](#mashups) · [Mixer](#mixer-bass-mid-treble-filter-tempo-and-key) · [Suggest cuts](#suggest-cuts) ·
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
one you were last editing has a **Last edited** badge. Under that is the show's palette: a strip of its colours
and the palette's name.

**Library → Shows**, **Scenes**, **Pictures**, **Faces**, **Palettes** and **Presets** show their items as
cards: each show's picture or cover art (or its palette tile), each scene's or palette's colours, each
picture or face, or each preset's moving preview, across the top, with its name and buttons under it. **Cards** and **List**, at the top right of each, switch between
cards and the shorter rows, and each remembers your choice in this browser. Folders stay full width
above the cards.

Once a show has a [season](lights.md#seasons), buttons above the list pick which shows you see: **All**, or one
season, such as **Christmas**, which shows its shows and the ones for **Any season**, from every folder,
each saying which folder it's in. It says how many are shown, and remembers your choice in this browser.
Pick **All** to see everything again.

#### Folders

Every Library list (**Shows**, **Scenes**, **Playlists**, **Songs**, **Samples**, **Palettes** and
**Presets**) has folders you go into, and folders can hold folders.

- A list shows its folders first, each with how much is in it, then what's in no folder. Press a
  folder to go into it; only what's in it shows. The path at the top (**Songs › Rock › Arctic
  Monkeys**) takes you back up, and so does the browser's **Back**. The list remembers the folder you
  were in.
- **+ New folder** (beside **+ New …**) makes a folder inside the one you're in. Anything you add or
  make while a folder is open (a new show, an uploaded song) goes in it, and a **Duplicate** goes in the
  same folder as the original.
- To move something, press **⋯ → Move to…** on it and pick a folder (or the top of the list), or drag
  its row onto a folder, or onto a name in the path to move it up. Folders move the same way, though
  never into themselves, and they go at most 8 deep.
- A folder's **⋯** has **Rename…**, **Move to…** and **Delete…**. Deleting a folder deletes nothing in
  it: what it held moves up a level.
- **Find** (on **Songs**) and the **Originals**, **Edits**, **Splits** and **Drafts** buttons search every folder;
  each match says which folder it's in, and pressing that goes there.

Folders only sort the lists: files stay where they are on disk, so shows and speakers still find their
songs. They're saved with your settings, so they're in **Export…** too.

- **Edit** a show to change it, or press **+ New show** to start one. A short window takes you through:
  1. the **song**: go into your song folders as in **Library → Songs**, or type in **Find a song in any
     folder**. Pick **No song, lights only** (at the top) to set a length instead, or press
     **+ Add a song…**.
  2. its **name**, which fills in from the song until you type your own. Each show needs its own name.
  3. its **colours**: a palette, shown as its colours, or **None** (see [The show's palette](#the-shows-palette)).
  4. with an AI set up, how it starts: **Start empty**, or **Generate with AI**, which needs a song
     and at least one light and shows the same choices as **✨ Generate** (in the show's palette: **Style**,
     **Feel**, **Build up**, **Longest effect** and, with lights traced on the house photo, the sweep across the
     house). Without an AI, there's no step 4 and the show starts empty. For a quick draft
     made by rules, press **✨ Generate** in the editor (see [Generate](#generate)).

  **Create show** (or **Create and generate**) saves it straight away; **Cancel** makes nothing.
- Each show's row has **Edit**, **▶ Preview**, and **⋯** for the rest: **Duplicate**, **Rename**, **Share**,
  **Export video…** (see [Making a video of a show](#making-a-video-of-a-show)), its
  **Move to…** (see [Folders](#folders)) and, last, **Remove…**. Rows elsewhere in the Library work the same
  way: their main button, then **⋯**.
- **▶ Preview**, beside **Edit**, plays the show on your house photo in a window, with its song.
  Nothing is sent to your lights. Under the house are the player controls: **⏮** back to the start, **⏪** and
  **⏩** back and on 5 seconds, **▶**/**⏸** to play and pause, a bar to jump to any point, and the volume. On a
  keyboard, Space plays and pauses, the arrow keys move 5 seconds and Home goes back to the start. **Edit** opens it.
  When visitors' phones join the show, or it has a **Phones** lane, a phone beside the house shows what their
  screens show as it plays (below the house on a narrow screen).
- <a id="making-a-video-of-a-show"></a>**Making a video of a show**: **Export video…** in a show's **⋯** (or
  **🎬 Video…** in the Show editor's top bar) makes an MP4 of it playing on your house photo, as **▶ Preview**
  shows it, with its song, to post on YouTube, a forum or social media.
  - Pick **Landscape** (1920 × 1080) or **Upright** (1080 × 1920, for Shorts, Reels and TikTok), and **The
    whole show** or, from the Show editor with a [play region](#working-on-one-part) set, **The play region**
    for a short clip.
  - The video starts with the show's name (and its song's, if that's different), shows a bar along the
    bottom with the song's sections and beats moving as it plays, has a small "Made with HA-liday Show" in
    the corner, and ends with a three-second card with HA-liday Show's web address.
  - It's drawn and encoded in your browser, much faster than the show plays, then HA-liday Show adds the
    song and makes the MP4, which downloads by itself. **Cancel** stops it. Nothing is kept afterwards.
  - It needs a house photo (or the sample house) under **Setup → House**, with your lights traced to see them,
    and a browser that can make videos: Chrome, Edge and Safari can. A show open with changes is saved first.
    A Python install needs ffmpeg (the app and the Docker image have it).
- **In progress** or finished: a new show starts **In progress**, shown by a badge on its row, until you
  mark it finished with **Mark as finished** in its **⋯** menu (or untick **In progress** in
  **⚙ Show settings…**). **Mark as in progress** puts it back. Shows in progress still play everywhere
  you play them, but they aren't offered on the public page and visitors don't see them, even inside a
  playlist, so you can take one back to work on it without losing its place there. Shows you made before
  this existed count as finished.
- **On phones**: while **Let visitors' phones join the show** is on (under **Public page → Listening**), a
  show that visitors' phones follow has an **On phones** badge. A show you've taken off phones (untick
  **Phones join this show** in **⚙ Show settings… → Visitors' phones**) doesn't. Hover over the badge to
  see whether it has its own **Phones** lane or phones just show your lights' colour.
- **Duplicate** makes a copy called "… copy", ready to play straight away. The copy starts in progress.
- **Rename** lets you type a new name in the list; press Enter to keep it, or Escape to put it back.
  Each show needs its own name. An automation that starts the show by its name needs the new name.
- **Share** downloads the show as a file you can send to anyone with HA-liday Show (see [Sharing shows](#sharing-shows)).
- **Remove…** archives or deletes a show (see [Archiving and deleting](#archiving-and-deleting)).
- **← All shows**, at the start of the Show panel, takes you back to **Library → Shows**. Going to
  another tab instead keeps your show open, with **↩** at the top to come back to it (see
  [Finding your way](getting-started.md#finding-your-way)).

The Show panel shows the open show's name beside **← All shows**; to switch to another show, go back
to the list. **⚙ Show settings…** opens the show's settings: its **Name**, **In progress** (see [Shows](#shows)), its **Palette** (below), its **Picture** (see [Songs](#songs)), its **Show speaker**
(below), **Brightness** (below), **Visitors' phones** (see [Phones join the show](public-page.md#phones-join-the-show)), **Save automatically a couple of seconds after each change**, and **Remove show…** to archive or delete it.

#### A song's colours

A song can have its own palette, picked from its cover art or the AI's ideas when you add it, from **Colours from this
song…** in its **⋯** menu under **Library → Songs**, or from **Colours…** in the Music editor's **Beats
and sections** panel. The palette you pick is kept with the song and added to your palettes (named after
the song), so you can edit or rename it under **Library → Palettes**. Picking again for the same song
changes that palette rather than adding another. The AI is told the song's name (put the
artist in it, such as "Wham! - Last Christmas", for the best ideas) and the cover's main colours, not
the picture itself; a song with no cover art still gets its ideas. A song file made from it in the Music editor (**Make song
file**) comes with its colours, as it does its cover art; once the made file has colours of its own,
making it again keeps them. When a **New show** picks the song, its palette is
picked for you in the colours step, marked **This song's colours**, unless you've already chosen
colours yourself in that window. Changing the song of a show you've already made doesn't change its
colours.

#### The show's palette

Each show can have its own palette, picked in the **New show** window and changed in **⚙ Show
settings…**. In the **New show** window (and **+ New scene**'s colours step), your palettes are in your
folders from **Library → Palettes**, with the built-in ones after them; if the one picked is in
another folder, a line under the list says which. Effects you add take its colours, and the effect chooser previews every effect in them.
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
  (its name, what kind of light it is, how many segments and parts it has, roughly where it is on
  your house photo, and the [seasons](lights.md#seasons) it's a prop for). The show's season goes with it too. It doesn't hold the song, your house photo, IP addresses or any settings. Lights
  with no effects in the show are left out. Pictures used by its **Picture** effects go with it (up to
  20), and are added to your **Library → Pictures** when it's imported. A show with pictures needs
  HA-liday Show 0.2.282 or later to import. Your own [faces](#faces) used by its **Singing face** effects
  go with it too (up to 20), and are added to your **Library → Faces** when it's imported (one you
  already have, with the same name and look, is used as it is). In a copy older than 0.2.392 they show
  as snowmen.
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

  **Seasons** come along by name. A Halloween show becomes a Halloween show if you have a season called
  Halloween (otherwise it's for any season, and a note says so). Their Halloween props are suggested for
  your Halloween props, and their all-year lights for your all-year ones; the match screen says which of
  their lights are props.

  **Matrices** come along with their size. Their matrices are suggested for your matrices, and their
  mega-trees for your mega-trees. When the sizes differ, the match screen says their matrix effects
  stretch to fit, and when you pick a strip for one, it says those effects show only a slice there.

  **Import show** saves it and opens it in the editor. Effects a light can't show are marked as usual
  (see [Effects a light can't show](#effects-a-light-cant-show)).

### Songs

The Song panel shows the show's song with its length, tempo and sections, and, once HA-liday Show has
listened to it, what can be heard in it (see [Split into parts](#split-into-parts)). Press
**Change…** to pick another from your Home Assistant **media** folder: the window shows your folders from
**Library → Songs**, opening on the one the show's song is in (or the top, for a lights-only show), and
**Find a song in any folder** searches them all. Or press **+ Add a song…** (MP3,
M4A, AAC, OGG, Opus, WAV, FLAC or WebM; see below). Songs you add go to `/media/haliday_show/` so media
players can play them. For a lights-only show, choose **No song, lights only** and set its **Length with no song**.

**Library → Songs** lists every song in your media folder: its length, what **Detect** found (its
tempo and sections) or "not detected yet", and which shows use it. Under that, a strip of colours with a palette's name shows the colours kept with it (press it to pick
again; see [A song's colours](#a-songs-colours)), a pink **♪ Lyrics** pill shows it has
its words. An edit cut from a song with words shows it too, as its shows use the song's words
(a mashup only shows it if it has words of its own), and **Parts:** with a coloured dot for each part shows it's been split into its vocals, drums,
bass and the rest (the same as in the Music editor). Type in **Find** to narrow the
list by name, folder or show. **Edit** opens a song in the **Music editor**, and **Remove…** archives
or deletes one. The song you last opened in the Music editor has a **Last edited** badge.
**▶** beside a song, an edit or a split plays it there and then, in a bar along the bottom of the page:
**⏸** pauses, the slider jumps to any point, and **✕** stops it. It stops when you leave **Songs**.
A song with cover art (from an MP3, M4A or FLAC's own tags) shows it beside its name, and beside the
shows that use it in **Library → Shows**. To give a show a picture of its own, use **Picture** in its
**⚙ Show settings…**: **Upload picture…** takes any photo or image, squares it from the middle, and uses it
instead of the song's cover art, here and on the public page (with any hidden details, such as where a
photo was taken, taken out). **Remove** goes back to the song's cover art. A show with neither gets a
tile in its palette's colours with its first letter. Songs are kept exactly as you added them, so their cover art,
title and artist are never lost.

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
  "… copy") under **⋯** too. Renaming one that's still open in
  the Music editor puts it away there first, once your last change is kept.

**All**, **Originals**, **Edits**, **Splits** (splits from before songs kept their parts, that
couldn't be matched to their song) and **Drafts**, beside **Find**, show just those, and the count says
how many songs, edits, splits and drafts there are.

**Folders** sort your songs, such as **Christmas**, **Halloween** or **Party**, and work as in every
Library list (see [Folders](#folders)). A song's edits and drafts go with it.

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

Then a **Colours from this song** window follows, if there's something to offer: a palette made from
the cover's main colours, made bright for lights (black, greys and whites are left out, as they look
like "off" or dull on lights), and, with an AI set up, up to two palettes from the AI that suit the song
(listed under **From the song** when they arrive; a spinner shows while the AI works, and after a few
seconds how long it's taken, as it can take up to a minute). Press **Use these** on the one you
want, or **Skip**. See [A song's colours](#a-songs-colours).

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
  of your shows and settings under **Setup → Your data** (*Before deleting*). A deleted song
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

#### Split into parts

**Split into parts…** (under a song's **⋯** in **Library → Songs**, or in the Music editor's **Song**
panel, which shows **Parts:** with each part's colour once it has them, and **Split again…** to make them afresh) separates a song into its **vocals**, **drums**, **bass** and **the rest** of the music, and
keeps them with the song as its **parts**, along with the **music** (everything but the vocals). They
aren't songs of their own: the song's row shows them the same way, **Parts:** with each part's colour,
and they go wherever the song goes (renamed, copied, archived or deleted with it).

- **Singing faces** follow the vocals part.
- **Drum hits:** from the drums part, HA-liday Show finds when each kick, snare, hi-hat and crash
  lands. In the Music editor they show as small marks along the bottom of the waveform: red for kicks,
  blue for snares and gold for crashes. [Generate](#generate) uses them to put flashes on the real
  hits rather than every beat.
- **What can be heard in it:** once its parts are made, HA-liday Show listens to the whole song with a
  fourth, small AI (Google's YAMNet, which knows hundreds of kinds of sound) for **sleigh bells**,
  **bells and chimes**, **xylophone and vibes**, a **choir**, **brass**, **strings and orchestra**,
  **piano**, **organ**, **guitar**, **synthesiser**, **woodwind**, **harp**, **whistling** and
  **clapping**, and for how it sounds: **happy**, **sad**, **tender**, **exciting**, **angry**,
  **scary** or **Christmassy**. It takes seconds. The show's **Song** panel then says what it heard,
  such as "Heard: Sleigh bells, Choir · sounds happy", and [Generate](#generate) picks looks to suit
  each part of the song.
- **Layers** in the Music editor can play any song's parts: press **+ Add a clip…**, pick the song under
  **Songs**, then choose **Just the vocals**, **Just the drums** and so on under **Use from**. Use the
  music as a backing track, the drums under another song, or the vocals over another song for a
  mash-up. Splicing a song in (**Add another song → Choose song…**) offers its parts the same way.
- **Edits** use their original song's parts through your cuts, so there's no need to split an edit.
  When you make a song file from a draft, its parts (and its drum hits) are cut from the original's the
  same way, in seconds, with no AI. Your EQ and layers go into them too: a layer of just another song's
  vocals goes into the new file's vocals, a whole song layered on adds each of its parts to the matching
  part, and a sample (or a song not split yet) goes into the rest of the music. Where a layer quietens
  the song, every part dips with it.

**New songs are split by default.** When you add a song (**+ Add a song**), the window stays open
while it gets the song ready, with a line for each thing it does and its own percentage: added (and
its beats and sections found), its section notes (when an AI or the notes model writes them), its
vocals, drums and bass found (saying whether that's on your graphics chip or the slower processor), its
parts kept, listening for the sounds in it, and its words lined up if you pasted them.
It takes several minutes. **Stop** stops it, keeping whatever's done, and **Done** closes the window
when it's finished. On a slower computer, turn off **Split it into parts** in the second step of
**Add a song** to leave that for later: the song is then only listened to (see below), which takes
seconds, and **Split all songs into parts** splits it whenever suits you, overnight say. **Add a
song** remembers your choice for next time.

**Words** in the second step of **Add a song** is optional: paste the song's words, one line of the song
per line, and they're kept with the song (a **♪ Lyrics** badge shows on its row). Once it's split, they're
lined up with the singing, as **Line up with the singing** does under [Lyrics…](effects.md#lyrics-for-a-singing-face).
Left unsplit, they're placed roughly across the song. When it's done, **Check the words…** opens the
**Lyrics…** window to check every line (or, if they were only placed roughly, to pick a better way to place
them), and if you didn't paste any, **Add words…** opens it to paste them.

When songs are split another way (**Split all songs into parts**, or **Split into parts…** on one), a bar above your songs in **Library → Songs** says which song
it's on and how far along it is, and the line at the bottom of the page says so on other pages too.
You can carry on using HA-liday Show meanwhile, but keep the page open until it's done. **Stop** stops
it; parts already made are kept. If the connection drops part way (the Wi-Fi blips, or the app restarts
after an update), it waits and tries again for about a minute before giving up on that song; if it does
give up, it says it lost touch, and **Split into parts…** on that song tries again. A song cut off part way as it
downloads to your browser carries on from where it got to.

**Split all songs into parts** (under the list in **Library → Songs**) does the same for every song
that isn't split yet, one after another, and listens to any song split before HA-liday Show listened
to songs (seconds each, with no question asked if that's all there is to do). An edit made from a draft of a song that's split has its
parts cut from the original's in seconds, rather than split again. A file made from a draft with layers or EQ
before 0.2.412 has parts without them: open its draft and press **Make song file** again to put them in,
in seconds. Anything not done when you close
the page is picked up next time you press it.

An edit doesn't need splitting on its own: it gets its parts from its original song. Once the
original is split, its edits get their parts cut from it automatically, in seconds, whenever
**Library → Songs** is open (an edit with layers or other songs spliced in is the exception: use its
**⋯ → Split into parts…**). An edit's **⋯** says **Get parts from the original** to do it straight away,
or **Split the original into parts…** while the original isn't split yet. **Split all songs into
parts** counts only the songs that need the AI, splits them first, then cuts their edits' parts.

A song you split before (with Split vocals) has its vocals already: **Split into parts…** keeps them
and only finds the drums, bass and rest. Each part is kept as soon as it's ready, so if you stop part
way, the parts it finished are kept.

Parts are kept in a hidden **.parts** folder inside HA-liday Show's songs folder (**haliday_show** in
your media folder), as WAV files: each is about 10 MB a minute of song, so a three-minute song's parts
take about 150 MB.

Songs you split before songs had parts ("Jingle Bells (vocals)" and "Jingle Bells (music)")
were moved into their song's parts when you updated, and shows and drafts that used them follow. Any
that couldn't be matched to a song (its song's gone, say) stay as songs, under **Splits**.

Three AI models do it, in your browser, on the song as it is (not a draft's edits): one for the vocals,
then one each for the drums and the bass, and a fourth listens to it. The first time, HA-liday Show downloads them (about 145 MB),
checks them, and keeps them until HA-liday Show restarts (they're never in your backups); your browser
then takes them from there, in pieces, and keeps its own copy where it can.
It's quickest on a computer whose browser can use the graphics chip (recent Chrome or Edge): a few
minutes for a song. The rest of the work around the AI is shared across your computer's cores, so
the graphics chip isn't kept waiting. The window says where it's running: **on the graphics chip**,
or **on the processor**, which can take a long time, several times as long as the song for each part,
so leave the page open and come back. If the graphics chip runs out of memory part way, it carries on on
the processor and says so: close other apps and browser tabs, then split again. Songs with clear lead vocals split
best; backing singers and effects can stay in the music, and a little of the music in the vocals.

While it works, a window covers the page saying what it's doing (downloading the AI, finding each part)
and how far along it is. **Cancel** stops it; the song is never changed. If the AI can't be downloaded,
the window says why, and HA-liday Show's log (in Home Assistant, the app's **Log** tab) says more.

### Samples

**Library → Samples** keeps short sounds, such as sleigh bells, a "ho ho ho" or a voice saying "Merry
Christmas", ready to layer over a song in the Music editor. There are two ways to make one:

- **From a song:** in the Music editor, select the stretch you want and press **Save as sample…** (in
  the **Selection** panel), pick which sound, then give it a name. **As you hear it** keeps it as it
  sounds in your edit, layers and all. A song that's been split into parts also offers **Just the
  vocals**, **Just the drums**, **Just the bass** and **Just the rest** (a drum fill, or a sung line on its
  own; the part as it is, even if you've muted or turned it down in the **Mixer**), and while you're editing a layer on its own, **Just Choir** (or whatever it's called) keeps just
  that layer.
- **From a file:** press **+ Add a sample** and pick one or more files (the same kinds as songs).

They go in a **Samples** folder inside `/media/haliday_show/`, kept out of **Library → Songs** and a show's
song list so those stay tidy. Use them on a [layer](#layers) in the Music editor. Each sample has **▶** to hear it (press **■** to stop), and under **⋯**, **Rename…**, **Duplicate**
(a copy, "… copy") and **Delete…** to remove it for good. Layers that use a renamed sample follow it.

To sort them, use folders (see [Folders](#folders)). The files themselves stay where they are, so
songs that use them still find them. In the Music editor, a layer's **+ Add a clip…** window shows the
samples in their folders.

### Pictures

**Library → Pictures** keeps pictures and animated GIFs for the **Picture** effect on a matrix (see
*Matrices* under *1. Devices*). Press **+ Add a picture** and pick one or more image files: PNG, JPEG,
GIF and the other kinds your browser can open. Each is shrunk to fit the biggest matrix (64 × 64) as
it's added, and a GIF keeps up to 120 of its frames, so small, bold pictures with few colours work
best. See-through parts show the effect's **Background**. You can keep up to 200 pictures, and a file
over 2000 × 2000 needs making smaller first.

A sharper copy (up to 256 × 256) is kept as well for visitors' phones, where a **Picture** on the
**Phones** lane is drawn four times finer than the rest of the screen, so it's smooth rather than blocky.
It's stored compressed so a phone downloads it quickly; a long GIF may keep only every other frame on
phones (each showing for twice as long). Pictures added before HA-liday Show 0.2.401 don't have one:
delete and add them again to get it.

Each picture's row shows its first frame, its size and, for a GIF, how many frames it has and how long
it takes, then **sharp on phones** when it has a phone copy. **Rename…** changes its name; **Delete…** (under **⋯**) removes it for good, and **Picture**
effects that used it show their background. Sort them with folders (see [Folders](#folders)).

### Faces

**Library → Faces** keeps the characters for the **Singing face** effect (on a matrix, or on visitors'
phones). The built-in ones are listed under **Built in**; yours are above them.

Press **+ New face** to open the face maker, or **Duplicate** on any face (built-in or yours) to start from
it. Pick each part from its list and give it a colour:

- **Head**: round, oval, wide, a Christmas tree, a ghost or a skull, and its colour.
- **Face patch**: a lighter patch on the face, a muzzle or a chest (like a penguin's face or a robin's
  breast).
- **Eyes**: dots, ovals, big eyes, glowing triangles, skull sockets or cat's eyes.
- **Nose**, **Mouth** (open, a jagged pumpkin grin, a row of teeth, or a small round one) and **Cheeks**.
- **On top**: a top hat, Santa, witch, elf or bobble hat, antlers, cat or bear ears, or a star. Hats with
  a band or trim have a second colour.
- **Extras**: a beard, moustache, whiskers, pointy ears, baubles, a scarf or a bow tie, each in its own
  colour.

The preview sings "ah", "oo", "ee" and "mm" and blinks while you work, big and as a phone shows it. Press
**Add face** (or **Save**) to keep it. Then pick it as a Singing face clip's **Character**: press
**Change…** for a window with your faces in their folders and the built-in ones marked **Built in**.

**Edit…** on one of yours opens it again. Changing a face changes it in every show that uses it, and those
shows are made ready again in the background. **Delete…** (under **⋯**) removes it; Singing faces that used
it show a snowman instead. You can keep up to 200 faces, and sort them with folders (see
[Folders](#folders)).

### Editing a song

The **Music editor** cuts, shortens and splices songs before you build a show. Press **Edit** on a
song under **Library → Songs** (with **+ Add a song**) to open it; nothing is touched until you do. The open
song's name sits beside **← All songs**, which goes back to the list to open another. The song you open is never changed: your
first change starts a [draft](#drafts), kept as you go, which you make into a new song file when you're
happy. Drag across the waveform to select (clicking moves the playhead and keeps the selection; press **✕**
next to its times or Esc to clear it). The **Selection** panel then says what you've selected (the
section's name when it's exactly one section, its times, and how long in seconds and bars) with what you
can do to it: **▶ Play selection**, **Preview cut**, **Cut** to remove it, **Keep only this** to shorten
the song to it, **Repeat ×2** or **Repeat ×4** to play it twice or four times in a row (what comes after
moves on; select whole bars for a seamless loop), and **Save as sample…**. Or let **✂ Suggest cuts…** (in the **Edit** panel, with
**Undo** and **Redo**) find the cuts for you (see
[Suggest cuts](#suggest-cuts)). To splice in another song, press **Choose song…** under **Add another song**: it
opens your songs in their folders, as in **Library → Songs**, or type in the box to find one in any
folder. Pick it and press **Choose** (or double-click it), or **Upload** a new one. A song that's been
split into parts lets you splice in just one part, under **Use from**. Then **Insert at
playhead** or **Add to end** adds it, and it's selected so you can trim it. Joins blend over the **Crossfade at joins**
time (a few hundredths of a second hides the click, a few seconds blends one song into the next), and
**Fade in** and **Fade out** soften the ends. Zoom with the wheel, or type the selection's times for
precision. **⏮** goes back to the start, and **⏪** and **⏩** go back or on a bar (5 seconds before the song
is detected), carrying on playing if it was. The 🔊 slider by the clock sets how loud it plays in your browser. Once the song is detected, selection edges snap to bars
(hold Shift to place them freely), clicking a section in the lane selects exactly its stretch (Shift-click
adds the next), and **Preview cut** plays the join before you cut, with the playhead jumping over the selection as the cut would. Beats and sections follow your edits
and are kept when you make the song file. Zoomed in, edges also snap to beats, and to the kicks and snares
of a song that's been split into parts. Edit the song before placing clips, because cutting it
afterwards won't move them.

Each join shows as a dashed line with a **✂** at the top. Click the **✂** to hear a few seconds either
side of the join; the **Selection** panel says what was cut there (how much, and from where in the
song). To change that cut, press **Adjust cut**: the part comes back and is selected, so drag its edges
(or type the times) and press **Cut** again. **Put back** undoes just that cut, leaving the
others as they are. Both are one step for **Undo**. A join where another song was spliced in only has
**▶ Hear join** and **Transition**. **Transition** gives any join a DJ-style change into what comes next:
**Echo out** (the last beat before the join repeats, fading, over the next part), **Filter sweep** (the
highs sweep away over the bar before the join, as if the music's going under water) or **Drop the bass**
(no bass for the bar before the join, then it all comes back at once). They keep time with the music
before the join, and you hear the join as soon as you pick one. **None** puts it back to a plain join.
When you zoom out, the beat lines thin out to every bar, then every 2nd or 4th bar, so
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
so every speaker can play it; pick it under **Song** in a show. Its beats, sections and marks go with it,
and so does the cover art of the song you started from.
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

1. Under the waveform, in the **Mixer**, press **+ Add layer** (up to four). Its row has its name,
   **M** and **S** (mute and solo), **Volume**, **EQ** (see [Mixer](#mixer-bass-mid-treble-filter-tempo-and-key)),
   **Quieten**, **Match tempo**, **Key** and **⋯**, and a lane appears under the waveform for its
   clips. Double-click the name (or use **⋯ → Rename**) to rename it; **⋯ → Remove** removes it.
2. Put the playhead where you want a clip to start, then press **⋯ → + Add a clip at the playhead…** on the layer's row. A
   window opens with your **Samples** and **Songs** in their folders (type in the box to find one in any
   folder). Pick one and press **Add**. A song that's been split into parts also offers **Use from**:
   **The whole song**, or just one part, such as **Just the vocals**. The clip starts a little quieter
   than the song, so it sits in the mix; change that with the clip's **Volume**. A clip of one part is
   labelled with it in the part's colour, such as **Vocals · Carol** in purple.
3. Drag a clip to move it (it snaps to bars, beats and marks; hold Shift to place it freely). Drag its
   left or right end to trim it. Click a clip to pick it (the playhead goes where you clicked): its panel
   has **Volume**, **Fade in**, **Fade out**, **▶ Hear it**, **✂ Split at playhead** (or press S) and
   **Delete** (or press Delete). Each clip shows its own waveform and, once its song has been detected,
   its sections in their colours, so you can see where its chorus or drop is. To use just parts of a
   song on a layer, split it where each part starts and ends, delete what you don't want and drag the
   rest where it goes.
4. To make a layer stand out, such as a voice saying "Merry Christmas", turn on **Quieten** on its row,
   with **the song** picked beside it. The song dips while that layer's clips play (starting just before each one) and comes back up
   gently after. **By**, beside it, sets how far: from a little (3 dB, so the song is still clearly
   heard) to nearly silent (24 dB); it starts at 8 dB. Where two layers that quieten the song play at
   once, the song dips by the bigger amount. It's off for new layers.

   Or the other way round: pick **this layer** and the layer goes down while the song sings, and back up
   between lines, so a horn or a choir doesn't fight the singer. It follows the song's vocals as you hear
   them (none where you've muted them), so the song needs splitting into parts first. **By** sets how far
   here too.

**Editing a layer on its own.** Click a layer's name at the left of its lane (or **⋯ → ✎ Edit this
layer** in the Mixer) and the big waveform shows that layer instead of the song: its own sound, in the
layer's colour, with the song faintly behind so you can see where you are, and its clips' songs' beats
and sections where its clips play them (a clip of a song's vocals shows that song's sections). A blue bar
says **Editing layer Choir**, its lane is outlined and its Mixer row says **Editing**. Now:

- Drag across the waveform, or click a section, to select a stretch of the layer. Selections snap to its
  own bars and beats, and to the kicks and snares of its clips' songs.
- **Cut** asks **Cut and close up** (the rest of the layer moves earlier to fill the gap, crossfaded at
  the join) or **Cut and leave a gap** (the layer is silent there). Either way the song and the other
  layers don't move.
- **Preview cut** plays a few seconds either side of the join, closed up, with everything else as it is.
- **Keep only this** trims the layer to the selection, leaving the rest of it silent.
- **Repeat ×2** and **Repeat ×4** play that stretch of the layer twice or four times in a row; the rest of
  the layer moves on after it, and anything pushed past the song's end is left out.
- Under the selection, the layer's own group (**Choir here** for a layer called Choir) changes the layer's volume over just that stretch: **Mute here**,
  **Quieter here** (6 dB down), **Fade in here** or **Fade out here** (from silent to full, or the other
  way, across the selection). Each shows on the layer's lane, hatched or as a slope, and stays with that
  moment of the song if you cut the song afterwards. **As it was** (or **Muted here ✕**) takes them off the
  selection. A layer that quietens the song doesn't dip it where the layer's muted, and a muted vocals
  layer's words are left out of a song file made from it.
- **Add another song** goes into the layer: pick the song with **Choose song…** as usual, then **Insert
  into Choir at playhead** (the rest of the layer moves on by its length; a clip running across the
  playhead is split there) or **Add to end of Choir** (after its last clip). The song and the other layers
  don't move, and it's selected so you can trim it. Anything pushed past the song's end is left out (the
  message says so; Ctrl+Z brings it back).
- To change the sections of a clip's song, open that song in the Music editor: they're the song's own,
  used everywhere it is.

Press **← Back to the song** (or the layer's name again, or **Song** on another lane) to edit the song
again. Every change is one **Undo** step.

**Change a clip's part.** Click a clip of a song that's been split into parts, and **Use** in its panel
switches it between **The whole song** and just one part (**Just the vocals**, **Just the drums** and so
on), where it is, without adding it again.

**Cutting in the middle of a word.** With the song's lyrics placed, **Cut** checks whether either end of
the cut lands inside a sung word. If one does, it offers **Move it between words** (each end goes to the
nearer edge of its word) or **Cut here anyway**.

Each clip is pinned to the moment in the song it starts at, so it moves with your cuts: cut a bit
earlier in the song and it moves earlier with the music; cut the part it sits on and it's left out
(**Undo** or **Put back** brings it back). A new clip is trimmed to the song's end. One that runs past it (after a cut, say) stops there, and
its end sits at the song's end so you can drag it in.
If you delete a sample a draft uses, its clips show greyed out and silent until you delete them or add
the sample back. Layers are part of the draft and every change is one
**Undo** step. **Make song file** mixes the layers into the new file, keeping the mix from
distorting where they pile up. The waveform, **Detect** and **Suggest cuts** go by the song alone, and a
sample saved with **Save as sample…** includes the layers unless you pick one sound.

#### Mashups

**✨ New mashup…** in **Library → Songs** puts one song's singing over another's music. Both need to be
[split into parts](#split-into-parts).

1. Pick **The singing from** (its vocals are used) and **The music from** (everything but its vocals).
   Each shows its tempo and key once it's been detected.
2. A box says how well they fit and what will change, such as "A good fit. The singing is sped up 3% to
   121 BPM, and moved up 2 semitones into A minor". **Great fit** and **Good fit** need little change; a
   **Big change** (more than about 10% faster or slower, or a key far away) can start to sound odd.
3. **Start the singing at** picks where in the music the singing comes in (one of its sections, or the
   start), and **From the singing's** where in the singing song it starts from.
4. **Match tempo**, **Match key** and **Line up on the bar** are on to start with: the singing plays at
   the music's tempo, in its key, with its bars on the music's bars.
5. Press **Make mashup**. The Music editor opens a draft of the music song with its own vocals muted
   (the Mixer's **Vocals** row) and the singing on a layer of its own, ready to play. Neither song is
   changed. Fine-tune it as you would any draft, then **Make song file**.

**Shows on a mashup.** When you make a song file from a mashup (a draft with layers, or with the song's
own parts changed), its words are the ones you hear: another song's lyrics where its vocals (or the whole
song) play on a layer, timed through the clip (its trims, and its tempo if it's matched), and none of the
song's own where its vocals are muted. Its drum hits come from the drums you hear too, layers and all.
So a **Singing face** in a show on it mouths the layered singer's words, and **Drum hits** flash on the
drums that are really there. To change a mashup's words, open **Lyrics…** in a show on it (they're its
own, not its songs'), or change the songs' lyrics and make the file again.

**Find a match.** In **⋯ → + Add a clip at the playhead…**, under **Songs**, **Sort: Best fit first**
(beside **By name**) puts the songs that would fit best over this one at the top, going by the tempo and
key **Detect** found. Each says how well: **Great fit**, **Good fit**, **Fits with a change** or **Big
change**, and why, such as "4 BPM faster · C major, fits A minor" (relative keys share their notes, so
need no change). Songs not detected yet come last.

**Add just a section.** Once you've picked a song, **Which part of it** lists its sections with their
times, such as **Chorus 0:48 – 1:12**: pick one to add just that stretch (it fades in and out a little),
or **All of it**. **Line up on the bar** (on to start with) lands its first bar on the song's nearest bar.

**Clips line up on the bar.** Wherever both songs have been detected, a clip you add or drag on a layer
lands with its first bar on the song's nearest bar, so the two stay in step. Hold **Alt** (or **Shift**)
while dragging to place it anywhere.

**Two songs' tempos and keys.** Click a clip of another song: its panel shows that song's tempo and key
beside this one's and what it'd take to fit, with **Match tempo and key** to set both on its layer in
one go.

#### Mixer: bass, mid, treble, filter, tempo and key

The **Mixer** under the waveform works like a DJ's, for mash-ups and for making a layer sit well with
the song. The song has a row, and so does each layer, with their controls lined up in columns (on a
narrow screen, each row wraps and labels its controls).

- **The song's parts.** Once the song's been [split into parts](#split-into-parts), its row has four more
  under it: **Vocals**, **Drums**, **Bass** and **Rest**, each with **M**, **S** and **Volume**, like stems
  on a DJ controller. Mute its vocals for an instrumental, or turn the drums down. To change them over
  just a stretch, select it and use **The song's parts here** in the **Selection** panel: **Mute vocals
  here** (or drums, bass, rest), or **Vocals only here** for an a cappella bit. A part muted there shows
  as **Drums muted here ✕**: press it to bring them back. These are kept with the draft, follow your cuts,
  and go into the song file you make, and into its own parts (a muted part is quiet in that part too).
  **Parts**, beside the zoom buttons at the top of the waveform, shows the song as its four parts on rows
  of their own, in their colours, with where each is muted hatched; click a hatched stretch to select it.
  **Song** goes back to the song's waveform. If the song (or a song spliced into it) hasn't been split,
  the Mixer says so instead.
- **M** (mute) silences a row, and **S** (solo) lets you hear only the rows you've soloed, so you can
  hear a layer on its own or check how two fit together. They're also at the left of each lane on the
  waveform, beside its name, and a row you can't hear shows faded. It keeps playing while you press them.
  Solo, and muting the song, are only for listening: a song file made from the draft has everything in
  it. Muting a layer is kept with the draft and leaves it out of the song file, until you unmute it.

- **EQ** opens that row's **Bass**, **Mid** and **Treble** faders in the **Selection** panel (press it again,
  or **✕**, to close them; another row's **EQ** swaps to its faders). Each goes from +6 dB down to **off**
  at the bottom: take the bass out of the song while a layer's bass carries it, say, or the treble off a
  layer so it sits behind. The **EQ** button is highlighted when anything is changed.
- **Filter**, under the faders, is a DJ's filter: slide it left to muffle the sound, as if it's coming
  through a wall, or right to thin it out until only the top is left. The middle is off. Sweep it with
  changes (below) for a build-up: muffle the song, then open it up on the drop. A change made before you
  used the filter has it off, so the sound opens up again there; move the playhead past it to set it.
- **Changes partway through:** put the playhead where it should change, press **+ Change here**, then
  move the faders (and the **Filter**). From there the sound glides to the new settings over **Glide** seconds (1 by
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
- **Key** on a layer moves its clips up or down so they're in the song's key and don't clash. **Match the
  song** works out the song's key (or uses the one **Detect** found, shown beside its tempo) and each
  clip's, and moves each clip by as few semitones as it takes (at most 6), keeping its speed. A key and
  its relative minor or major (C major and A minor, say) share their notes, so they count as the same. Or
  pick **+1** to **+6** or **−1** to **−6 semitones** to move it by hand; **Own key** leaves it as it is.
  A clip too short to tell (under a second) stays as it is. A big move (5 or 6 semitones) can sound a
  little artificial.

All of it is part of the draft, every change is one **Undo** step, and **Make song file** includes it.
The waveform still shows the song as it was, without the mixer, with two marks on top so you can see
what the mixer does:

- Where a layer quietens the song, a grey band hangs down from the top of the waveform: the deeper it
  goes, the more the song dips (all the way to the middle is 24 dB). It's labelled with how far, such as
  **Song −16 dB**.
- When the song has EQ, three thin lines run along the bottom of the waveform: orange for **Bass**, green
  for **Mid** and blue for **Treble**. A line above the others is turned up, below them turned down, and
  each glides into a change as the sound does. A purple line is the **Filter**: down for muffled, up for
  thin.

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
which earlier section it's like. Once the song has been through **Split into parts** (and its words
lined up with **Lyrics**), the notes also say what can be heard in each section (a choir, sleigh bells,
brass), where the singing starts and stops, when the drums come in, any cymbal crashes and the line
being sung. It then suggests how to light it, for example: "Loud; you can hear a choir; singing from
0:26 to 0:44; drums come in at 0:24. Everything on, moving and flashing on the beat; slow washes for the
choir; bring everything in when the drums start; drop to a soft glow when the singing stops." Notes you've typed or changed are never replaced, and nor are names you've
given sections: pressing **Detect** again carries them over to the new section that covers the same
stretch of the song. Edit anything it writes; once you do, it's yours.

With an AI set up (see [Setting up the AI](editor-and-settings.md#setting-up-the-ai)), or the [notes model on this
device](editor-and-settings.md#section-notes-on-this-device), the AI then rewrites those notes,
usually within a minute, while you carry on. It can't hear the song, so it works from the same
measurements (including what can be heard, the singing, drums and words) and the song's name. If it knows the song, it uses what it knows: which part is the verse
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

**What can be heard.** For a song HA-liday Show has listened to (see [Split into parts](#split-into-parts)),
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

**Following the drums and the words.** Once a song is [split into parts](#split-into-parts) and has
[lyrics](effects.md#lyrics-for-a-singing-face), Generate follows them as well as the beat, using each light's
[role](lights.md#light-roles):

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
its edges to resize it (where it touches the next effect, dragging the join moves both, so no gap
opens up; hold **Ctrl** to move just the one), and change its effect, colours and settings in the
Selection panel. While a
clip is selected it loops on its own in a strip at the top of its settings, so changes show
straight away. To swap the effect, press **Change…** beside **Effect**: it opens the same effect
chooser used to add one, playing on that light for the clip's length, with the current effect
outlined. Changing effect keeps the clip's colours, brightness and transitions.

On a matrix, the clip's preview is the grid itself, and so are the moving previews in the effect window
and the clips on the timeline (a row of little grids along each clip, each a moment of it). **Runs** picks
how a strip effect plays on it:
**Along each row** (every row the same, the default), **Down each column** (every column the same,
good for a mega-tree's strings) or **Whole matrix as one strip** (it zig-zags through the rows, so a
chase or a wipe goes round the whole grid). House patterns, such as **Stripes**, **Chequerboard**,
**Colour wave**, **Spotlight** and **Spiral**, don't need it: on a matrix's own lane they're drawn across
the grid, as they are across the house. **Spiral** winds stripes round a mega-tree and turns them
(try its **Candy cane** and **Twirl** presets); for a tree that fills up from the bottom, use **House
wipe** going **bottom to top**. **Plasma** and **Spiral** are also listed under **On a matrix** in a matrix's own
effect chooser, so you can put them on that light alone.

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

### Glitter

Under **Glitter** in the Selection panel, any clip can sparkle: drag **Amount** to the right and white
sparkles twinkle over its effect, such as a red chase with glitter on it. More means more sparkles (up to
about a quarter of the bulbs at once). **Colour** changes the sparkles, gold or icy blue, say. All the way
left is no glitter. The sparkles follow the clip's **Brightness**, and come out the same every time, so
what you see in the editor is what your lights show. Glitter stays when you change a clip's effect, and
works on the House lane and group lanes too.

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

### Finding an effect

The effect chooser groups effects into boxes (**Basics**, **Movement**, **Sparkle and festive**,
**Calm**, **Follows the music**…), each with how many there are. Along its top, **Find an effect** looks
for a name, and the chips narrow the list to effects that are like that: **Moving**, **Sparkles and
twinkles**, **Flashing**, **Steady**, **Colourful**, **Calm**, **Lively** and **Follows the music**. Tick
more than one for effects that are all of them (**Sparkles and twinkles** and **Calm** gives Flicker,
Twinkle, Candles, Snow and Fairy lights). **Clear** shows them all again; the chips you ticked are
remembered for next time. Effects made for a matrix (**On a matrix**) are only offered on a light set
up as a matrix. **Allow effects that won't work** only appears when some effects can't work on the light
you're adding to (some Govee lights' limits); on WLED and other lights where everything works, it isn't
there.

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

### Moving a stretch

To move a whole section of a show, select the stretch (drag across it, or hold **Alt** if you start
on a clip; drag up or down to take in several lights). Then either:

- **Drag it.** Press inside the selection and drag it to another light, or along to another time.
  Everything in it moves together, and with several lights selected they all move down or up together.
  A click inside the selection, without dragging, still selects the clip under the pointer.
- **Cut and paste it.** **Ctrl+X** cuts it (**Ctrl+C** copies it). Click another light's name and press
  **Ctrl+V**: it lands at the same times, so it stays in step with the music. Pasting onto the light it
  came from puts it at the playhead, and pasting onto a selected stretch puts it at that stretch's start.
  Several lights paste onto the light you clicked and the ones under it.
- **Move to.** In the Selection panel, pick a light under **Move to** and press **Move**. The effects
  keep their times. With several lights selected, the one you pick is where the top light goes.

Whatever was already there in that stretch is replaced, and effects crossing the selection's edges are
cut at them. Effects that won't work on the new light (a House effect onto a light, say) stay where they
were. WLED's own effect and Live music effects never move with a stretch. **Ctrl+Z** undoes the whole
move. **Ctrl+X** also cuts a single selected clip.

### Colour palettes

An effect's settings show the **Palette** in use, with its colours: press **Change…** to pick
another from a window of colour bars (built-in ones first, then yours, in your folders from
**Library → Palettes**: press a folder to go into it, and the heading to come back out). Click a colour to put it in
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

### Checking your shows

**✓ Check all shows**, under the list on **Library → Shows**, looks through every show without opening
them and lists what won't play as you'd expect, problems first:

- **Clips that won't show** on their light (red), or only partly show (amber), as they're marked on the
  timeline (see [Effects a light can't show](#effects-a-light-cant-show)).
- **Saved before a change to your lights, groups or house tracing**: a show plays the frames it was
  saved with, so it plays as it was then. **Fix** saves it again as things are now, without opening it.
  Shows saved after a change are fine.
- **Effects on a light you've removed**: they don't play (see below).

Each has **Open**, which opens that show. Nothing is changed unless you press **Fix**. The
[pre-show check](lights.md#pre-show-check) does the same for the shows that could play tonight.

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
