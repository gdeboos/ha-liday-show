// HA-liday Show's dashboard cards. The integration loads this file on every dashboard (frontend.py), so
// the cards are in the card picker with no Resources step. They use only Home Assistant: the integration's
// entities, its actions, and two websocket commands (haliday_show/entities and haliday_show/library).
// cardlib.js with this file's own ?v=, so an update never pairs a new card with an old cached helper.
const { TILE_SIZES, clock, configForm, escapeHtml: h, findItems, folderView, framesByLight, houseDevices, pickScenes,
  positionNow, swatch, whenText } =
  await import(`./cardlib.js${new URL(import.meta.url).search}`);
const VERSION = new URL(import.meta.url).searchParams.get("v") || "";
const RETRY_MS = 10000;
const RESIGN_MS = 20 * 3600 * 1000;  // picture links are signed for 24 hours

const STYLE = `
  /* The card fills the space a dashboard gives it, and adapts to its own width (container queries). */
  :host { display: block; height: 100%; container-type: inline-size; }
  ha-card { padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
  /* The part that takes any spare height, and scrolls when the card is made shorter than it. */
  .fill { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 3px; margin: -3px; }  /* room for focus rings */
  .head { display: flex; align-items: center; gap: 8px; font-size: 1.1rem; font-weight: 500; margin-bottom: 12px; flex: none; }
  .head .grow { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head ha-icon { color: var(--state-icon-color, var(--primary-color)); }
  .muted { color: var(--secondary-text-color); }
  .small { font-size: 0.875rem; }
  .row { display: flex; align-items: center; gap: 12px; }
  .grow { flex: 1; min-width: 0; }
  .clip { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { font: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px;
    padding: 0 14px; border-radius: 20px; background: var(--secondary-background-color); color: var(--primary-text-color); }
  .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn:focus-visible, .tile:focus-visible, .crumb:focus-visible, .tab:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  select, input { font: inherit; color: var(--primary-text-color); background: var(--secondary-background-color);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; min-height: 40px; box-sizing: border-box; }
  .error { color: var(--error-color); font-size: 0.875rem; margin-top: 8px; }
  .note { font-size: 0.875rem; margin-top: 8px; color: var(--secondary-text-color); }
  @container (max-width: 260px) {
    ha-card { padding: 12px; }
    .head { font-size: 1rem; margin-bottom: 8px; }
    .btn { padding: 0 10px; }
    .head .btn .label { display: none; }  /* just the icon (Off) beside a narrow card's title */
  }
`;

// What every card shares: Home Assistant, our entities by what they are, and a tidy way to call actions.
class HalidayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._ents = null;
    this._error = "";
  }

  setConfig(config) {
    this._config = config || {};
    // Changed in the card editor: show it straight away.
    if (this._hass) { this._last = null; this.render(); }
  }

  // An option that hides part of the card (all off unless set in the card editor).
  hides(name) {
    return this._config?.[name] === true;
  }

  // The card's heading: its icon and title, plus anything to its right; nothing if the title is hidden.
  heading(icon, title, extra = "") {
    if (this.hides("hide_title")) return extra ? `<div class="head"><span class="grow"></span>${extra}</div>` : "";
    return `<div class="head"><ha-icon icon="${icon}"></ha-icon><span class="grow">${title}</span>${extra}</div>`;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._ents && !this._finding && Date.now() - (this._tried || 0) > RETRY_MS) this._findEntities();
    if (this.changed(hass)) this.paint();
  }

  // Rebuild, unless you're using a box or list in the card: then wait until you've left it.
  paint() {
    const active = this.shadowRoot.activeElement;
    if (active && (active.tagName === "SELECT" || active.type === "range")) {
      this._waiting = true;
      active.addEventListener("blur", () => { if (this._waiting) { this._waiting = false; this.paint(); } }, { once: true });
      return;
    }
    const typing = active && active.tagName === "INPUT" && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd] : null;
    this.render();
    if (typing) {
      const input = this.shadowRoot.querySelector("input");
      if (input) { input.focus(); input.setSelectionRange(...typing); }
    }
  }

  get hass() {
    return this._hass;
  }

  // Our entities by what they are: {player, next, status, queue, ..., scenes: [...], seasons: [...]}.
  async _findEntities() {
    this._finding = true;
    this._tried = Date.now();
    try {
      this._ents = await this._hass.callWS({ type: "haliday_show/entities" });
      this._error = "";
    } catch (e) {
      this._error = "The HA-liday Show integration isn't set up yet, or Home Assistant is starting.";
    }
    this._finding = false;
    this._last = null;
    if (this._ents) this.ready();
    this.render();
  }

  // Called once the card knows its entities.
  ready() {}

  state(key) {
    const id = this._ents && this._ents[key];
    return id ? this._hass.states[id] : undefined;
  }

  // Re-render only when one of the card's own entities changed, not on every change in the house.
  changed(hass) {
    if (!this._ents) return false;  // _findEntities draws the card when it's done
    // watched() gives our entities by what they are ("player") or by id ("scene.ha_liday_show_candy_cane").
    const now = this.watched().map((key) => hass.states[this._ents[key] || key]);
    const same = this._last && now.length === this._last.length && now.every((s, i) => s === this._last[i]);
    this._last = now;
    return !same;
  }

  watched() {
    return [];
  }

  async call(domain, service, data) {
    this._error = "";
    try {
      await this._hass.callService(domain, service, data);
    } catch (e) {
      this._error = e && e.message ? e.message : "That didn't work.";
    }
    this.render();
  }

  getCardSize() {
    return 3;
  }

  // Sizes for Home Assistant's sections dashboards (12 columns across). Each card says what suits it.
  getGridOptions() {
    return { columns: 6, rows: "auto", min_columns: 3, min_rows: 2 };
  }

  // Whether you've set the card's height in Layout (rather than letting it fit its content).
  fixedHeight() {
    return typeof this._config?.grid_options?.rows === "number";
  }
}

