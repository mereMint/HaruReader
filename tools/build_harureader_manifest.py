from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
INDEX = ROOT / "index.html"


LIST_KEYS = {"tags", "characters"}
CONTENT_FOLDERS = {
    "skits": "skit",
    "stories": "short story",
    "short-stories": "short story",
    "books": "novel",
    "novel": "novel",
    "novels": "novel",
}
BOOK_FOLDERS = {"books", "novel", "novels"}
EXCLUDED_SOURCE_FILES = {"readme.md", "roadmap.md"}
VERSIONED_ASSETS = (
    ("href", "assets/styles.css"),
    ("src", "assets/app.js"),
)


def parse_value(key: str, value: str) -> object:
    value = value.strip().strip('"').strip("'")
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if key in LIST_KEYS:
        value = value.removeprefix("[").removesuffix("]")
        return [part.strip().strip('"').strip("'") for part in re.split(r"[,;]", value) if part.strip()]
    try:
        return int(value)
    except ValueError:
        return value


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end].strip().splitlines()
    body = text[text.find("\n", end + 1) + 1 :]
    meta: dict[str, object] = {}
    current_list_key = ""

    for line in raw:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if current_list_key and stripped.startswith("-"):
            meta.setdefault(current_list_key, [])
            if isinstance(meta[current_list_key], list):
                meta[current_list_key].append(stripped[1:].strip().strip('"').strip("'"))
            continue
        current_list_key = ""
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key in LIST_KEYS and not value:
            meta[key] = []
            current_list_key = key
        else:
            meta[key] = parse_value(key, value)
    return meta, body


