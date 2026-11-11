"""Checks the user guide (docs/guide/) and keeps its page-to-page links tidy.

The guide is written as a page per topic in docs/guide/, in the order listed in docs/guide/README.md.
haliday_show/DOCS.md (Home Assistant's Documentation tab) is a short overview that links to it.

This checks, across the guide, DOCS.md, README.md, the in-app help (help.js) and the dashboard cards:
- every page is listed in the guide's contents, and every listed page exists
- every link to a page, a heading on a page (#anchor) or an image goes somewhere real
- each page ends with the same "previous · contents · next" line it should

    python tools/check_guide.py          # check (CI runs this)
    python tools/check_guide.py --fix    # rewrite each page's previous/next line, then check
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "docs" / "guide"
INDEX = GUIDE / "README.md"
URL = "https://github.com/gdeboos/ha-liday-show/blob/main/"
NAV_START, NAV_END = "<!-- nav: made by tools/check_guide.py -->", "<!-- /nav -->"

HEADING = re.compile(r"^#{1,6} (.+?)\s*$")
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_LINK = re.compile(r'(?:href|src)="([^"]+)"')


def slug(text: str) -> str:
    """GitHub's anchor for a heading."""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[*_`]", "", text.strip().lower())
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def anchors(path: Path) -> set:
    found, seen, fence = set(), {}, False
    for line in path.read_text().splitlines():
        if line.startswith("```"):
            fence = not fence
            continue
        m = None if fence else HEADING.match(line)
        if m:
            s = slug(m.group(1))
            n = seen.get(s, 0)
            seen[s] = n + 1
            found.add(s if n == 0 else f"{s}-{n}")
        found.update(re.findall(r'<a id="([^"]+)"', line))
    return found


def order() -> list:
    pages = []
    for target in re.findall(r"\]\(([\w-]+\.md)\)", INDEX.read_text()):
        if target not in pages:
            pages.append(target)
    return pages


def title(path: Path) -> str:
    for line in path.read_text().splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def nav(pages: list, i: int) -> str:
    parts = []
    if i > 0:
        parts.append(f"← [{title(GUIDE / pages[i - 1])}]({pages[i - 1]})")
    parts.append("[Contents](README.md)")
    if i < len(pages) - 1:
        parts.append(f"[{title(GUIDE / pages[i + 1])}]({pages[i + 1]}) →")
    return f"{NAV_START}\n\n---\n\n{' · '.join(parts)}\n{NAV_END}\n"


def with_nav(text: str, block: str) -> str:
    if NAV_START in text:
        text = text[:text.index(NAV_START)].rstrip("\n") + "\n"
    return text.rstrip("\n") + "\n\n" + block


def check_link(source: Path, target: str, cache: dict, problems: list):
    if target.startswith(URL):
        local = ROOT / target[len(URL):]
        target = str(local)
    elif re.match(r"^[a-z]+:", target) or target.startswith("//"):
        return
    path, _, anchor = target.partition("#")
    if not path:
        dest = source
    else:
        dest = Path(path) if Path(path).is_absolute() else (source.parent / path)
        dest = dest.resolve()
        if not dest.exists():
            problems.append(f"{source.relative_to(ROOT)}: {target} doesn't exist")
            return
    if anchor and dest.suffix == ".md":
        if dest not in cache:
            cache[dest] = anchors(dest)
        if anchor not in cache[dest]:
            problems.append(f"{source.relative_to(ROOT)}: no heading #{anchor} in {dest.relative_to(ROOT)}")


def main() -> int:
    fix = "--fix" in sys.argv
    problems, cache = [], {}
    pages = order()
    on_disk = sorted(p.name for p in GUIDE.glob("*.md") if p.name != "README.md")
    for name in on_disk:
        if name not in pages:
            problems.append(f"docs/guide/{name} isn't listed in docs/guide/README.md")
    for name in pages:
        if not (GUIDE / name).exists():
            problems.append(f"docs/guide/README.md lists {name}, which doesn't exist")
    pages = [p for p in pages if (GUIDE / p).exists()]

    for i, name in enumerate(pages):
        path = GUIDE / name
        text = path.read_text()
        want = with_nav(text, nav(pages, i))
        if want != text:
            if fix:
                path.write_text(want)
            else:
                problems.append(f"docs/guide/{name}: its previous/next line is out of date")

    sources = [*GUIDE.glob("*.md"), ROOT / "haliday_show" / "DOCS.md", ROOT / "README.md"]
    for src in sources:
        text = src.read_text()
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        for target in LINK.findall(text) + HTML_LINK.findall(text):
            check_link(src, target, cache, problems)

    # The in-app help's links into the guide: guide: ["page.md", "anchor"].
    help_js = ROOT / "haliday_show/app/halidayshow/static/js/help.js"
    for page, anchor in re.findall(r'guide: \["([^"]+)", "([^"]*)"\]', help_js.read_text()):
        check_link(help_js, str(GUIDE / page) + (f"#{anchor}" if anchor else ""), cache, problems)
    # Full links to the guide anywhere in the app or the integration.
    for src in [*(ROOT / "haliday_show/app/halidayshow/static").rglob("*.html"),
                *(ROOT / "haliday_show/app/halidayshow/static").rglob("*.js"),
                *(ROOT / "custom_components").rglob("*.js"), *(ROOT / "custom_components").rglob("*.json")]:
        for target in re.findall(re.escape(URL) + r"[^\s\"'`)]+", src.read_text()):
            check_link(src, target, cache, problems)

    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s). Fix the links; for previous/next lines run: python tools/check_guide.py --fix")
        return 1
    print(f"Guide OK: {len(pages)} pages, every link goes somewhere.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