// ---- Player: now and next, progress, Play / Stop / Skip -------------------------------------------
class HalidayPlayerCard extends HalidayCard {
  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return configForm("player");
  }

  watched() {
    return ["player", "next", "status"];
  }

  connectedCallback() {
    this._tick = setInterval(() => this._moveBar(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }

  _moveBar() {
    const p = this.state("player");
    const bar = this.shadowRoot.querySelector(".bar > div");
    const at = this.shadowRoot.querySelector(".at");
    if (!p || p.state !== "playing" || !bar) return;
    const pos = positionNow(p.attributes);
    const dur = p.attributes.media_duration || 0;
    bar.style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0";
    if (at) at.textContent = clock(pos);
  }

  render() {
    const title = h(this._config?.title || "HA-liday Show");
    if (!this._ents) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><ha-icon icon="mdi:string-lights"></ha-icon>${title}</div>
        <div class="muted small">${h(this._error || "Loading…")}</div></ha-card>`;
      return;
    }
    const p = this.state("player");
    const next = this.state("next");
    if (!p) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head">${title}</div>
        <div class="muted small">HA-liday Show's player isn't available. Update the HA-liday Show integration.</div></ha-card>`;
      return;
    }
    const a = p.attributes;
    const playing = p.state === "playing";
    const unavailable = p.state === "unavailable";
    const pos = positionNow(a);
    const dur = a.media_duration || 0;
    const shows = a.source_list || [];
    const pic = this.hides("hide_art") ? "" : playing && a.entity_picture
      ? `<img class="art" src="${h(a.entity_picture)}" alt="">`
      : `<div class="art none"><ha-icon icon="mdi:string-lights"></ha-icon></div>`;
    const nextLine = !this.hides("hide_next") && next && next.state && !["unknown", "unavailable"].includes(next.state)
      ? `<div class="note"><ha-icon icon="mdi:calendar-clock"></ha-icon> Next: ${h(next.attributes.name || "")}, ${h(whenText(next.state).toLowerCase())}</div>`
      : "";
    this.shadowRoot.innerHTML = `<style>${STYLE}
        .art { width: 72px; height: 72px; border-radius: 12px; object-fit: cover; flex: none; }
        .art.none { display: grid; place-items: center; background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .title { font-size: 1.1rem; font-weight: 500; }
        .bar { height: 4px; border-radius: 2px; background: var(--divider-color); margin: 14px 0 4px; overflow: hidden; }
        .bar > div { height: 100%; background: var(--primary-color); width: ${dur ? Math.min(100, (pos / dur) * 100) : 0}%; }
        .times { display: flex; justify-content: space-between; }
        .controls { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .controls select { flex: 1; min-width: 140px; }
        @container (max-width: 300px) {
          .art { width: 48px; height: 48px; border-radius: 10px; }
          .controls select { min-width: 0; flex-basis: 100%; }
          .controls .btn { flex: 1; }
        }
        .note ha-icon { --mdc-icon-size: 16px; vertical-align: -3px; }
      </style>
      <ha-card>
        ${this.heading("mdi:string-lights", title)}
        <div class="row">
          ${pic}
          <div class="grow">
            <div class="title clip">${h(playing ? a.media_title : unavailable ? "Not answering" : "Nothing playing")}</div>
            <div class="muted small clip">${h(playing ? [a.media_artist, a.media_album_name].filter(Boolean).join(" · ") : unavailable ? "HA-liday Show isn't answering." : this.hides("hide_picker") ? "" : "Pick a show and press Play.")}</div>
          </div>
        </div>
        ${playing && !this.hides("hide_progress") ? `<div class="bar"><div></div></div><div class="times muted small"><span class="at">${clock(pos)}</span><span>${clock(dur)}</span></div>` : ""}
        ${!playing && this.hides("hide_picker") ? "" : `<div class="controls">
          ${playing ? "" : `<select aria-label="Show to play" ${unavailable ? "disabled" : ""}>
            ${shows.length ? shows.map((s) => `<option ${s === a.source ? "selected" : ""}>${h(s)}</option>`).join("") : "<option>No shows yet</option>"}
          </select>`}
          ${playing
            ? `<button class="btn" data-act="stop"><ha-icon icon="mdi:stop"></ha-icon>Stop</button>
               ${a.visitor_pick ? `<button class="btn" data-act="skip" title="Ends this visitor's pick"><ha-icon icon="mdi:skip-next"></ha-icon>Skip</button>` : ""}`
            : `<button class="btn primary" data-act="play" ${unavailable || !shows.length ? "disabled" : ""}><ha-icon icon="mdi:play"></ha-icon>Play</button>`}
        </div>`}
        ${nextLine}
        ${this._error ? `<div class="error">${h(this._error)}</div>` : ""}
      </ha-card>`;
    const id = p.entity_id;
    this.shadowRoot.querySelector("select")?.addEventListener("change", (e) =>
      this.call("media_player", "select_source", { entity_id: id, source: e.target.value }));
    this.shadowRoot.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      if (act === "play") {
        const pick = this.shadowRoot.querySelector("select")?.value;
        if (pick && pick !== a.source) await this.call("media_player", "select_source", { entity_id: id, source: pick });
        this.call("media_player", "media_play", { entity_id: id });
      } else {
        this.call("media_player", act === "stop" ? "media_stop" : "media_next_track", { entity_id: id });
      }
    }));
  }
}

