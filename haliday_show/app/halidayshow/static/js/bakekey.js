// A short name for what a show was baked for (its lights, groups and their places on the house), kept
// with the bake on the server so that opening the show again needn't bake and send it again.
// Not for security: a mix-up only costs a bake. crypto.subtle isn't there over plain http, so this is
// cyrb53, run with two seeds.

function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Up to 64 letters, digits and dashes, as the server asks.
export function bakeNote(what) {
  const s = typeof what === "string" ? what : JSON.stringify(what);
  return `${cyrb53(s, 1)}-${cyrb53(s, 2)}-${s.length.toString(36)}`;
}
