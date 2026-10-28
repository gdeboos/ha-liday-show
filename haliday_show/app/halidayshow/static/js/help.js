// The Help drawer's words: a page of topics for each part of the app, and which topic each editor
// panel's ? opens. All the in-app help lives here, so it reads the same everywhere. Tips are short
// HTML (bold for on-screen names, <kbd> for keys); the full guide on GitHub has the rest.

export const GUIDE = "https://github.com/gdeboos/ha-liday-show/blob/main/docs/guide/";

// One key, or keys pressed together ("Ctrl", "S" is Ctrl+S).
const k = (...keys) => `<kbd>${keys.join("+")}</kbd>`;

export const HELP = {
  shows: {
    title: "Your shows", guide: ["build-a-show.md", "shows"],
    topics: [
      { id: "list", title: "Your shows", tips: [
        "<b>Open</b> a show to edit it. Nothing in a show changes until you open it.",
        "<b>+ New show</b> asks for a name and a song, and with an AI set up, whether to start empty or generate it.",
        "<b>Duplicate</b> makes a copy to try ideas on, and <b>Rename</b> changes its name.",
        "<b>Remove…</b> archives a show (out of the way, kept) or deletes it for good.",
      ] },
      { id: "sharing", title: "Sharing shows", guide: ["build-a-show.md", "sharing-shows"], tips: [
        "<b>Share</b> downloads a small <code>.halidayshow</code> file with the show's effects, but not the song, your photo or your lights' addresses.",
        "<b>Import show…</b> opens a shared show and asks which of your lights plays each of its lights. It always makes a new show.",
      ] },
    ],
  },
  editor: {
    title: "Show editor", guide: ["build-a-show.md", "4-build-a-show"],
    topics: [
      { id: "show", title: "Saving and the show", guide: ["play-it.md", "saving"], tips: [
        `<b>Save</b> (${k("Ctrl", "S")}) stores the show and bakes it for playback. With <b>Auto save</b> on it saves itself a moment after each change.`,
        "<b>⚙ Show settings…</b> has the name, the show speaker, auto save and delete.",
        `<b>✨ Generate</b> fills every light with effects that follow the song. Press it again for a different take; ${k("Ctrl", "Z")} brings back what you had.`,
        "<b>← All shows</b> goes back to the list.",
      ] },
      { id: "song", title: "The song", guide: ["build-a-show.md", "songs"], tips: [
        "<b>Change…</b> picks another song from your media folder, uploads one, or makes a lights-only show.",
        "Cut, shorten or join a song in the <b>Music editor</b> before you place clips, because cutting afterwards won't move them.",
      ] },
      { id: "playback", title: "Playing while you edit", guide: ["play-it.md", "while-you-edit"], tips: [
        `${k("Space")} plays or pauses and ${k("Home")} goes back to the start.`,
        "<b>Song in this browser</b> plays the song here and streams the lights in time. Pick a speaker to hear it there instead.",
        "Turn off <b>Lights</b> to preview in the browser only. If the lights lead or lag, set <b>Light offset</b> under <b>Setup → Speakers</b>.",
        "Drag along the time ruler to set a play region, and turn on <b>Loop</b> to repeat it.",
      ] },
      { id: "beats", title: "Beats and sections", guide: ["build-a-show.md", "beats"], tips: [
        "<b>Detect</b> finds the tempo, beats, bars and sections in your browser, in a few seconds.",
        "<b>From song</b> uses the beats and sections saved with the song in the Music editor.",
        `Press ${k("B")} or <b>Tap beat</b> in time while it plays, or type a <b>BPM</b> and press <b>Fill</b>.`,
        `Click the beat lane to add or remove a beat. With <b>Snap</b> on, clips snap to beats; hold ${k("Shift")} to place freely.`,
      ] },
      { id: "ai", title: "Describe it", guide: ["build-a-show.md", "describe-it"], tips: [
        "Type what you'd like, such as \"red and green chase on the roof in every chorus\", and press <b>✨ Create</b>.",
        `Select a stretch first to work on just that. ${k("Ctrl", "Z")} undoes the lot.`,
        "It needs an AI, set up under <b>Setup → Settings → AI</b>.",
      ] },
      { id: "preview", title: "Preview and House", guide: ["house.md", "3-your-house"], tips: [
        "<b>Preview</b> shows each light's LEDs (or a Govee light's segments) as they'll look at the playhead.",
        "<b>House</b> plays the show on your house photo. Trace your lights on it under <b>Setup → House</b>.",
      ] },
      { id: "timeline", title: "The timeline", guide: ["build-a-show.md", "the-timeline"], tips: [
        "Drag across a light, or the <b>House</b> lane, to select a stretch of time. Drag up or down to cover several lights.",
        "Click a clip to edit it: drag it to move, drag its edges to resize.",
        `Zoom with <b>−</b> and <b>+</b>, the ${k("+")} and ${k("−")} keys, or ${k("Ctrl")} + wheel round the pointer.`,
        "With lots of lights, the wheel over the names scrolls through them. The times, song and beats stay at the top.",
        "Click a light's name to copy or recolour all its effects.",
        "<b>▸</b> before <b>House</b> folds the group lanes away; before a split light, its parts.",
        "Coloured flags on the beat lane are the song's marks, made in the Music editor. Clips snap to them.",
        "A group's lane, under <b>House</b>, plays its effects along the group's lights as one strip, or House effects across just those lights.",
      ] },
      { id: "selection", title: "Adding and changing effects", guide: ["build-a-show.md", "adding-effects"], tips: [
        "Select a stretch, then press <b>＋ Add effect…</b> to pick one. Each button plays it on that light first.",
        "Click a clip to change its effect, colours and settings here. It loops on its own while it's selected.",
        `${k("D")} duplicates, ${k("Ctrl", "C")} and ${k("Ctrl", "V")} copy and paste, and ${k("Ctrl", "Z")} undoes.`,
        `${k("Delete")} clears the selected stretch or clip. Hold ${k("Alt")} to start a selection on top of a clip.`,
        "<b>⚠ Too fast for this light</b> means the real light can't keep up with that effect. Slow it down or use a fade.",
      ] },
      { id: "keys", title: "Keyboard", guide: ["build-a-show.md", "shortcuts"], keys: [
        [k("Space"), "Play or pause"], [k("Home"), "Back to the start"], [k("B"), "Add a beat at the playhead"],
        [k("Delete"), "Delete the clip, or clear the stretch"], [k("D"), "Duplicate the clip"], [k("Esc"), "Deselect"],
        [`${k("Ctrl", "C")} ${k("Ctrl", "V")}`, "Copy and paste effects"], [`${k("Ctrl", "Z")}`, "Undo"], [k("Ctrl", "S"), "Save"],
        [`${k("+")} ${k("−")}`, "Zoom in and out"], [`${k("Shift")} drag`, "Place without snapping"],
      ] },
    ],
    panels: { show: "show", song: "song", playback: "playback", beats: "beats", ai: "ai", preview: "preview", house: "preview",
      timeline: "timeline", inspector: "selection" },
  },
  songs: {
    title: "Your songs", guide: ["build-a-show.md", "songs"],
    topics: [
      { id: "list", title: "Your songs", tips: [
        "Each song you added is one card marked <b>Original</b>. The edits made from it in the Music editor sit inside it.",
        "<b>Edit</b> opens a song in the Music editor. The song you open is never changed.",
        "<b>+ Add a song</b> uploads one, and can <b>Detect</b> its beats and sections straight away.",
        "<b>All</b>, <b>Originals</b>, <b>Edits</b> and <b>Drafts</b> narrow the list, and <b>Find</b> searches names, folders and shows.",
      ] },
      { id: "folders", title: "Folders", tips: [
        "<b>+ New folder</b> makes a folder to sort songs into. The files stay where they are.",
        "Pick a folder under <b>Folder</b> on a song to move it there. Click a folder's name to fold it away.",
      ] },
      { id: "remove", title: "Archiving and deleting", guide: ["build-a-show.md", "archiving-and-deleting"], tips: [
        "<b>Remove…</b> says where a song is used, then archives it (kept, out of the way) or deletes it for good.",
        "Archived songs are folded at the foot of the list, with <b>Restore</b>.",
      ] },
    ],
  },
  music: {
    title: "Music editor", guide: ["build-a-show.md", "editing-a-song"],
    topics: [
      { id: "song", title: "Drafts and Make song file", guide: ["build-a-show.md", "drafts"], tips: [
        "Your first change starts a draft (name it under <b>Draft</b>), kept as you go, so you can leave and carry on later. The song you opened isn't changed.",
        `<b>Make song file</b> (${k("Ctrl", "S")}) writes the draft as a WAV in your songs folder, to pick under <b>Song</b> in a show.`,
        "The draft stays, so you can change it and make the file again.",
      ] },
      { id: "playback", title: "Playing", tips: [
        `<b>▶ Play</b> (${k("Space")}) plays from the playhead, and <b>Play selection</b> just the selection.`,
        `<b>⏮</b> (${k("Home")}) goes back to the start. <b>⏪</b> and <b>⏩</b> (${k(",")} and ${k(".")}) go back or on a bar, or 5 seconds before the song is detected, and keep playing if it was.`,
        "The 🔊 slider is the same level as in the Show editor.",
      ] },
      { id: "wave", title: "The waveform and Mixer", guide: ["build-a-show.md", "layers"], tips: [
        `Drag across the waveform to select. The edges snap to bars once the song is detected; hold ${k("Shift")} to place them freely.`,
        `Click to move the playhead. The wheel zooms, and ${k("Shift")} + wheel scrolls.`,
        "<b>+ Add layer</b> plays samples or songs over this one: pick one under the layer to put a clip at the playhead.",
        `Each clip shows its own waveform and sections. <b>✂ Split at playhead</b> (or ${k("S")}) cuts a clip in two, to keep just the parts you want.`,
        "<b>EQ</b> opens a row's <b>Bass</b>, <b>Mid</b> and <b>Treble</b> in <b>Selection</b>. <b>Match tempo</b> keeps a layer in time with the song.",
      ] },
      { id: "selection", title: "Changing what you clicked", tips: [
        "Click a section, a ⚑ mark, a clip on a layer or a ✂ join, and change it in the <b>Selection</b> panel.",
        "<b>+ Change here</b> in the EQ makes the faders glide to new settings from the playhead.",
        "Click a <b>✂</b> to hear that join. <b>Adjust cut</b> brings the part back, selected, to cut again; <b>Put back</b> undoes just that cut.",
      ] },
      { id: "beats", title: "Sections and marks", guide: ["build-a-show.md", "editing-sections"], tips: [
        "<b>Detect</b> finds the beats and sections and keeps them with the song, so a show that picks it gets them straight away.",
        "Click a section to rename it, colour it or give it notes for <b>Describe it</b>. Shift-click adds the next one; drag the line between two to move it.",
        `<b>⚑ Add mark</b> (or ${k("M")}, even while it plays) flags a moment. Marks show in the Show editor too, where clips snap to them.`,
        "<b>✨ Describe sections</b> writes notes for each section from what it sounds like.",
      ] },
      { id: "edit", title: "Cutting and shortening", guide: ["build-a-show.md", "suggest-cuts"], tips: [
        "<b>Preview cut</b> plays the join as if the selection were cut. <b>Cut selection</b> removes it, and <b>Keep only selection</b> shortens the song to it.",
        "<b>✂ Suggest cuts…</b> finds whole bars to take out where the join won't be heard. It needs the song detected first.",
        "<b>Save as sample…</b> keeps the selection in <b>Library → Samples</b>, to layer over songs.",
      ] },
      { id: "splice", title: "Splicing and smoothing", tips: [
        "<b>Insert at playhead</b> and <b>Add to end</b> splice in another song, which is then selected so you can trim it.",
        "<b>Crossfade at joins</b> blends the parts: a few hundredths of a second hides the click, a few seconds blends one song into the next.",
        "<b>Fade in</b> and <b>Fade out</b> soften the ends.",
      ] },
      { id: "keys", title: "Keyboard", keys: [
        [k("Space"), "Play or pause"], [k("Home"), "Back to the start"], [`${k(",")} ${k(".")}`, "Back or on a bar"],
        [k("Delete"), "Cut the selection"], [k("M"), "Add a mark, even while playing"], [k("S"), "Split the layer clip at the playhead"],
        [k("Ctrl", "Z"), "Undo"], [k("Ctrl", "S"), "Make song file"], [k("Esc"), "Clear the selection"],
        [`${k("←")} ${k("→")}`, "Move a beat at a time (with the waveform outlined)"],
      ] },
    ],
    panels: { song: "song", playback: "playback", wave: "wave", selection: "selection", beats: "beats", edit: "edit",
      splice: "splice", smoothing: "splice" },
  },
  samples: {
    title: "Samples", guide: ["build-a-show.md", "samples"],
    topics: [
      { id: "list", title: "Samples", tips: [
        "Short sounds such as sleigh bells or a \"ho ho ho\", ready to layer over a song in the Music editor.",
        "<b>+ Add a sample</b> uploads files, or select a stretch in the Music editor and press <b>Save as sample…</b>.",
        "<b>▶</b> plays one and <b>Delete…</b> removes it for good.",
      ] },
    ],
  },
  palettes: {
    title: "Palettes", guide: ["build-a-show.md", "colour-palettes"],
    topics: [
      { id: "list", title: "Palettes", tips: [
        "<b>Edit…</b> opens a palette to rename it and change its colours, up to 12.",
        "<b>+ New palette</b>, or <b>Copy…</b> on a built-in one, starts a new one.",
        "Describe some colours, such as \"frosty winter night\", and press <b>✨ Make palettes</b> (it needs an AI).",
        "In an effect's settings, click a palette colour to use it, or <b>Apply palette</b> to fill them all.",
      ] },
    ],
  },
  presets: {
    title: "Presets", guide: ["build-a-show.md", "the-presets-tab"],
    topics: [
      { id: "list", title: "Presets", tips: [
        "Your presets, by effect, each with a live preview. <b>Edit…</b> opens one with a bigger preview.",
        "<b>+ New preset</b> starts from any effect or built-in preset.",
        "Describe a look, such as \"slow icy shimmer\", and press <b>✨ Make presets</b> (it needs an AI).",
      ] },
    ],
  },
  scenes: {
    title: "Your scenes", guide: ["play-it.md", "scenes"],
    topics: [
      { id: "list", title: "Your scenes", tips: [
        "A scene sets every light at once and plays until you choose something else, like a one-tap scene in the Govee app.",
        "<b>▶ Play</b> puts it on your lights; <b>■ Stop</b> turns it off. <b>Edit</b> changes it.",
        "A show or playlist takes the lights over, then the scene comes back once it's finished.",
      ] },
    ],
  },
  scene: {
    title: "Scene editor", guide: ["play-it.md", "scenes"],
    topics: [
      { id: "lights", title: "Lights", tips: [
        "Each light has its own row: pick an <b>Effect</b> (or <b>Off</b>), a <b>Style</b>, <b>Colours</b>, <b>Speed</b> and <b>Brightness</b>.",
        "<b>Same for every light</b> puts one row in charge of all of them.",
        "Changes save as you make them, and the <b>Preview</b> shows the scene on your house photo.",
      ] },
      { id: "play", title: "Playing it", tips: [
        "<b>▶ Play on lights</b> plays it round and round on your real lights. Change it while it plays and the lights follow.",
        "<b>← All scenes</b> goes back to the list.",
      ] },
      { id: "when", title: "When it plays", tips: [
        "Turn on <b>Comes on by itself on a schedule</b> and pick the times and days, as for a playlist. A start can be at sunset.",
        "If a show or playlist is on at the start, the scene waits for it, then comes on. At the end it goes off.",
      ] },
      { id: "advanced", title: "Advanced", tips: [
        "<b>Advanced</b> opens the scene in the Show editor, so effects can change over time and use the <b>House</b> lane.",
        "The timeline is one time round: set how long under <b>Goes round every</b>.",
        "<b>Switch to Basic</b> comes back here while each light has one effect across the whole loop.",
      ] },
    ],
  },
  playlists: {
    title: "Your playlists", guide: ["play-it.md", "playlists"],
    topics: [
      { id: "list", title: "Your playlists", tips: [
        "A playlist plays your shows one after another, then starts again from the top until you press <b>Stop</b>, even with this page closed.",
        "<b>Open</b> one to put shows in it and set when it plays, or press <b>+ New playlist</b>.",
      ] },
    ],
  },
  playlist: {
    title: "Playlist editor", guide: ["play-it.md", "playlists"],
    topics: [
      { id: "playlist", title: "The playlist", tips: [
        "Type over the name to rename it. Changes save as you make them.",
        "<b>▶ Play</b> starts it now. <b>Delete playlist</b> removes it but keeps its shows.",
        "Each show plays on its own <b>Show speaker</b>, as when an automation starts it.",
      ] },
      { id: "order", title: "Running order", tips: [
        "Drag shows and blocks into the order, and up or down to change when they play. A blue line shows where one will land.",
        "Drag one out, or press <b>✕</b>, to take it out. <b>↑</b> and <b>↓</b> move it with a press.",
        "On a phone or tablet, drag by the dots (⠿) so the page still scrolls.",
        "The coloured bar shows one time through, and its total length is next to the title.",
      ] },
      { id: "shows", title: "Shows and building blocks", tips: [
        "Drag a show from <b>Your shows</b>, or press <b>+</b> to add it at the end. The same show can go in more than once.",
        "<b>Building blocks</b> go between shows: a <b>Pause</b>, one <b>Colour</b>, <b>Off</b>, an <b>Effect</b> or one of your <b>Scenes</b>, each with its own length.",
      ] },
      { id: "when", title: "When it plays", guide: ["play-it.md", "playlists"], tips: [
        "Turn on <b>Play on a schedule</b> and pick the times and days. A start time can be at sunset.",
        "<b>Only between</b> limits it to some dates, such as December.",
        "For shows with no speaker, open the <b>Show player</b> on a computer with speakers and leave it open.",
      ] },
    ],
    panels: { playlist: "playlist", blocks: "shows", shows: "shows", order: "order", when: "when" },
  },
  devices: {
    title: "Devices", guide: ["lights.md", "1-devices"],
    topics: [
      { id: "add", title: "Adding lights", tips: [
        "Press <b>+ Add a light</b>, pick what you're adding, and fill in what it needs.",
        "For a Govee light, switch on <b>LAN Control</b> in the Govee Home app first, then <b>Scan network</b>.",
        "<b>Plan a light</b> lets you build shows for one that hasn't arrived yet.",
      ] },
      { id: "list", title: "Your lights", tips: [
        "<b>Test</b> on a line tests the real light. Press anywhere else on the line to open its settings.",
        "Drag a light by its ⠿ handle to change the order every show and the house use.",
        "<b>Split into parts…</b> in a light's window gives different stretches their own effects.",
      ] },
      { id: "groups", title: "Groups", guide: ["lights.md", "light-groups"], tips: [
        "<b>+ New group</b> puts lights and parts together, such as the roof's icicles, so a show can give them one effect.",
        "Each group gets a lane under <b>House</b> in the Show editor. Effects run along its lights in this tab's order.",
        "<b>↑</b> and <b>↓</b> set the order of the groups' lanes. A light can be in as many groups as you like.",
      ] },
    ],
  },
  speakers: {
    title: "Speakers", guide: ["speakers.md", "2-speakers"],
    topics: [
      { id: "add", title: "Adding a speaker", tips: [
        "Press <b>+ Add a speaker</b>, then <b>Test and add</b>. It plays a short chime the way a show starts, and the speaker is added only if that works.",
        "Some media players, like Echo devices through Alexa Media Player or Emby clients, can't play files from Home Assistant's media folder.",
      ] },
      { id: "timing", title: "Timing", guide: ["speakers.md", "2-speakers"], tips: [
        "<b>Delay ms</b> is how late a speaker really starts. Raise it if the lights run ahead of the music (often 100 to 500 ms for Wi-Fi speakers).",
        "<b>Light offset</b> does the same for the song playing in your browser.",
      ] },
      { id: "automations", title: "Automations", guide: ["automations.md", "6-automations"], tips: [
        "<b>Automations</b> shows the exact input to start the open show from a Home Assistant automation.",
      ] },
    ],
  },
  house: {
    title: "House", guide: ["house.md", "tracing-a-light"],
    topics: [
      { id: "trace", title: "Tracing your lights", tips: [
        "Take the photo from where people will watch, ideally at dusk, and press <b>Upload photo</b>. <b>Darken</b> makes the lights stand out.",
        "Pick a light, press <b>Trace</b> and click along where it runs, <b>starting at the end with the plug</b>. Click once at each corner or bend.",
        "Press <b>Done</b> (or Enter). Drag a point to move it and right-click one to remove it.",
        "A picked light is drawn as a rainbow from red at the plug, so you can check its direction.",
      ] },
      { id: "out", title: "Parts you can't see", guide: ["house.md", "parts-you-cant-see"], tips: [
        "Trace past a stretch round the back of the house anyway (a short line will do), then click it and choose <b>Out of view</b> with how many bulbs are on it.",
      ] },
      { id: "styles", title: "Light styles", guide: ["house.md", "light-styles"], tips: [
        "<b>Line</b> for strips and string lights, <b>Icicle</b> for icicle lights (set <b>Drops</b> and <b>Length</b>), and <b>Spots</b> for spotlights.",
      ] },
    ],
  },
  settings: {
    title: "Settings", guide: ["editor-and-settings.md", "settings"],
    topics: [
      { id: "layout", title: "Layout", guide: ["editor-and-settings.md", "arrange-the-editor"], tips: [
        "Pick <b>Show</b>, <b>Music</b> or <b>Playlist</b>, then that editor's page layout and where each panel sits.",
        "Choose <b>Hidden</b> to tuck a panel away, and bring it back here.",
        "In the editors you can also drag a panel by its title, or use its <b>⋯</b> button.",
      ] },
      { id: "ai", title: "The AI", guide: ["editor-and-settings.md", "setting-up-the-ai"], tips: [
        "The ✨ features use Claude with your own API key, or an AI Task set up in Home Assistant, including a local one.",
      ] },
      { id: "live", title: "Live music", guide: ["play-it.md", "live-music"], tips: [
        "Shows what a WLED light with a microphone hears, once that WLED is set to send its sound.",
        "<b>Listen to</b> picks the WLED; with <b>Any WLED that sends sound</b>, the loudest one is used.",
        "<b>Counts as music from</b> sets how loud is music rather than chatter.",
      ] },
      { id: "data", title: "Your data", tips: [
        "<b>Export…</b> saves your lights, shows, palettes, presets, settings and house photo in one file. Songs aren't in it.",
        "Before an import or a fresh start, a copy of what you had is kept here, so you can put it back.",
      ] },
    ],
  },
  labs: {
    title: "Labs", guide: ["labs.md", "packet-lab"],
    topics: [
      { id: "lab", title: "Packet lab", tips: [
        "Sends hand-made commands to a Govee light, for working out new ways to drive it.",
        "Paste each command on its own line.",
      ] },
    ],
  },
  public: {
    title: "Public page", guide: ["public-page.md", "the-public-page"],
    topics: [
      { id: "start", title: "Getting it going", tips: [
        "Under <b>What visitors can pick</b>, choose a show or playlist next to <b>+ Add</b> and press it.",
        "Open the <b>Visitors' link</b> on your phone, on your home Wi-Fi, to try it. Print the QR code for a sign outside.",
        "<b>Opening hours</b> and <b>Nearby only</b> limit when and where visitors can start shows.",
      ] },
      { id: "look", title: "How the page looks", tips: [
        "Change the words, the picture at the top, the colours and the link at the bottom. The <b>Preview</b> follows every change.",
      ] },
    ],
  },
};

