// Keeps the Music editor's drafts on the server as you edit (music.js).
//
// Each draft you work on gets a session: the latest copy waiting to be sent, its id once the server
// has made it, and a chain so its saves go one after another, in order. Switching to another song or
// draft starts a new session, and the old one still sends its last change to its own draft, so
// nothing lands in the wrong place. A draft deleted elsewhere (404) is made afresh from the edit, as
// that's what was on screen.

export class DraftKeeper {
  // api(path, {method, json, keepalive}) as in app.js (errors carry .status); onState() runs whenever
  // what to show next to the draft might have changed; onError(message, session, isCurrent).
  constructor(api, { onState = () => {}, onError = () => {}, delay = 600, timers = globalThis } = {}) {
    this.api = api;
    this.onState = onState;
    this.onError = onError;
    this.delay = delay;
    this.timers = timers;
    this.session = this.newSession(null);
    this.stalled = new Set(); // drafts you've left whose last change couldn't be sent yet
  }

  newSession(draft) {
    return { id: draft?.id || null, made: draft?.made || null, latest: null, timer: null,
      chain: Promise.resolve(), sending: 0, failed: false, gone: false };
  }

  // The draft being worked on: {id, made} (id is null until the server has it), or null if none yet.
  get current() {
    const s = this.session;
    return s.id || s.latest || s.sending ? { id: s.id, made: s.made } : null;
  }

  get pending() { return !!(this.session.timer || this.session.sending); }
  get failed() { return this.session.failed; }
  // Including drafts you've left (leaving the page then would lose their last change).
  get anyFailed() { return this.session.failed || [...this.stalled].some((s) => s.failed); }

  // Starts working on a draft ({id, made}) or a song with none yet (null). The last one's waiting
  // change is sent to it straight away.
  start(draft) {
    this.flush();
    if (this.session.failed) this.stalled.add(this.session);
    this.session = this.newSession(draft);
    this.onState();
  }

  // Remembers which song file a draft made (the current one unless a session is given, for when you
  // switched away while the file was being made).
  setMade(ref, s = this.session) { s.made = ref; }

  // A change: body (the whole draft, made now) is sent shortly, unless another change comes first. To
  // a draft you've since left (s), it's sent straight away.
  changed(body, s = this.session) {
    s.latest = body;
    if (s !== this.session) { this.send(s); return; }
    this.retryStalled();
    this.timers.clearTimeout(s.timer);
    s.timer = this.timers.setTimeout(() => { s.timer = null; this.send(s); }, this.delay);
    this.onState();
  }

  // Sends the current draft's waiting change now; resolves once everything for it has been sent.
  flush({ keepalive = false } = {}) {
    const s = this.session;
    this.timers.clearTimeout(s.timer);
    s.timer = null;
    if (s.latest) this.send(s, { keepalive }); // also retries one that failed
    this.retryStalled({ keepalive });
    return Promise.all([s.chain, ...[...this.stalled].map((x) => x.chain)]).then(() => {});
  }

  retryStalled(opts) {
    for (const s of this.stalled) if (s.latest && !s.sending) this.send(s, opts);
  }

  // The current draft was deleted (from Your songs): forget it, so nothing more is sent to it. The
  // next change starts a new one.
  forget() {
    const s = this.session;
    this.timers.clearTimeout(s.timer);
    s.gone = true;
    this.session = this.newSession(null);
    this.onState();
  }

  send(s, { keepalive = false } = {}) {
    s.sending++;
    s.chain = s.chain.then(async () => {
      const body = s.latest;
      if (!body || s.gone) return;
      s.latest = null;
      try {
        if (s.id) {
          try {
            await this.api(`api/drafts/${encodeURIComponent(s.id)}`, { method: "PUT", json: { ...body, made: s.made }, keepalive });
          } catch (e) {
            if (e.status !== 404) throw e;
            if (s.gone) return; // deleted here meanwhile: leave it deleted
            s.id = null; // deleted elsewhere: make it again from what's on screen
          }
        }
        if (!s.id) {
          const { id } = await this.api("api/drafts", { method: "POST", json: { ...body, made: s.made }, keepalive });
          s.id = id;
        }
        s.failed = false;
        this.stalled.delete(s);
      } catch (e) {
        s.failed = true;
        s.latest ||= body; // sent with the next change, or the next flush
        if (s !== this.session) this.stalled.add(s);
        this.onError(e.message, s, s === this.session);
      }
    }).finally(() => {
      s.sending--;
      this.onState();
    });
  }
}
