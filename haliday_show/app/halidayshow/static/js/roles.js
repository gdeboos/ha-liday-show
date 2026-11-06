// Light roles: which part of the music each light (or part of a light) reacts to when Generate makes
// a show: the kick drum, the snare, the crash cymbals, the bass, the vocals, the melody, or a steady
// background. Your house has a role for each (Setup → Devices → Light roles: yours where you've
// picked one, else a guess), and a show can give any light another (Show settings → Light roles), so
// shows needn't all look alike. Pure, so it can be tested in node.

export const ROLES = {
  kick: "Kick drum",
  snare: "Snare",
  crash: "Crash cymbals",
  bass: "Bass",
  vocals: "Vocals",
  melody: "Melody",
  background: "Background",
  none: "Nothing in particular",
};

// The order guesses go round in: the biggest light carries the melody, then the drums take turns.
const ROUND = ["melody", "kick", "snare", "crash", "bass", "background"];

// A guess at each lane's role. lanes: [{id, segments, matrix?, slow?, phones?}], in your order. A
// matrix sings (Singing faces); a slow light (one changed through Home Assistant) is background, as it
// can't keep up with drums; the rest take turns round ROUND, biggest first.
export function guessRoles(lanes) {
  const out = {};
  const rest = [];
  for (const l of lanes) {
    if (l.matrix || l.phones) out[l.id] = "vocals";
    else if (l.slow) out[l.id] = "background";
    else rest.push(l);
  }
  rest.slice().sort((a, b) => (b.segments || 0) - (a.segments || 0) || lanes.indexOf(a) - lanes.indexOf(b))
    .forEach((l, i) => { out[l.id] = ROUND[i % ROUND.length]; });
  return out;
}

// The role each lane has in a show: the show's own where it gives one, else the house's, else the guess.
export function rolesFor(lanes, house = {}, show = {}) {
  const guess = guessRoles(lanes), out = {};
  for (const l of lanes) out[l.id] = ok(show?.[l.id]) || ok(house?.[l.id]) || guess[l.id];
  return out;
}

const ok = (role) => (Object.hasOwn(ROLES, role) ? role : null);

// Only real roles for lights that exist: what's kept (a light removed since loses its role).
export function cleanRoles(roles, ids) {
  const out = {};
  for (const [id, role] of Object.entries(roles || {})) if (ids.includes(id) && ok(role)) out[id] = role;
  return out;
}
