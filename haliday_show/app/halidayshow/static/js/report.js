// Report a problem (Help → Report a problem…, or Report this on an error): a GitHub issue filled in
// with what a bug report needs, or the same text to copy. The server has already taken anything private
// out of what it sends (report.py). Pure, so it can be tested in node.

export const REPO = "https://github.com/gdeboos/ha-liday-show";
export const MAX_URL = 7500; // GitHub refuses much longer new-issue links

// "Chrome 131 on Android" from a browser's user agent.
export function browserText(ua = "") {
  const browser = [["Edg/", "Edge"], ["OPR/", "Opera"], ["SamsungBrowser/", "Samsung Internet"], ["Firefox/", "Firefox"],
    ["CriOS/", "Chrome"], ["Chrome/", "Chrome"], ["Version/", "Safari"]].find(([k]) => ua.includes(k));
  const version = browser ? (ua.split(browser[0])[1] || "").split(/[.\s]/)[0] : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS"
      : /Linux/.test(ua) ? "Linux" : "";
  return [browser ? `${browser[1]}${version ? ` ${version}` : ""}` : "A browser", os && `on ${os}`].filter(Boolean).join(" ");
}

// The issue's title and body. `info` is the server's /api/report; `error` the message reported from.
export function reportText({ what = "", expected = "", info = {}, browser = "", screen = "", error = "", log = null }) {
  const firstLine = what.trim().split("\n")[0].slice(0, 80);
  const title = firstLine || (error ? `Problem: ${error.slice(0, 70)}` : "Problem report");
  const lines = log ?? info.log ?? [];
  const body = [
    "**What went wrong**", what.trim() || "_(not filled in)_", "",
    ...(expected.trim() ? ["**What I expected**", expected.trim(), ""] : []),
    ...(error ? ["**The message it showed**", error, ""] : []),
    "**About this install**",
    `- HA-liday Show ${info.version || "?"} (${info.install || "?"})`,
    `- Lights: ${info.lights || "?"}`,
    `- Home Assistant connected: ${info.ha ? "yes" : "no"}`,
    `- Browser: ${[browser, screen].filter(Boolean).join(", screen ")}`, "",
    "**Recent warnings and errors**",
    ...(lines.length ? ["```", ...lines, "```"] : ["None since HA-liday Show started."]),
  ].join("\n");
  return { title, body };
}

// The new-issue link. The oldest log lines go first if it's too long for GitHub.
export function issueUrl(args) {
  let lines = [...(args.log ?? args.info?.log ?? [])];
  for (;;) {
    const { title, body } = reportText({ ...args, log: lines });
    const url = `${REPO}/issues/new?${new URLSearchParams({ title, body, labels: "claude" })}`;
    if (url.length <= MAX_URL || !lines.length) return url;
    lines = lines.slice(Math.max(1, Math.floor(lines.length / 4)));
  }
}
