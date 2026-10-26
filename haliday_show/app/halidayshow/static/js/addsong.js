// The Add a song window (Library → Songs): pick a file and name it, then detect it straight away or
// leave it. Worked out here, without the page, so it can be tested; app.js draws the window.

const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"];
const extOf = (name) => (/\.[^./\\]+$/.exec(name)?.[0] || "").toLowerCase();

export const isAudioName = (name) => AUDIO_EXT.includes(extOf(name));

// The name a file is offered under: its own, without the extension.
export const nameFromFile = (fileName) => fileName.replace(/\.[^.]+$/, "").trim();

// The file name it's saved as, cleaned the way the server cleans it (storage.upload_path), so we can
// tell beforehand whether it would replace a song that's already there.
export function savedName(name, fileName) {
  // Python's \w takes letters and digits in any alphabet, so "Noël" stays as it is.
  return `${name.trim()}${extOf(fileName)}`.replace(/[^\p{L}\p{N}\p{M}_ .()-]+/gu, "_").replace(/^[ .]+|[ .]+$/g, "");
}

// Uploads go in the haliday_show folder; `paths` are the songs listed, as "haliday_show/Song.mp3".
export function nameTaken(saved, paths) {
  const want = `haliday_show/${saved}`.toLowerCase();
  return paths.some((p) => p.toLowerCase() === want);
}

// What the top bar says once it's added.
export function addedMessage(name, info) {
  if (!info) return `${name} added. Detect it in the Music editor when you're ready`;
  const parts = `${info.sections.length} part${info.sections.length === 1 ? "" : "s"}`;
  return info.tempo ? `${name} added: ${Math.round(info.tempo)} BPM, ${info.beats.length} beats and ${parts}`
    : `${name} added: no steady beat, ${parts}`;
}