// ---- Browse: shows and playlists in their folders, tap to play -------------------------------------
class HalidayBrowseCard extends HalidayCard {
  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this._tab = "shows";
    this._folder = { shows: null, playlists: null };
    this._find = "";
    this._lib = null;
    this._signed = new Map();
    this._started = "";
  }

  static getConfigForm() {
    return configForm("browse");
  }

  setConfig(config) {
    const before = this._config;
    // The tab it opens on: set when the card is made, or when Open on or Show changes in the editor.
    if (!before || before.start !== config?.start || before.kinds !== config?.kinds) {
      const kinds = config?.kinds || "both";
      this._tab = kinds === "both" ? (config?.start === "playlists" ? "playlists" : "shows") : kinds;
    }
    super.setConfig(config);
  }

  watched() {
    return ["show", "playlist", "status"];
  }

  ready() {
    this._loadLibrary();
  }

  // The library is fetched again when the list of shows or playlists changes.
  changed(hass) {
    const before = this._last;
    const changed = super.changed(hass);
    if (this._ents && !this._lib && !this._loading && Date.now() - (this._libTried || 0) > RETRY_MS) {
      this._loadLibrary();  // the first try failed (Home Assistant or HA-liday Show was starting)
    } else if (changed && this._ents && this._lib) {
      const lists = (states) => (states || []).slice(0, 2).map((s) => JSON.stringify(s?.attributes?.options || []));
      if (JSON.stringify(lists(before)) !== JSON.stringify(lists(this._last))) this._loadLibrary();
    }
    return changed;
  }

  async _loadLibrary() {
    if (this._loading) return;
    this._loading = true;
    this._libTried = Date.now();
    try {
      this._lib = await this._hass.callWS({ type: "haliday_show/library" });
      this._error = "";
    } catch (e) {
      this._error = e && e.message ? e.message : "Couldn't load your shows.";
    }
    this._loading = false;
    this.render();
  }

  // Pictures need a signed link, as an <img> can't send Home Assistant's sign-in.
  // Keyed by show and its picture's version, so a new picture is fetched; signed again before it runs out.
  async _sign(shows) {
    const now = Date.now();
    const want = shows.filter((s) => {
      const got = this._signed.get(this._picKey(s));
      return !got || (got.path && now - got.at > RESIGN_MS);
    });
    if (!want.length) return;
    want.forEach((s) => this._signed.set(this._picKey(s), { path: "", at: now }));
    await Promise.all(want.map(async (s) => {
      try {
        const r = await this._hass.callWS({ type: "auth/sign_path", path: `/api/haliday_show/image/${encodeURIComponent(s.id)}`,
          expires: 86400 });
        this._signed.set(this._picKey(s), { path: r.path, at: Date.now() });
      } catch (e) {
        /* no picture then: the tile shows its colours */
      }
    }));
    this.paint();
  }

  _picKey(show) {
    return `${show.id}:${show.picture}:${show.cover}`;
  }

  _play(kind, item) {
    this._started = `Starting ${item.name}…`;
    this.call("haliday_show", "play", { [kind === "shows" ? "show" : "playlist"]: item.id });
    clearTimeout(this._startedTimer);
    this._startedTimer = setTimeout(() => { this._started = ""; this.render(); }, 4000);
  }

  render() {
    const title = h(this._config?.title || "Shows and playlists");
    const lib = this._lib;
    if (!lib) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><ha-icon icon="mdi:folder-music"></ha-icon>${title}</div>
        <div class="muted small">${h(this._error || "Loading…")}</div></ha-card>`;
      return;
    }
    const kinds = this._config?.kinds || "both";
    const kind = kinds === "both" ? this._tab : kinds;
    const items = kind === "shows" ? lib.shows : lib.playlists;
    const tileW = TILE_SIZES[this._config?.tile_size] || TILE_SIZES.medium;
    if (this.hides("hide_search")) this._find = "";
    const finding = this._find.trim() !== "";
    const view = finding ? { path: [], folders: [], items: findItems(items, this._find) }
      : folderView(items, lib.folders?.[kind], this._folder[kind]);
    if (kind === "shows") this._sign(view.items.filter((s) => s.picture || s.cover));
    const now = this.state("status")?.state;
    const tile = (i) => {
      const img = kind === "shows" && (i.picture || i.cover) && this._signed.get(this._picKey(i))?.path;
      // The picture's address is set after drawing (below), never written into the style by hand.
      const bg = img ? "" : `background: ${kind === "shows" ? swatch(i.colours) : "var(--secondary-background-color)"}`;
      const sub = kind === "shows" ? clock(i.duration) : `${i.items} item${i.items === 1 ? "" : "s"}`;
      return `<button class="tile" data-item="${h(i.id)}" aria-label="Play ${h(i.name)}">
        <div class="pic" style="${bg}" ${img ? `data-img="${h(img)}"` : ""}>${!img && kind === "playlists" ? '<ha-icon icon="mdi:playlist-play"></ha-icon>' : ""}
          ${now === i.name ? '<span class="on">Playing</span>' : ""}</div>
        <div class="name clip">${h(i.name)}</div><div class="muted small">${sub}</div></button>`;
    };
    const folderTile = (f) => `<button class="tile" data-folder="${h(f.id)}" aria-label="Open ${h(f.name)}">
        <div class="pic folder"><ha-icon icon="mdi:folder"></ha-icon></div>
        <div class="name clip">${h(f.name)}</div><div class="muted small">${f.count} inside</div></button>`;
    const crumbs = view.path.length
      ? `<nav class="crumbs small"><button class="crumb" data-folder="">${kind === "shows" ? "Shows" : "Playlists"}</button>${view.path.map((p) =>
        ` › <button class="crumb" data-folder="${h(p.id)}">${h(p.name)}</button>`).join("")}</nav>` : "";
    const empty = !view.folders.length && !view.items.length
      ? `<div class="muted small">${finding ? "Nothing matches." : kind === "shows" ? "No shows here yet." : "No playlists yet."}</div>` : "";
    this.shadowRoot.innerHTML = `<style>${STYLE}
        .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
        .tab { padding: 6px 14px; border-radius: 16px; min-height: 36px; }
        .tab[aria-selected="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        input { width: 100%; margin-bottom: 10px; }
        .crumbs { margin-bottom: 10px; }
        .crumb { color: var(--primary-color); padding: 4px 2px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${tileW}px, 1fr)); gap: 12px; }
        .tile { text-align: left; padding: 0; min-width: 0; }
        .pic { position: relative; aspect-ratio: 1; border-radius: 12px; background-size: cover; background-position: center;
          display: grid; place-items: center; color: var(--secondary-text-color); margin-bottom: 6px; }
        .pic.folder { background: var(--secondary-background-color); }
        .pic.folder ha-icon { --mdc-icon-size: 40px; color: var(--primary-color); }
        .on { position: absolute; left: 6px; bottom: 6px; font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
          background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .name { font-weight: 500; }
      </style>
      <ha-card>
        ${this.heading("mdi:folder-music", title)}
        ${kinds === "both" ? `<div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="shows" aria-selected="${kind === "shows"}">Shows</button>
          <button class="tab" role="tab" data-tab="playlists" aria-selected="${kind === "playlists"}">Playlists</button>
        </div>` : ""}
        ${this.hides("hide_search") ? "" : `<input type="search" placeholder="Find in every folder" value="${h(this._find)}" aria-label="Find">`}
        ${crumbs}
        <div class="fill"><div class="grid">${view.folders.map(folderTile).join("")}${view.items.map(tile).join("")}</div>
        ${empty}</div>
        ${this._started ? `<div class="note">${h(this._started)}</div>` : ""}
        ${this._error ? `<div class="error">${h(this._error)}</div>` : ""}
      </ha-card>`;
    const root = this.shadowRoot;
    root.querySelectorAll("[data-img]").forEach((el) => { el.style.backgroundImage = `url(${JSON.stringify(el.dataset.img)})`; });
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      this._tab = b.dataset.tab;
      this.render();
    }));
    const input = root.querySelector("input");
    input?.addEventListener("input", () => {
      this._find = input.value;
      this.paint();
    });
    root.querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => {
      this._folder[kind] = b.dataset.folder || null;
      this._find = "";
      this.render();
    }));
    root.querySelectorAll("[data-item]").forEach((b) => b.addEventListener("click", () => {
      const item = items.find((i) => i.id === b.dataset.item);
      if (item) this._play(kind, item);
    }));
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 4, min_rows: 3 };
  }
}

// ---- Scenes: a tap per scene, with brightness and Off -----------------------------------------------
class HalidayScenesCard extends HalidayCard {
  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return configForm("scenes");
  }

  watched() {
    return ["light", ...((this._ents && this._ents.scenes) || [])];
  }

  render() {
    const title = h(this._config?.title || "Scenes");
    const light = this.state("light");
    if (!this._ents || !light) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><ha-icon icon="mdi:creation"></ha-icon>${title}</div>
        <div class="muted small">${h(this._error || (this._ents ? "HA-liday Show's scenes aren't available." : "Loading…"))}</div></ha-card>`;
      return;
    }
    const all = (this._ents.scenes || []).map((id) => this._hass.states[id]).filter(Boolean)
      .map((st) => ({ id: st.entity_id, name: st.attributes.scene_name || st.attributes.friendly_name || st.entity_id }));
    const scenes = pickScenes(all, this._config?.scenes);
    const cols = Number(this._config?.columns);
    // A scene added since the card looked: look again (it finds the new scene's entity).
    const listed = (light.attributes.effect_list || []).length;
    if (listed !== all.length && !this._finding && Date.now() - (this._tried || 0) > RETRY_MS) this._findEntities();
    const gone = light.state === "unavailable";
    const on = light.state === "on";
    const current = on ? light.attributes.effect : null;
    const level = Math.round(((light.attributes.brightness ?? 255) * 100) / 255) || 100;
    this.shadowRoot.innerHTML = `<style>${STYLE}
        .grid { display: grid; grid-template-columns: ${cols >= 1 && cols <= 6 ? `repeat(${Math.round(cols)}, minmax(0, 1fr))`
          : "repeat(auto-fill, minmax(130px, 1fr))"}; gap: 8px; }
        .scene { justify-content: flex-start; border-radius: 12px; min-height: 48px; text-align: left; }
        .scene[aria-pressed="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .level { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex: none; }
        .level input { flex: 1; min-width: 0; padding: 0; min-height: 0; border: none; background: none; accent-color: var(--primary-color); }
        .level output { min-width: 3.5em; text-align: right; flex: none; }
        .note { flex: none; }
        @container (max-width: 260px) { .level > span { display: none; } .level output { min-width: 0; } }
      </style>
      <ha-card>
        ${this.heading("mdi:creation", title, this.hides("hide_off") ? ""
          : `<button class="btn" data-off aria-label="Turn scenes off" ${on ? "" : "disabled"}><ha-icon icon="mdi:power"></ha-icon><span class="label">Off</span></button>`)}
        ${scenes.length ? `<div class="fill"><div class="grid">${scenes.map((sc) =>
          `<button class="btn scene" data-scene="${h(sc.id)}" aria-pressed="${sc.name === current}" ${gone ? "disabled" : ""}><span class="clip">${h(sc.name)}</span></button>`).join("")}</div></div>`
          : `<div class="muted small">${all.length ? "None of the scenes picked for this card are there any more: pick again in its options."
            : "No scenes yet: make one in HA-liday Show's Scene editor."}</div>`}
        ${this.hides("hide_brightness") ? "" : `<label class="level small"><span class="muted">Brightness</span>
          <input type="range" min="1" max="100" value="${level}" aria-label="Scene brightness" ${on ? "" : "disabled"}><output>${level}%</output></label>`}
        ${gone ? `<div class="note">HA-liday Show isn't answering.</div>` : on || !scenes.length ? "" : '<div class="note">Scenes are off. Press one to put it on.</div>'}
        ${this._error ? `<div class="error">${h(this._error)}</div>` : ""}
      </ha-card>`;
    const root = this.shadowRoot;
    root.querySelectorAll("[data-scene]").forEach((b) => b.addEventListener("click", () =>
      this.call("scene", "turn_on", { entity_id: b.dataset.scene })));
    root.querySelector("[data-off]")?.addEventListener("click", () => this.call("light", "turn_off", { entity_id: light.entity_id }));
    const slider = root.querySelector("input[type=range]");
    const out = root.querySelector("output");
    slider?.addEventListener("input", () => { out.textContent = `${slider.value}%`; });
    slider?.addEventListener("change", () => {
      // Only while a scene is on: turning the light on would start one.
      if (this._hass.states[light.entity_id]?.state !== "on") return;
      this.call("light", "turn_on", { entity_id: light.entity_id, brightness_pct: Number(slider.value) });
    });
  }
}

// ---- Visitors & checks: the public page, the queue or votes, phones listening, the last pre-show check
const CHECK = { ok: ["mdi:check-circle", "All good", "var(--success-color, #43a047)"],
  info: ["mdi:information", "All good", "var(--success-color, #43a047)"],
  warn: ["mdi:alert", "Worth a look", "var(--warning-color, #ffa600)"],
  fail: ["mdi:alert-circle", "Something's wrong", "var(--error-color, #db4437)"] };

class HalidayVisitorsCard extends HalidayCard {
  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return configForm("visitors");
  }

  watched() {
    return ["page_open", "queue", "listening", "preshow", "player"];
  }

  render() {
    const title = h(this._config?.title || "Visitors and checks");
    const page = this.state("page_open"), queue = this.state("queue"), listening = this.state("listening");
    const check = this.state("preshow"), player = this.state("player");
    if (!this._ents || !page) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><ha-icon icon="mdi:account-group"></ha-icon>${title}</div>
        <div class="muted small">${h(this._error || (this._ents ? "Update the HA-liday Show integration." : "Loading…"))}</div></ha-card>`;
      return;
    }
    const known = (st) => st && !["unavailable", "unknown"].includes(st.state);
    const pageKnown = known(page);
    const open = page.state === "on";
    const voting = queue?.attributes.mode === "vote";
    const waiting = known(queue) ? Number(queue.state) || 0 : "–";
    const picks = queue?.attributes.picks || [];
    const phones = known(listening) ? Number(listening.state) || 0 : "–";
    const level = check && CHECK[check.state];
    const checkedAt = check?.attributes.checked ? new Date(check.attributes.checked) : null;
    const ago = checkedAt && !Number.isNaN(checkedAt.getTime())
      ? checkedAt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
    const counts = level ? [check.attributes.problems ? `${check.attributes.problems} problem${check.attributes.problems === 1 ? "" : "s"}` : "",
      check.attributes.warnings ? `${check.attributes.warnings} to look at` : ""].filter(Boolean).join(", ") : "";
    const stats = [
      this.hides("hide_page") ? "" : !pageKnown ? tile("mdi:web", "–", "Not answering")
        : tile(open ? "mdi:web-check" : "mdi:web-off", open ? "Open" : page.attributes.switched_on ? "Closed" : "Off",
          open ? "Visitors' page" : page.attributes.switched_on ? "Outside opening hours" : "Visitors' page is switched off",
          open ? "var(--success-color, #43a047)" : ""),
      this.hides("hide_queue") ? "" : tile(voting ? "mdi:vote" : "mdi:human-queue", waiting, voting ? (waiting === 1 ? "vote" : "votes") : "waiting"),
      this.hides("hide_phones") ? "" : tile("mdi:cellphone-sound", phones, phones === 1 ? "phone listening" : "phones listening"),
    ].join("");
    function tile(icon, big, label, colour = "") {
      return `<div class="stat"><ha-icon icon="${icon}" style="${colour ? `color:${colour}` : ""}"></ha-icon>
      <div><div class="big">${big}</div><div class="muted small">${label}</div></div></div>`;
    }
    this.shadowRoot.innerHTML = `<style>${STYLE}
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .stat { display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 12px; background: var(--secondary-background-color); }
        .stat ha-icon { color: var(--secondary-text-color); flex: none; }
        @container (max-width: 260px) { .stats { grid-template-columns: 1fr; gap: 8px; } .stat { padding: 8px; } }
        .big { font-size: 1.25rem; font-weight: 500; line-height: 1.2; }
        ol { margin: 10px 0 0; padding-left: 22px; }
        li { padding: 2px 0; }
        .check { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
        .check ha-icon { flex: none; }
      </style>
      <ha-card>
        ${this.heading("mdi:account-group", title)}
        <div class="fill">
        ${stats ? `<div class="stats">${stats}</div>` : ""}
        ${picks.length && !this.hides("hide_picks") ? `<ol class="small">${picks.slice(0, 5).map((p) => `<li>${h(p)}</li>`).join("")}</ol>
          ${picks.length > 5 ? `<div class="note">and ${picks.length - 5} more</div>` : ""}` : ""}
        ${!this.hides("hide_skip") && player && player.state === "playing" && player.attributes.visitor_pick ? `<div style="margin-top:10px">
          <button class="btn" data-skip><ha-icon icon="mdi:skip-next"></ha-icon>Skip this pick</button></div>` : ""}
        ${this.hides("hide_check") ? "" : `<div class="check">
          ${level ? `<ha-icon icon="${level[0]}" style="color:${level[2]}"></ha-icon>
            <div><div>Pre-show check: ${level[1]}${counts ? ` (${h(counts)})` : ""}</div><div class="muted small">${h(ago ? `Last run ${ago}` : "")}</div></div>`
          : `<ha-icon icon="mdi:clipboard-check-outline"></ha-icon><div class="muted small">${check && check.state === "unavailable"
            ? "The last pre-show check isn't available." : "No pre-show check yet. Run one from HA-liday Show's Setup → Devices."}</div>`}
        </div>`}
        </div>
        ${this._error ? `<div class="error">${h(this._error)}</div>` : ""}
      </ha-card>`;
    this.shadowRoot.querySelector("[data-skip]")?.addEventListener("click", () =>
      this.call("haliday_show", "skip", {}));
  }

  getCardSize() {
    return 4;
  }
}