// Pages that show the same help: the editors' lists are the Library's pages.
const SAME = { showlist: "shows", songlist: "songs", playlistlist: "playlists", scenelist: "scenes" };
export const helpPageFor = (view) => (HELP[SAME[view] || view] ? SAME[view] || view : null);

export const guideUrl = ([file, anchor]) => `${GUIDE}${file}${anchor ? `#${anchor}` : ""}`;

// A topic's link into the guide: its own, else its page's.
export const topicGuide = (page, topic) => guideUrl(topic.guide || HELP[page].guide);

// The topic a panel's ? opens, and the first few of its tips for the quick bubble.
export function panelHelp(page, panel, n = 4) {
  const p = HELP[page];
  const topic = p?.topics.find((t) => t.id === p.panels?.[panel]);
  if (!topic) return null;
  const all = topic.tips || [];
  return { topic, tips: all.slice(0, n), total: all.length };
}

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").toLowerCase();

// Every topic whose title or words have all the words searched for, the page you're on first.
export function searchHelp(query, here = null) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const [page, p] of Object.entries(HELP)) {
    for (const topic of p.topics) {
      const text = plain([topic.title, ...(topic.tips || []), ...(topic.keys || []).flat()].join(" "));
      if (words.every((w) => text.includes(w))) out.push({ page, topic });
    }
  }
  return out.sort((a, b) => (b.page === here) - (a.page === here));
}
