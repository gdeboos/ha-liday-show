"""Makes the user guide's pages on GitHub (docs/guide/) from haliday_show/DOCS.md.

DOCS.md stays the one place the guide is written, because Home Assistant's Documentation tab can
only show a single file. This splits it into a page per chapter for reading on GitHub, with links
between pages fixed up. Run it after changing DOCS.md; `--check` (used by CI) fails if the pages
are out of date.

    python tools/split_guide.py           # rewrite docs/guide/
    python tools/split_guide.py --check   # exit 1 if docs/guide/ doesn't match DOCS.md
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "haliday_show" / "DOCS.md"
OUT = ROOT / "docs" / "guide"

# Each page starts at the first heading listed and runs until the next page's first heading.
# Headings are matched by their text, at any level.
PAGES = [
    ("getting-started.md", "Getting started", "Finding your way"),
    ("lights.md", "Your lights", "1. Devices"),
    ("speakers.md", "Speakers", "2. Speakers"),
    ("house.md", "Your house", "3. Your house"),
    ("build-a-show.md", "Build a show", "4. Build a show"),
    ("effects.md", "Effects", "Effects"),
    ("play-it.md", "Play it and playlists", "5. Play it"),
    ("public-page.md", "The public page", "The public page"),
    ("automations.md", "Automations", "6. Automations"),
    ("editor-and-settings.md", "The editor, settings and your data", "Arrange the editor"),
    ("labs.md", "Labs and experiments", "Packet lab"),
    ("troubleshooting.md", "Troubleshooting and storage", "Troubleshooting"),
    ("without-home-assistant.md", "Running without Home Assistant", "Running without Home Assistant"),
]

HEADING = re.compile(r"^(#{1,6}) (.+?)\s*$")
NOTE = ("<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the "
        "tool. -->\n\n")


def slug(text: str) -> str:
    """GitHub's anchor for a heading."""
    text = re.sub(r"[*_`]", "", text.strip().lower())
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def split(source: str):
    lines = source.splitlines(keepends=True)
    starts = {title: name for name, _, title in PAGES}
    intro, chunks, current, fence = [], {name: [] for name, _, _ in PAGES}, None, False
    anchors = {}
    for line in lines:
        if line.startswith("```"):
            fence = not fence
        m = None if fence else HEADING.match(line)
        if m and m.group(2) in starts and (current is None or starts[m.group(2)] != current):
            current = starts[m.group(2)]
        if m:
            anchors[slug(m.group(2))] = current
        (chunks[current] if current else intro).append(line)
    missing = [t for n, _, t in PAGES if not chunks[n]]
    if missing:
        raise SystemExit(f"DOCS.md has no heading for: {', '.join(missing)}. Update PAGES.")
    return "".join(intro), chunks, anchors


def fix_links(text: str, page: str | None, anchors: dict) -> str:
    def repl(m):
        anchor = m.group(1)
        target = anchors.get(anchor)
        if target is None or target == page:
            return m.group(0)
        return f"]({target}#{anchor})"
    return re.sub(r"\]\(#([^)\s]+)\)", repl, text)


def shift(lines: list[str]) -> list[str]:
    """Make the page's first heading level 2 (under the page title), keeping the rest in step."""
    first = next(len(HEADING.match(l).group(1)) for l in lines if HEADING.match(l))
    out, fence = [], False
    for line in lines:
        if line.startswith("```"):
            fence = not fence
        m = None if fence else HEADING.match(line)
        if m and first != 2:
            line = "#" * max(2, len(m.group(1)) - first + 2) + " " + m.group(2) + "\n"
        out.append(line)
    return out


def build() -> dict[str, str]:
    intro, chunks, anchors = split(SOURCE.read_text(encoding="utf-8"))
    files = {}
    names = [n for n, _, _ in PAGES]
    for i, (name, title, _) in enumerate(PAGES):
        body = fix_links("".join(shift(chunks[name])).strip() + "\n", name, anchors)
        nav = []
        if i:
            nav.append(f"[← {PAGES[i - 1][1]}]({names[i - 1]})")
        nav.append("[Contents](README.md)")
        if i + 1 < len(PAGES):
            nav.append(f"[{PAGES[i + 1][1]} →]({names[i + 1]})")
        nav = " · ".join(nav)
        files[name] = f"{NOTE}# {title}\n\n{nav}\n\n{body}\n---\n\n{nav}\n"
    # The index: DOCS.md's opening (its own contents links now go to the pages), then every page.
    head = fix_links(intro.strip(), None, anchors)
    head = re.sub(r"^# .*\n", "# HA-liday Show user guide\n", head, count=1)
    toc = "\n".join(f"{i}. [{title}]({name})" for i, (name, title, _) in enumerate(PAGES, 1))
    files["README.md"] = (f"{NOTE}{head}\n\n## Pages\n\n{toc}\n\n"
                          "The whole guide on one page is "
                          "[haliday_show/DOCS.md](../../haliday_show/DOCS.md), the same as the app's "
                          "**Documentation** tab in Home Assistant.\n")
    return files


def main() -> int:
    files = build()
    check = "--check" in sys.argv
    stale = []
    for name, text in files.items():
        path = OUT / name
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        stale.append(name)
        if not check:
            OUT.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    extra = sorted(p.name for p in OUT.glob("*.md") if p.name not in files) if OUT.exists() else []
    if check:
        if stale or extra:
            print("docs/guide/ is out of date with haliday_show/DOCS.md. Run: python tools/split_guide.py")
            for n in stale + extra:
                print(f"  {n}")
            return 1
        print("docs/guide/ matches DOCS.md")
        return 0
    for n in extra:
        (OUT / n).unlink()
    print(f"Wrote {len(stale)} page(s), removed {len(extra)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
