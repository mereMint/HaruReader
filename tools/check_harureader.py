from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON_STORY_PATHS = {
    "src/stories/last-stop.md",
    "src/stories/still-breathing.md",
    "src/stories/race-condition.md",
}


def fail(message: str) -> None:
    raise SystemExit(f"HaruReader check failed: {message}")


def parse_value(value: str) -> object:
    value = value.strip().strip('"').strip("'")
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    try:
        return int(value)
    except ValueError:
        return value


def frontmatter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    meta: dict[str, object] = {}
    for line in text[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = parse_value(value)
    return meta


def main() -> None:
    manifest = json.loads((ROOT / "content-manifest.json").read_text(encoding="utf-8"))
    items = manifest.get("items", [])
    ids = [str(item.get("id", "")) for item in items]
    paths = [str(item.get("path", "")) for item in items]

    if not manifest.get("version"):
        fail("manifest version is missing")
    if len(ids) != len(set(ids)):
        fail("manifest contains duplicate IDs")
    if any(path.endswith(("roadmap.md", "README.md")) for path in paths):
        fail("configuration or documentation leaked into the library")
    missing = [path for path in paths if not (ROOT / path).is_file()]
    if missing:
        fail(f"manifest references missing files: {', '.join(missing)}")

    manifest_by_path = {str(item.get("path", "")): item for item in items}
    canon_ids: list[str] = []
    for path in paths:
        source_path = ROOT / path
        source_meta = frontmatter(source_path)
        manifest_item = manifest_by_path[path]
        source_canon = source_meta.get("canon")

        if path in CANON_STORY_PATHS and source_canon is not True:
            fail(f"canonical published story must use canon: true: {path}")
        if path.startswith("src/skits/") and source_canon is not False:
            fail(f"published skit must explicitly use canon: false: {path}")
        if path.startswith("src/skits/") and source_canon is True:
            fail(f"skit cannot become canon without an explicit reviewed override: {path}")

        if source_canon is True:
            canon_id = str(source_meta.get("canonId", "")).strip()
            if not canon_id:
                fail(f"canonical story has no canonId: {path}")
            canon_ids.append(canon_id)
            if not str(source_meta.get("continuity", "")).strip():
                fail(f"canonical story has no continuity: {path}")
            story_year = source_meta.get("storyYear")
            if story_year != "TBD" and not (
                isinstance(story_year, int) and 2000 <= story_year <= 9999
            ):
                fail(f"canonical storyYear must be a four-digit year or TBD: {path}")
            timeline_order = source_meta.get("timelineOrder")
            if timeline_order != "TBD" and (
                not isinstance(timeline_order, int) or timeline_order < 1
            ):
                fail(f"canonical story has invalid timelineOrder: {path}")

        for key in (
            "canon",
            "canonId",
            "continuity",
            "storyYear",
            "timelineOrder",
            "sequenceId",
            "sequenceOrder",
        ):
            if key in source_meta and manifest_item.get(key) != source_meta[key]:
                fail(f"manifest canon field {key} differs from source frontmatter: {path}")

    if len(canon_ids) != len(set(canon_ids)):
        fail("canonical stories contain duplicate canonId values")

    allowed_ambience = {
        "neutral", "rain", "storm", "dark", "night", "danger", "warm",
        "suspense", "grief", "forest", "clinical", "neon", "moonlight",
        "emergency", "monitor", "mist", "flicker",
    }
    for path in paths:
        source = (ROOT / path).read_text(encoding="utf-8")
        cues = re.findall(r"<!--\s*ambient:\s*([^>]+?)\s*-->", source, re.IGNORECASE)
        if not cues:
            fail(f"published story has no ambience cues: {path}")
        cue_names = {name for cue in cues for name in re.findall(r"[a-z-]+", cue.lower())}
        invalid = sorted(cue_names - allowed_ambience)
        if invalid:
            fail(f"published story has unsupported ambience cues: {path}: {', '.join(invalid)}")

    index = (ROOT / "index.html").read_text(encoding="utf-8")
    meta = re.search(r'<meta name="harureader-build" content="([^"]+)">', index)
    if not meta or meta.group(1) != manifest["version"]:
        fail("index build version does not match the manifest")
    for asset in ("assets/styles.css", "assets/app.js"):
        if not re.search(rf'{re.escape(asset)}\?v=[a-f0-9]{{12}}', index):
            fail(f"{asset} is missing its cache version")
    for control_id in ("ttsToggle", "settingsToggle", "ambientToggle", "motionToggle", "ttsFollowToggle"):
        if f'id="{control_id}"' not in index:
            fail(f"reader control is missing: {control_id}")

    app = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    if "inferAmbientScene" in app:
        fail("ambience must come from Markdown cues, not keyword inference")
    if "state.manifest.map(function(it)" in app:
        fail("reader startup is eagerly fetching every story")
    for marker in ("Canon", "Non-canon", "canon-status", "non-canon-status"):
        if marker not in app:
            fail(f"library canon-status tag is missing: {marker}")

    roadmap = (ROOT / "src" / "roadmap.md").read_text(encoding="utf-8")
    entries = re.findall(r"^\s*[+-]\s+.+$", roadmap, re.MULTILINE)
    if not entries:
        fail("roadmap has no timeline entries")

    print(f"HaruReader checks passed: {len(items)} library items, {len(entries)} roadmap entries.")


if __name__ == "__main__":
    main()