// ---- House: your house photo with the lights as they are right now ----------------------------------
// It draws with the editor's own house.js (fetched from HA-liday Show through the integration), so the
// house looks exactly as on the editor's House tab.
class HalidayHouseCard extends HalidayCard {
  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return configForm("house");
  }

  constructor() {
    super();
    this._houseView = null;
    this._frames = new Map();
    this._unsub = null;
    this._message = "Loading…";
  }

  watched() {
    return ["status"];
  }

  async ready() {
    clearTimeout(this._retry);
    this._retry = null;
    this._tries = (this._tries || 0) + 1;
    try {
      const base = "/api/haliday_show/js/";
      // A try number too, as a browser can remember a module that failed to load.
      const q = `?v=${encodeURIComponent(VERSION)}&r=${this._tries}`;
      const [{ House }, matrix, parts] = await Promise.all([
        import(`${base}house.js${q}`), import(`${base}matrix.js`), import(`${base}parts.js`)]);
      this._m = { gridOf: matrix.gridOf, fromWire: matrix.fromWire, partSize: parts.partSize, partGrid: parts.partGrid,
        gatherPart: parts.gatherPart };
      const layout = await this._hass.callWS({ type: "haliday_show/house" });
      const view = new House({ api: async () => ({}), status: () => {}, frameFor: null });
      Object.assign(view, { paths: layout.house.paths || {}, styles: layout.house.styles || {},
        pins: layout.house.pins || {}, dim: layout.house.dim ?? 0.5 });
      // Your photo, else the sample house (fetched through the integration: the editor's own path to it
      // is relative to the editor's page).
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      if (layout.house.photo) {
        const signed = await this._hass.callWS({ type: "auth/sign_path", path: "/api/haliday_show/house_photo", expires: 86400 });
        view.photo = await load(signed.path);  // if this fails, try again later rather than draw the sample
      } else {
        view.photo = await load(`${base}sample-house.svg`);
        view.sample = true;
      }
      this._lights = layout.devices || [];
      view.devices = houseDevices(this._lights, view.paths, this._m);
      this._houseView = view;
      this._placed = view.devices.some((d) => (view.paths[d.id] || []).length);
      this._message = "";
      this._subscribe();
    } catch (e) {
      // HA-liday Show may be starting or updating: try again, so a wall tablet comes back by itself.
      this._message = "Waiting for HA-liday Show…";
      if (this.isConnected) this._retry = setTimeout(() => this.ready(), RETRY_MS);
    }
    this.render();
  }

  async _subscribe() {
    if (this._unsub || this._subscribing || !this._houseView || !this.isConnected || document.hidden) return;
    this._subscribing = true;
    let unsub = null;
    try {
      unsub = await this._hass.connection.subscribeMessage((frame) => {
        this._frames = framesByLight(frame, this._lights, this._m);
        this._paint();
      }, { type: "haliday_show/house/frames" });
    } catch (e) {
      this._message = "Couldn't follow your lights.";
      this.render();
    }
    this._subscribing = false;
    // Taken off the screen (or hidden) while that was on its way: stop it again straight away.
    if (unsub && (!this.isConnected || document.hidden)) unsub();
    else this._unsub = unsub;
  }

  _stop() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  connectedCallback() {
    this._visible = () => (document.hidden ? this._stop() : this._subscribe());
    document.addEventListener("visibilitychange", this._visible);
    this._subscribe();
    if (this._ents && !this._houseView && !this._retry) this.ready();
    this._resize = new ResizeObserver(() => this._paint());
    this._resize.observe(this);
  }

  disconnectedCallback() {
    // Nothing is fetched while no House card is on screen (or the screen is off).
    this._stop();
    clearTimeout(this._retry);
    this._retry = null;
    document.removeEventListener("visibilitychange", this._visible);
    this._resize?.disconnect();
  }

  _paint() {
    const canvas = this.shadowRoot.querySelector("canvas");
    const view = this._houseView;
    if (!canvas || !view || !view.photo || !canvas.parentElement.clientWidth) return;
    // With a height set in Layout, the picture fits the space; otherwise it's no taller than max_height.
    const frame = canvas.parentElement;
    const maxH = this.fixedHeight() && frame.clientHeight > 40 ? frame.clientHeight
      : Math.min(2000, Math.max(150, Number(this._config?.max_height) || 420));
    view.paint(canvas, maxH, (dev) => {
      const full = this._frames.get(dev.parent || dev.id);
      if (!full) return new Uint8Array((dev.segments || 1) * 3);
      const light = dev.parent ? this._lights.find((l) => l.id === dev.parent) : null;
      return dev.parent && light ? this._m.gatherPart(full, light, dev.part) : full;
    });
  }

  render() {
    const title = h(this._config?.title || "Your house");
    const status = this.state("status");
    const playing = status && !["idle", "unknown", "unavailable"].includes(status.state);
    const line = !this._houseView ? this._message
      : !this._placed ? "Your lights show here once they're on the photo under Setup → House in HA-liday Show."
      : playing ? `On now: ${status.state}` : "Nothing is on your lights now.";
    this.shadowRoot.innerHTML = `<style>${STYLE}
        ha-card { padding: 0; }
        ha-card.fixed .frame { flex: 1 1 0; min-height: 0; overflow: hidden; align-items: center; }
        .head { padding: 16px 16px 0; }
        ha-card > .frame:first-child { border-radius: 12px 12px 0 0; overflow: hidden; }
        .frame { display: flex; justify-content: center; background: #000; flex: none; }
        .line { flex: none; }
        canvas { display: block; max-width: 100%; }
        .line { padding: 10px 16px 14px; }
      </style>
      <ha-card class="${this.fixedHeight() ? "fixed" : ""}">
        ${this.heading("mdi:home-lightbulb-outline", title)}
        ${this._houseView ? '<div class="frame"><canvas role="img" aria-label="Your house with its lights"></canvas></div>' : ""}
        ${this._houseView && this._placed && this.hides("hide_caption") ? "" : `<div class="line muted small">${h(line)}</div>`}
        ${this._error ? `<div class="error" style="padding:0 16px 12px">${h(this._error)}</div>` : ""}
      </ha-card>`;
    this._paint();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 4, min_rows: 3 };
  }
}

const CARDS = [
  ["haliday-show-player-card", HalidayPlayerCard, "HA-liday Show: Player", "What's playing and what's next, with Play, Stop and Skip."],
  ["haliday-show-browse-card", HalidayBrowseCard, "HA-liday Show: Browse", "Your shows and playlists in their folders: tap one to play it."],
  ["haliday-show-scenes-card", HalidayScenesCard, "HA-liday Show: Scenes", "A button for each of your scenes, with brightness and Off."],
  ["haliday-show-house-card", HalidayHouseCard, "HA-liday Show: House", "Your house photo with the lights as they are right now."],
  ["haliday-show-visitors-card", HalidayVisitorsCard, "HA-liday Show: Visitors and checks", "The visitors' page, the queue or votes, phones listening and the last pre-show check."],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({ type: tag, name, description, preview: false,
      documentationURL: "https://github.com/gdeboos/ha-liday-show/blob/main/haliday_show/DOCS.md#dashboard-cards" });
  }
}
export { HalidayBrowseCard, HalidayCard, HalidayHouseCard, HalidayPlayerCard, HalidayScenesCard, HalidayVisitorsCard, STYLE };
