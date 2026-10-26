// Setup → Settings → Public page: the words around the settings, kept apart so they can be tested.

const mins = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return `${m} min`;
};

// Where to try the public page on your home Wi-Fi, from the address you open HA-liday Show on.
export function addressText(view, hostname) {
  if (view.error) return `The public page couldn't start: ${view.error}. Pick another port on the app's Configuration tab.`;
  if (!view.listening) return `The public page opens on port ${view.port} the first time you change a setting here.`;
  const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /\.(local|lan|home|internal)$/.test(hostname)
    || !hostname.includes(".");
  const url = `http://${local ? hostname : "<your Home Assistant's address>"}:${view.port}`;
  return `The public page is on port ${view.port}. To try it on your phone over your home Wi-Fi, open ${url}`;
}

// What visitors have asked for.
export function queueText(view) {
  const parts = [];
  if (view.now) parts.push(`A visitor's show is on now: ${view.now}.`);
  if (view.waiting.length) {
    parts.push(`Waiting: ${view.waiting.map((w) => `${w.name} (in about ${mins(w.wait)})`).join(", ")}.`);
  }
  if (!parts.length) return view.on ? "No visitors' shows waiting." : "";
  return parts.join(" ");
}
