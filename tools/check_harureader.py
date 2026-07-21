from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit(f"HaruReader check failed: {message}")


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

    roadmap = (ROOT / "src" / "roadmap.md").read_text(encoding="utf-8")
    entries = re.findall(r"^\s*[+-]\s+.+$", roadmap, re.MULTILINE)
    if not entries:
        fail("roadmap has no timeline entries")

    print(f"HaruReader checks passed: {len(items)} library items, {len(entries)} roadmap entries.")


if __name__ == "__main__":
    main()
