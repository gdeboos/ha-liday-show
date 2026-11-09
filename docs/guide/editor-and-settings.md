<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# The editor, settings and your data

[← Automations](automations.md) · [Contents](README.md) · [Labs and experiments →](labs.md)

## Arrange the editor

The Show, Music and Playlist editors are all made of panels you can arrange, and each editor keeps its
own arrangement:

| Editor | Panels | Can't be hidden |
| --- | --- | --- |
| Show | Show, Song, Playback, Beats, Describe it, Preview, House, Timeline and Selection | Timeline |
| Music | Song (with **Make song file**), Playback, Waveform (with the **Mixer**), Selection, Beats and sections, Edit, Add another song and Smoothing | Waveform |
| Playlist | Playlist (its name, **▶ Play** and **Delete playlist**), Building blocks, Your shows, Running order and When it plays (what the schedule does with it) | Running order |

The Music editor's **Selection** panel is where you change whatever you clicked: a section, a ⚑ mark, a
clip on a layer or a ✂ join, and the **EQ** faders. If it's folded, clicking one opens it; if you've
hidden it, bring it back to use them.

Drag any editor panel by its
title to move it to the top, left, middle, right or bottom, or to change its order there; a blue
bar shows where it will land. The **⋯** button in its corner does the same from a menu: it shows a
small picture of the page, so click the area you want the panel in. **Earlier** and **Later**
change its order, which also works on a touch screen. Any panel except the Timeline can be
**Hidden**. To keep a panel to hand but out of the way, press the **▾** before its name to
collapse it to its title, and **▸** to open it again. On a phone, some panels start collapsed so the
main one is near the top: **Preview** and **House** in the Show editor, **Add another song** and **Smoothing** in
the Music editor, and **Building blocks** in the Playlist editor. Open them with **▸** whenever you want
them.

