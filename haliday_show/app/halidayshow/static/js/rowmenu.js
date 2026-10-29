// A list row's ⋯ menu: the row keeps its main button (or two) and the rest go in a small menu, so
// rows in Shows, Scenes, Playlists, Songs and the rest stay short. Removing is always last, under a line.

const REMOVE = /^(Remove|Delete|Archive)/;
let openMenu = null;

function close(menu = openMenu, focus = false) {
  if (!menu) return;
  menu.hidden = true;
  const btn = menu.previousElementSibling;
  btn?.setAttribute("aria-expanded", "false");
  if (focus) btn?.focus();
  if (openMenu === menu) openMenu = null;
}

document.addEventListener("click", (e) => { if (openMenu && !openMenu.parentElement.contains(e.target)) close(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { e.stopPropagation(); close(openMenu, true); } }, true);
window.addEventListener("resize", () => close());

// A folder picker (or any select) goes in with its name beside it.
function asItem(node) {
  if (node.tagName !== "SELECT") return node;
  const label = document.createElement("label");
  label.className = "row-menu-field";
  label.append("Folder", node);
  node.addEventListener("change", () => close());
  return label;
}

function place(menu, node) {
  const item = asItem(node);
  if (node.tagName === "BUTTON" && REMOVE.test(node.textContent)) {
    if (!menu.querySelector("hr")) menu.append(document.createElement("hr"));
    item.classList.add("danger");
    menu.append(item);
    return;
  }
  const line = menu.querySelector("hr");
  menu.insertBefore(item, line);
}

function moreFor(actions) {
  let menu = actions.querySelector(":scope > .row-more > .row-menu");
  if (menu) return menu;
  const wrap = document.createElement("span");
  wrap.className = "row-more";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost row-more-btn";
  btn.textContent = "⋯";
  const name = actions.closest(".show-row, .song-kid")?.querySelector(".show-name")?.textContent;
  btn.setAttribute("aria-label", name ? `More for ${name}` : "More");
  btn.title = "More";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  menu = document.createElement("div");
  menu.className = "row-menu";
  menu.hidden = true;
  btn.addEventListener("click", () => {
    const opening = menu.hidden;
    close();
    if (!opening) return;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    openMenu = menu;
    // Opens upwards when there's no room below.
    const r = btn.getBoundingClientRect();
    menu.classList.toggle("up", r.bottom + menu.offsetHeight + 8 > window.innerHeight);
    // Hangs off the button's left edge when there's no room to its left (a phone's stacked buttons).
    menu.classList.toggle("left", r.right - menu.offsetWidth < 8);
    menu.querySelector("button:not(:disabled), select")?.focus();
  });
  // Pressing an item closes the menu, after the item has done its job.
  menu.addEventListener("click", (e) => { if (e.target.closest("button")) setTimeout(() => close(), 0); });
  wrap.append(btn, menu);
  actions.append(wrap);
  return menu;
}

// Keeps the first `keep` of a row's buttons and moves the rest into its ⋯ menu.
export function withMore(actions, keep = 1) {
  const rest = [...actions.children].filter((n) => !n.classList.contains("row-more")).slice(keep);
  if (!rest.length) return actions;
  const menu = moreFor(actions);
  for (const n of rest) place(menu, n);
  return actions;
}

// Adds one more thing (such as a folder picker) to a row's ⋯ menu, making the menu if needed.
export function addToMore(actions, node) {
  place(moreFor(actions), node);
}
