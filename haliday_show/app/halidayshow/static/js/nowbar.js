// The bar under the top bar that says what's on your lights right now, whatever started it (the
// schedule, an automation, a visitor, a scene's Play), with Stop and Restart. nowOn() works it out
// from the player's status (api/player) without the page, so it can be tested.

// {title, detail, kind: "show" | "playlist" | "scene" | "block", position, duration, scene, actions}
// or null when nothing's on. actions: [{act: "stop" | "restart" | "stop-scene", label}].
export function nowOn(st) {
  if (!st) return null;
  const scene = st.scene?.id ? st.scene : null;
  if (st.playlist) {
    const what = st.block ? (st.name || "a block") : st.name || "";
    return {
      kind: "playlist", title: st.playlist.name,
      detail: [st.playlist.finishing ? "finishing" : "", what ? `now: ${what}` : ""].filter(Boolean).join(" · "),
      position: st.playing ? st.position : 0, duration: st.playing ? st.duration : 0,
      id: st.playlist.id, scene: null,
      actions: [{ act: "restart", label: "Restart playlist" }, { act: "stop", label: "Stop" }],
    };
  }
  if (st.playing && st.show) {
    return {
      kind: "show", title: st.name || st.show, detail: st.media_player ? `with its song on ${st.media_player}` : "",
      position: st.position, duration: st.duration, id: st.show, mediaPlayer: st.media_player || null,
      // A scene that comes back once the show ends.
      scene: scene && !scene.playing ? scene.name : null,
      actions: [{ act: "restart", label: "Restart" }, { act: "stop", label: "Stop" }],
    };
  }
  if (st.playing && st.block) {
    return { kind: "block", title: st.name || "A block", detail: "", position: st.position, duration: st.duration,
      scene: null, actions: [{ act: "stop", label: "Stop" }] };
  }
  if (scene?.playing) {
    return { kind: "scene", title: scene.name, detail: "", position: 0, duration: 0, id: scene.id, scene: null,
      actions: [{ act: "stop-scene", label: "Turn off" }] };
  }
  return null;
}

export const KIND_WORDS = { show: "Show", playlist: "Playlist", scene: "Scene", block: "Playlist block" };
