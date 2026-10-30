// Picking from a Library list by going into its folders, the way the Library itself works: used where
// shows and playlists are added to something (the public page, a playlist's Your shows). browse() works
// out what to show and can be tested without the page; pathNav() and folderButton() draw it.

import { childrenOf, countIn, itemsIn, pathTo, pathText } from "./folders.js";

// What to show in folder `at` of a list: the path down to it, its folders (with what's in each,
// however deep) and its items. While finding, every match from any folder, each with where it is.
export function browse({ folders, keys, at = "", find = "", nameOf = (k) => k }) {
  const here = folders.some((f) => f.id === at) ? at : "";
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hits = keys.filter((k) => words.every((w) => nameOf(k).toLowerCase().includes(w)));
    return { at: here, finding: true, trail: [], subs: [], items: hits.map((key) => ({ key, where: pathText(folders, key) })) };
  }
  return {
    at: here,
    finding: false,
    trail: pathTo(folders, here),
    subs: childrenOf(folders, here).map((folder) => ({ folder, ...countIn(folders, folder.id, keys) })),
    items: itemsIn(keys, folders, here).map((key) => ({ key, where: "" })),
  };
}

// "3 shows · 1 folder", or "Empty".
export function holds({ items, folders }, one, many = `${one}s`) {
  return [items ? `${items} ${items === 1 ? one : many}` : "", folders ? `${folders} ${folders === 1 ? "folder" : "folders"}` : ""]
    .filter(Boolean).join(" · ") || "Empty";
}

const make = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// The path above the list: "Shows › Christmas › Old", each step but the last a link back up.
export function pathNav(nav, trail, top, go) {
  nav.replaceChildren();
  nav.hidden = !trail.length;
  if (!trail.length) return;
  const step = (label, id) => {
    const b = make("button", { type: "button", className: "link-button", textContent: label });
    b.addEventListener("click", () => go(id));
    return b;
  };
  nav.append(step(top, ""));
  trail.forEach((f, k) => {
    nav.append(make("span", { className: "hint", textContent: "›" }),
      k === trail.length - 1 ? make("b", { textContent: f.name }) : step(f.name, f.id));
  });
}

// A folder row you press to go into.
export function folderButton(sub, one, go, tag = "button") {
  const b = make(tag, { className: "song-row ns-folder folder-go" });
  if (tag === "button") b.type = "button";
  else { b.tabIndex = 0; b.setAttribute("role", "button"); }
  b.append(make("span", { className: "folder-mark small" }),
    make("span", { className: "folder-text" }, make("b", { textContent: sub.folder.name }),
      make("span", { className: "hint", textContent: holds(sub, one) })),
    make("span", { className: "folder-chev", textContent: "›", ariaHidden: "true" }));
  b.addEventListener("click", () => go(sub.folder.id));
  if (tag !== "button") b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(sub.folder.id); } });
  return b;
}
