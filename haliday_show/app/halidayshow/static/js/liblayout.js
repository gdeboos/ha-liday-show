// Cards or a list: how Library → Shows, Scenes, Pictures and Palettes lay out their items, picked with
// the Cards / List switch above each and remembered for each one in this browser. Cards are the
// default. The rows are the same either way; the "as-cards" class lays them out as cards (style.css).
export const CARD_LIBRARIES = {
  shows: { view: "view-shows", list: "#view-shows [data-show-list]", noun: "shows" },
  scenes: { view: "view-scenes", list: "#view-scenes [data-scene-list]", noun: "scenes" },
  pictures: { view: "view-pictures", list: "#pictures-list", noun: "pictures" },
  palettes: { view: "view-palettes", list: "#my-palettes", noun: "palettes" },
};

export const layoutOf = (prefs, kind) => (prefs.get(`layout.${kind}`, "cards") === "list" ? "list" : "cards");

export function applyLayout(prefs, kind) {
  const cards = layoutOf(prefs, kind) === "cards";
  for (const box of document.querySelectorAll(CARD_LIBRARIES[kind].list)) box.classList.toggle("as-cards", cards);
  for (const b of document.querySelectorAll(`[data-cards-for="${kind}"] button`)) {
    b.setAttribute("aria-pressed", String(b.dataset.cards === (cards ? "cards" : "list")));
    b.classList.toggle("active", b.getAttribute("aria-pressed") === "true");
  }
}

// The Cards / List switch, put just above each library's list.
export function addLayoutSwitches(prefs) {
  for (const [kind, lib] of Object.entries(CARD_LIBRARIES)) {
    const list = document.querySelector(lib.list);
    if (!list || document.querySelector(`[data-cards-for="${kind}"]`)) continue;
    const box = document.createElement("span");
    box.className = "seg-buttons layout-switch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `Show your ${lib.noun} as`);
    box.dataset.cardsFor = kind;
    for (const [value, label] of [["cards", "Cards"], ["list", "List"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cards = value;
      b.textContent = label;
      b.addEventListener("click", () => { prefs.set(`layout.${kind}`, value); applyLayout(prefs, kind); });
      box.append(b);
    }
    const h = document.getElementById(lib.view).querySelector("h2");
    h.classList.add("with-layout-switch");
    h.append(box);
    applyLayout(prefs, kind);
  }
}
