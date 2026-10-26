// The New show window: a name and a song, then how the show starts. The choices are worked out
// here, without the page, so they can be tested; app.js draws the window.

// `base` if no show has that name yet, otherwise "base 2", "base 3"… (names are compared ignoring case).
export function freeName(base, taken) {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  const name = base.trim() || "Untitled show";
  if (!names.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!names.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

// How a new show can start. Generating needs a song and some lights; the AI also needs to be set up,
// and is left out entirely when it isn't, as it is in the Generate window.
export function startChoices({ song, lights, ai }) {
  const why = !lights ? "Add your lights under Setup → Devices first." : !song ? "Pick a song in step 1 first." : "";
  const choices = [
    { value: "empty", label: "Start empty", detail: "An empty timeline: you add the effects yourself." },
    { value: "rules", label: "Generate a first draft",
      detail: "Effects on every light that follow the song's beats and parts, made straight away.", why },
  ];
  if (ai) {
    choices.push({ value: "ai", label: "Generate with AI",
      detail: "The AI makes the whole show, following any notes on the song's parts. Takes up to a minute.", why });
  }
  return choices.map((c) => ({ ...c, disabled: Boolean(c.why) }));
}
