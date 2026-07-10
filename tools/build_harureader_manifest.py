from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
SKITS = SRC / "skits"
NOVEL = SRC / "novel"


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end].strip().splitlines()
    body = text[text.find("\n", end + 1) + 1 :]
    meta: dict[str, object] = {}
    for line in raw:
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value.lower() in {"true", "false"}:
            meta[key] = value.lower() == "true"
        else:
            try:
                meta[key] = int(value)
            except ValueError:
                meta[key] = value
    return meta, body


def clean_markdown(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"[#>*_`\[\]()]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_for(path: Path, body: str, meta: dict[str, object]) -> str:
    if meta.get("title"):
        return str(meta["title"])
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    name = re.sub(r"^\d+[-_ ]*", "", path.stem)
    return name.replace("-", " ").replace("_", " ").title()


def excerpt_for(body: str, title: str) -> str:
    text = clean_markdown(body)
    if text.lower().startswith(title.lower()):
        text = text[len(title):].strip(" -–—:\n\t")
    return (text[:170] + "…") if len(text) > 170 else text


def slug(value: str) -> str:
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "text"


def order_for(path: Path, meta: dict[str, object]) -> int:
    if isinstance(meta.get("order"), int):
        return int(meta["order"])
    chapter = re.search(r"chapter[-_ ]*(\d+)", path.stem, re.I)
    if chapter:
        return int(chapter.group(1))
    prefix = re.match(r"^(\d+)", path.stem)
    return int(prefix.group(1)) if prefix else 999


def add_entry(path: Path, fallback_kind: str) -> dict[str, object] | None:
    if path.name.startswith("_") or path.name.lower() == "readme.md":
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    meta, body = parse_frontmatter(text)
    if meta.get("listed") is False or meta.get("published") is False:
        return None
    kind = str(meta.get("kind") or fallback_kind)
    title = title_for(path, body, meta)
    rel = path.relative_to(ROOT).as_posix()
    entry: dict[str, object] = {
        "id": slug(rel),
        "kind": kind,
        "type": str(meta.get("type") or kind),
        "title": title,
        "path": rel,
        "order": order_for(path, meta),
        "excerpt": excerpt_for(body, title),
        "words": len(re.findall(r"\b[\w'’-]+\b", clean_markdown(body))),
    }
    if meta.get("volume"):
        entry["volume"] = str(meta["volume"])
    return entry


def main() -> None:
    items: list[dict[str, object]] = []

    if SKITS.exists():
        for path in sorted(SKITS.glob("*.md")):
            entry = add_entry(path, "skit")
            if entry:
                items.append(entry)

    if NOVEL.exists():
        for path in sorted(NOVEL.glob("*/*.md")):
            entry = add_entry(path, "novel")
            if entry:
                items.append(entry)

    kind_rank = {"skit": 0, "novel": 1}
    items.sort(key=lambda item: (kind_rank.get(str(item.get("kind")), 9), str(item.get("volume", "")), int(item.get("order", 999)), str(item.get("title", ""))))

    manifest = {
        "name": "HaruReader",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }
    (ROOT / "content-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote content-manifest.json with {len(items)} public entries from src/")


if __name__ == "__main__":
    main()
