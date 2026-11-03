// Moving a light's part along it: parts keep their ids (so shows keep their effects), names and
// lengths, and swap places with the part next to them. Any unused stretches between parts stay
// where they are along the light. Tested without the page.

// parts: [{id, name, from, to}] (any order). Returns them in their new order along the light, with
// new from and to, or the same parts when part `id` can't move that way (`dir` is -1 or 1).
export function movePart(parts, id, dir) {
  const sorted = [...parts].sort((a, b) => a.from - b.from);
  const k = sorted.findIndex((p) => p.id === id), j = k + dir;
  if (k < 0 || j < 0 || j >= sorted.length) return sorted;
  const gaps = sorted.slice(1).map((p, i) => p.from - sorted[i].to - 1);
  const order = [...sorted];
  [order[k], order[j]] = [order[j], order[k]];
  let at = sorted[0].from;
  return order.map((p, i) => {
    const len = p.to - p.from + 1;
    const moved = { ...p, from: at, to: at + len - 1 };
    at = moved.to + 1 + (gaps[i] || 0);
    return moved;
  });
}