def clean_markdown(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    text = re.sub(r"[#>*_`\[\]()]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def content_warning_for(body: str) -> str:
    m = re.search(r'>\s*\*{1,2}Content warning:?\*{0,2}\s*(.+)', body, re.I)
    if m:
        return m.group(1).strip()
    return ""


def title_for(path: Path, body: str, meta: dict[str, object]) -> str:
    if meta.get("title"):
        return str(meta["title"])
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    name = re.sub(r"^\d+[-_ ]*", "", path.stem)
    return name.replace("-", " ").replace("_", " ").title()


def strip_first_title_and_warning(body: str, title: str) -> str:
    lines: list[str] = []
    skipped_title = False
    for line in body.splitlines():
        stripped = line.strip()
        if not skipped_title and stripped.startswith("# ") and stripped[2:].strip().lower() == title.lower():
            skipped_title = True
            continue
        if re.match(r'^>\s*\*?\*?[Cc]ontent warning:?\*?\*?\s*', stripped):
            continue
        lines.append(line)
    return "\n".join(lines)


def excerpt_for(body: str, title: str) -> str:
    text = clean_markdown(strip_first_title_and_warning(body, title))
    return (text[:170] + "…") if len(text) > 170 else text


def slug(value: str) -> str:
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "text"


def display_folder_name(name: str) -> str:
    return name.replace("-", " ").replace("_", " ").strip().title() if name.islower() else name.replace("_", " ").strip()


def series_for(path: Path, meta: dict[str, object]) -> str:
    if meta.get("series"):
        return str(meta["series"])
    rel_parts = path.relative_to(SRC).parts
    if len(rel_parts) <= 1:
        return ""
    first = rel_parts[0]
    if first.lower() in BOOK_FOLDERS and len(rel_parts) > 2:
        return display_folder_name(rel_parts[1])
    if first.lower() in CONTENT_FOLDERS:
        return ""
    return display_folder_name(first)


def tags_for(meta: dict[str, object]) -> list[str]:
    raw = meta.get("tags", [])
    if isinstance(raw, str):
        tags = [part.strip() for part in re.split(r"[,;]", raw) if part.strip()]
    elif isinstance(raw, list):
        tags = [str(part).strip() for part in raw if str(part).strip()]
    else:
        tags = []
    seen: set[str] = set()
    out: list[str] = []
    for tag in tags:
        key = tag.lower()
        if key not in seen:
            seen.add(key)
            out.append(tag)
    return out


def kind_for(path: Path, meta: dict[str, object], tags: list[str]) -> str:
    if meta.get("kind"):
        return str(meta["kind"])
    rel_parts = path.relative_to(SRC).parts
    first = rel_parts[0].lower() if rel_parts else ""
    if first in CONTENT_FOLDERS:
        return CONTENT_FOLDERS[first]
    lowered_tags = {tag.lower() for tag in tags}
    if "skit" in lowered_tags or "skits" in lowered_tags:
        return "skit"
    if "novel" in lowered_tags or "chapter" in lowered_tags:
        return "novel"
    return str(meta.get("type") or "text")


def order_for(path: Path, meta: dict[str, object]) -> int:
    if isinstance(meta.get("order"), int):
        return int(meta["order"])
    chapter = re.search(r"chapter[-_ ]*(\d+)", path.stem, re.I)
    if chapter:
        return int(chapter.group(1))
    prefix = re.match(r"^(\d+)", path.stem)
    return int(prefix.group(1)) if prefix else 999


def add_entry(path: Path) -> dict[str, object] | None:
    if path.name.startswith("_") or path.name.lower() in EXCLUDED_SOURCE_FILES:
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    meta, body = parse_frontmatter(text)
    if meta.get("listed") is False or meta.get("published") is False:
        return None

    tags = tags_for(meta)
    kind = kind_for(path, meta, tags)
    title = title_for(path, body, meta)
    rel = path.relative_to(ROOT).as_posix()
    cw = content_warning_for(body)
    preview = str(meta.get("preview") or excerpt_for(body, title))
    series = series_for(path, meta)

    entry: dict[str, object] = {
        "id": slug(rel),
        "kind": kind,
        "type": str(meta.get("type") or kind),
        "title": title,
        "path": rel,
        "order": order_for(path, meta),
        "preview": preview,
        "excerpt": preview,
        "words": len(re.findall(r"\b[\w'’-]+\b", clean_markdown(strip_first_title_and_warning(body, title)))),
    }
    if tags:
        entry["tags"] = tags
    if series:
        entry["series"] = series
    if cw:
        entry["contentWarning"] = cw
    if meta.get("volume"):
        entry["volume"] = str(meta["volume"])
    if meta.get("releaseAt"):
        entry["releaseAt"] = str(meta["releaseAt"])
    if meta.get("comingSoon") is True:
        entry["comingSoon"] = True
    return entry


def build_version() -> str:
    digest = hashlib.sha256()
    files = sorted(path for path in SRC.rglob("*") if path.is_file())
    files.extend(ROOT / asset for _, asset in VERSIONED_ASSETS)
    for path in files:
        digest.update(path.relative_to(ROOT).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def update_index_versions(version: str) -> None:
    text = INDEX.read_text(encoding="utf-8")
    text, meta_count = re.subn(
        r'(<meta\s+name="harureader-build"\s+content=")[^"]*(")',
        lambda match: f"{match.group(1)}{version}{match.group(2)}",
        text,
        count=1,
    )
    if meta_count != 1:
        raise RuntimeError('index.html needs one <meta name="harureader-build" content="..."> tag')

    for attribute, asset in VERSIONED_ASSETS:
        asset_hash = hashlib.sha256((ROOT / asset).read_bytes()).hexdigest()[:12]
        pattern = re.compile(rf'({attribute}="{re.escape(asset)})(?:\?v=[^"]*)?("[^>]*>)')
        text, count = pattern.subn(
            lambda match: f"{match.group(1)}?v={asset_hash}{match.group(2)}",
            text,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"index.html needs one {attribute} reference to {asset}")

    INDEX.write_text(text, encoding="utf-8")


def main() -> None:
    version = build_version()
    items: list[dict[str, object]] = []

    if SRC.exists():
        for path in sorted(SRC.rglob("*.md")):
            entry = add_entry(path)
            if entry:
                items.append(entry)

    kind_rank = {"skit": 0, "short story": 1, "novel": 2, "text": 3}
    items.sort(
        key=lambda item: (
            str(item.get("series", "")),
            kind_rank.get(str(item.get("kind")), 9),
            str(item.get("volume", "")),
            int(item.get("order", 999)),
            str(item.get("title", "")),
        )
    )

    all_warnings = []
    for item in items:
        cw = item.get("contentWarning", "")
        if cw:
            all_warnings.append(cw)

    manifest_path = ROOT / "content-manifest.json"
    generated_at = datetime.now(timezone.utc).isoformat()
    if manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            if previous.get("version") == version and previous.get("generatedAt"):
                generated_at = previous["generatedAt"]
        except (json.JSONDecodeError, OSError):
            pass

    manifest = {
        "name": "HaruReader",
        "version": version,
        "generatedAt": generated_at,
        "contentWarnings": all_warnings,
        "items": items,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    update_index_versions(version)
    print(f"Wrote content-manifest.json with {len(items)} public entries from src/")


if __name__ == "__main__":
    main()
