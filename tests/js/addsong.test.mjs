import test from "node:test";
import assert from "node:assert/strict";
import { addedMessage, detectChoices, isAudioName, nameFromFile, nameTaken, savedName } from "../../haliday_show/app/halidayshow/static/js/addsong.js";

test("names come from the file and are saved with its extension, cleaned like the server", () => {
  assert.equal(nameFromFile("Carol of the Bells.MP3"), "Carol of the Bells");
  assert.equal(savedName("Carol of the Bells", "x.MP3"), "Carol of the Bells.mp3");
  assert.equal(savedName("Rock/Roll: live", "a.wav"), "Rock_Roll_ live.wav");
  assert.equal(savedName(" .Intro ", "a.ogg"), "Intro.ogg");
  assert.equal(savedName("Noël", "a.mp3"), "Noël.mp3");
  assert.equal(savedName("Noe\u0308l", "a.mp3"), "Noe_l.mp3");
  assert.ok(isAudioName("song.flac"));
  assert.ok(!isAudioName("notes.txt"));
});

test("nameTaken only looks in the uploads folder and ignores case", () => {
  const paths = ["haliday_show/Jingle Bells.mp3", "Music/Carol.mp3"];
  assert.ok(nameTaken("jingle bells.mp3", paths));
  assert.ok(!nameTaken("Carol.mp3", paths));
});

test("addedMessage says what detecting found", () => {
  assert.match(addedMessage("Carol", null), /Detect it/);
  assert.equal(addedMessage("Carol", { tempo: 120.4, beats: [1, 2], sections: [{}] }), "Carol added: 120 BPM, 2 beats and 1 part");
  assert.equal(addedMessage("Carol", { tempo: null, beats: [], sections: [{}, {}] }), "Carol added: no steady beat, 2 parts");
});

test("detectChoices offers the AI first only when one is set up", () => {
  assert.deepEqual(detectChoices(true).map((c) => c.value), ["ai", "detect", "later"]);
  assert.deepEqual(detectChoices(false).map((c) => c.value), ["detect", "later"]);
  assert.match(detectChoices(false)[0].label, /recommended/);
  assert.match(addedMessage("Carol", { tempo: 100, beats: [1], sections: [{}] }, { ai: true }), /AI is naming/);
});