Each editor panel has a **?** beside its **⋯**: it shows a few tips for that panel, and **More in Help →**
opens the rest in the **Help** drawer (see [Help](getting-started.md#help)).

The **page layout** sets how those five areas fit together. Pick it at the bottom of any panel's
**⋯** menu or under **Settings → Layout** (each editor has its own):

| Page layout | Arrangement |
| --- | --- |
| Classic | Top and bottom run the full width; left, middle and right sit side by side between them. |
| Side columns | Left and right run the full height of the page, with top, middle and bottom stacked between them. |
| Right column | Right runs the full height; top and bottom span the left and middle. Handy for keeping Selection beside everything. |

Out of the box, in the Show editor, the Show and Playback panels run along the top, Song, Preview, House and Beats sit
down the left, Selection and Describe it down the right, and the Timeline takes the middle, so the
timeline and the selected clip are on screen together. The Music editor starts with Song and Playback
along the top, the waveform in the middle with Selection beside it, and the other panels along the
bottom; the Playlist editor with Building blocks and Your shows down the left, the running order in the
middle and When it plays along the bottom. Each editor's **Reset** button under **Settings → Layout**
goes back to these. While the top area is
short enough, it stays in view as you scroll, so **Play** is always to hand.

An area with no panels in it takes no space. On a narrow screen every area stacks in one column. With Selection hidden, clips can still be moved, resized, copied and
deleted on the timeline, but adding or editing effects needs it back. The layout is saved in your
browser, so each computer or phone keeps its own.

## Settings

The rest of **Setup** is in its own tabs, one subject each. Timing and Automations sit with the speakers, under **Setup →
Speakers**: **Light offset** for playing in the browser (positive values delay the lights), or the
picked speaker's delay, and the exact `hassio.app_stdin` input for the open show.

| Tab | What's there |
| --- | --- |
| **Editors** | Pick **Show**, **Music** or **Playlist**, then that editor's page layout, where every panel sits (including hidden ones) and its **Reset** button. |
| **Live music** | What a WLED with a microphone hears (see [Live music](play-it.md#live-music)). |
| **AI** | Which AI the ✨ features use (**Describe it**, Generate's **AI** option and the rest), or how to set one up (see [Setting up the AI](#setting-up-the-ai)). |
| **Your data** | **Export…**, **Import…** and **Start afresh…**, and the copies kept before an import or a fresh start (see [Your data](#your-data)). |
| **More** | **Public page**: **Let visitors start shows**, which adds the **Public page** tab (see [The public page](public-page.md#the-public-page)). **Setup guide**: **Run the setup guide**, the step-by-step window that opens on a fresh install (see [Quick start](getting-started.md#quick-start)). **Demo**: **Try the demo** on a fresh install, or **Remove the demo** (see [The demo](getting-started.md#the-demo)). **Experimental**: **Show the Labs tab**. |

**Labs** is a tab under **Setup** for working out new ways to drive Govee lights. It's hidden until you
turn on **Show the Labs tab** under **More → Experimental**; that's saved in this browser, so each computer or
phone has its own. It holds:

| Section | What's there |
| --- | --- |
| Packet lab | Sends hand-made messages to one Govee light, for trying out new ways of driving it (below). |
| Listen for Govee traffic | Records what your Govee lights say to each other, to help support new ways of driving them (below). |

## Your data

**Setup → Your data** puts everything HA-liday Show saves in one file, and back:

- **Export…** downloads a `.zip` of your lights (with their parts and groups), shows (archived ones
  too), scenes, palettes, presets, playlists, the schedule, settings (the public page's and your
  song folders and your Library folders too), the Music editor's drafts, what **Detect** found in each song and your notes on it, the house photo and where each light is traced
  on it, and the public page's own picture. Your songs stay in your songs folder and aren't in it.
  It's the same on every install, so you can move your shows to another Home Assistant, or between
  HA-liday Show and a Docker or pipx install.
- **Import…** replaces all of that with what's in an exported file. A file that isn't an HA-liday Show
  export is refused and nothing changes.
- **Start afresh…** removes it all, so HA-liday Show is like new and the setup guide opens. It also resets
  this browser's layout and choices (like **Show the Labs tab**). Your songs are kept.

Before an import, a fresh start or deleting a show or song for good, HA-liday Show keeps a copy of what
you had, listed under **Your data**
(the newest five). **Put back** restores one, and **Download** saves it as an export. So to try the
setup guide without losing anything: **Start afresh…**, try it, then **Put back** the copy *Before a
fresh start* (or **Import…** your export).

Home Assistant's own backups include all of this too, as the app's config folder.

## Moving from Govee Light Show

This app used to be called **Govee Light Show**. Home Assistant treats the renamed app as a new
one, so you install **HA-liday Show** alongside the old one:

1. Stop **Govee Light Show**, so only one app drives your lights.
2. Install **HA-liday Show** and start it. The first time it starts, it copies your shows, lights,
   palettes, presets, settings, house photo and songs across from the old app. The old app's
   copy isn't changed.
3. In **HA-liday Show**'s **Configuration** tab, paste your **Claude API key** again if you use one,
   and turn on **Show in sidebar** and **Start on boot**.
4. If you use MQTT, the old **Govee Light Show** entities are removed and new **HA-liday Show** ones
   appear (for example `select.ha_liday_show_show`). Point your automations at the new ones, and
   change the app in any `hassio.app_stdin` (or older `hassio.addon_stdin`) action to **HA-liday Show**.
5. Once your shows play as before, uninstall **Govee Light Show**. Your songs stay in
   `/media/govee_show` until you delete them; the new app uses its own copies in
   `/media/haliday_show`.

The copy only happens once, and only if **HA-liday Show** has no lights or shows of its own yet.

## Setting up the AI

HA-liday Show uses AI in two places, and **Setup → AI** shows both: what each feature uses, where it
runs and whether it's ready. Nothing needs AI: without it, everything still works from simple rules.

**In this browser.** These run on your computer, free, and your songs never leave the house:

| Feature | Model |
|---|---|
| [Split into parts](build-a-show.md#split-into-parts) (vocals, drums, bass and the rest) | 126 MB |
| Sounds in a song (bells, a choir, brass…) | 16 MB |
| [Line up with the singing](effects.md#lyrics-for-a-singing-face) | 95 MB |
| Section notes (optional, see below) | 1.2 GB |

Each model is downloaded the first time it's used and kept by your browser. To have them ready ahead of
time, press **Download** on a row, or **Download all models**; a row shows **✓ Downloaded** once your browser
has it, and the card at the top says how many it has. **Remove them from this browser** frees the space
(they're downloaded again when next used). A browser can only keep them when HA-liday Show is open over
https (as it is through Home Assistant's own address). Otherwise each is downloaded when it's used, and
the rows say so.

**Claude or Home Assistant's AI.** **Describe it**, **✨ Generate my show** with the AI's ideas, section
names, song colours, **✨ Make presets**, **✨ Make palettes** and the AI's pick of
[suggested cuts](build-a-show.md#suggest-cuts) need one of these:

- **Claude, with your own API key.** Create a key at console.anthropic.com, then in Home Assistant open
  **Settings → Apps → HA-liday Show → Configuration**, paste it into **Claude API key** and save.
  Each request costs a few US cents on your Anthropic account (it uses Claude Opus 5.5 at low effort).
- **Home Assistant's AI Task**, which uses whichever AI integration you've set up there with an AI Task
  entity: Anthropic, OpenAI, Google Gemini, or a local model through Ollama, which keeps everything on
  your network. If you have several, set **AI Task entity** on the Configuration tab, or Home Assistant's
  preferred one is used. Smaller local models may follow the instructions less well.

With a key and no AI Task, Claude is used; with only an AI Task, Home Assistant's. With both, **Use**
under **Claude or Home Assistant's AI** picks which (Claude, unless you change it). The AI is sent your
lights' names and segment counts, the effect list, the song's tempo, beats and sections, your palettes,
the selection and the effects already on the lights (for suggested cuts: the song's name, sections, notes
and marks, and the cuts found). It's never sent the song itself.

### Section notes on this device

The section notes that **Detect** and **✨ Describe sections** write can come from a small AI model that
runs in your browser instead, so nothing about your songs leaves the house and there's nothing to pay.
Under **Setup → AI**, on the **Section notes** row, press **Download** (1.2 GB). It's a one-off download
(HA-liday Show fetches it and checks it, then your browser keeps it), and it needs a recent browser and
graphics chip: Chrome or Edge on a computer. The row says if yours can't run it, and **Remove** frees the
space again.

The picker on that row chooses which writes them when both are there: **This browser** (the default,
once the model is downloaded in this browser) or **Claude or HA's AI**. The model writes the notes one
section at a time from what was found in each; it doesn't rename sections, which only Claude or Home
Assistant does. The first time in a session it takes a little while to load. Without the model or an AI,
the notes are written from simple rules.
While it downloads, HA-liday Show keeps its own copy in its temporary folder until it next restarts, so
the Home Assistant machine needs about 1.2 GB free for a while.

---

[← Automations](automations.md) · [Contents](README.md) · [Labs and experiments →](labs.md)
