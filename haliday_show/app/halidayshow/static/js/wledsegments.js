// A WLED as several lights, one per WLED segment (Setup → Devices): each starts at its segment's first
// LED and remembers the segment's id, so WLED's own effects in scenes go to just that segment.

// WLED's segments as /api/wled/info gives them (as parts: id "w<segment id>", LEDs from–to, counted
// from 1), each with its segment id.
export function segmentsOf(parts) {
  return (parts || []).map((p) => ({ ...p, segment: Number(String(p.id).slice(1)) }))
    .filter((p) => /^w\d+$/.test(String(p.id)));
}

// What a light needs to be segment `s`: where it starts, how many LEDs, which segment.
export const segmentFields = (s) => ({ first: s.from, segments: s.to - s.from + 1, bulbs: s.to - s.from + 1, segment: s.segment });

// A free id for a segment light: the WLED's id with the segment on the end.
export function segmentLightId(devices, ip, segment) {
  const base = `wled-${ip}-s${segment}`;
  let id = base;
  for (let n = 2; devices.some((d) => d.id === id); n++) id = `${base}-${n}`;
  return id;
}

// New lights for a WLED's segments, named after them.
export function segmentLights(devices, ip, parts) {
  return segmentsOf(parts).map((s) => ({
    id: segmentLightId(devices, ip, s.segment), kind: "wled", name: s.name, ip, sku: "", protocol: "ddp",
    reverse: false, gradient: false, brightness: 100, parts: [], ...segmentFields(s),
  }));
}

export const isSegmentLight = (d) => d?.kind === "wled" && Number.isInteger(d.segment);

// Light `d` brought up to date with its segment in WLED now: null when the segment has gone.
export function refreshedSegment(d, parts) {
  const s = segmentsOf(parts).find((x) => x.segment === d.segment);
  return s ? segmentFields(s) : null;
}

// Why light `light` can't be `ip` (and, for a WLED split into lights, `segment`), or "" if it can.
// Lights on one WLED may share its IP only when each is a different segment.
export function wledClash(light, ip, lights, segment = null) {
  if (!ip) return "";
  const others = lights.filter((d) => d.id !== light.id && d.ip === ip);
  const other = others.find((d) => segment === null || !isSegmentLight(d) || d.segment === segment);
  if (!other) return "";
  return isSegmentLight(other) && segment !== null ? `That WLED segment is already ${other.name}` : `${ip} is already ${other.name}`;
}

// Whether every light already at `ip` is a segment light, so another segment there can still be picked.
export const onlySegmentsAt = (lights, ip, except = null) => {
  const at = lights.filter((d) => d.ip === ip && d.id !== except);
  return at.length > 0 && at.every(isSegmentLight);
};
