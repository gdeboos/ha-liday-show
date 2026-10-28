// Moving a Govee light to WLED (Setup → Devices → Edit → Convert to WLED…): the same light, now
// driven by a WLED controller. It keeps its id, so its tracks in every show, its place on the house
// photo, its name and its parts stay with it; only how it's reached and its LED count change.

// A light's parts moved from `from` segments to `to`, each keeping its share of the light (segment
// numbers count from 1). A part squeezed out by those before it is dropped. As migrate.stretch_parts.
export function stretchParts(parts, from, to) {
  if (!parts?.length || from === to || from < 1) return parts || [];
  const out = [];
  let after = 0;
  for (const p of [...parts].sort((a, b) => a.from - b.from)) {
    const start = Math.max(Math.round(((p.from - 1) * to) / from) + 1, after + 1);
    const end = Math.min(Math.max(Math.round((p.to * to) / from), start), to);
    if (start > to) continue;
    out.push({ ...p, from: start, to: end });
    after = end;
  }
  return out;
}

// The light as a WLED light at `ip` with `leds` LEDs (each its own segment).
export function toWled(light, ip, leds) {
  const { sku, gradient, protocol, ...rest } = light;
  return { ...rest, kind: "wled", ip, sku: "", protocol: "ddp", gradient: false, segments: leds, bulbs: leds,
    parts: stretchParts(light.parts || [], light.segments, leds) };
}

// Why `ip` can't take this light, or "" if it can. No IP makes it a planned WLED light.
export function convertProblem(light, ip, lights) {
  if (!ip) return "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return "That isn't an IP address. Leave it blank if the controller isn't on yet";
  const other = lights.find((d) => d.id !== light.id && d.ip === ip);
  return other ? `${ip} is already ${other.name}` : "";
}

// Whether a saved show has a track on this light or one of its parts.
export const showUses = (show, id) => (show?.tracks || []).some((t) => t.device === id || t.device?.startsWith(`${id}#`));
