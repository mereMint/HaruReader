# HaruReader source structure

Only files in `src/` can appear on the GitHub Pages site.
Keep drafts in your normal writing folders. Copy only the skits/chapters you think are good enough into this folder.

## Exact paths

```text
src/
  skits/
    title.md
    another-title.md
  novel/
    volume-01/
      chapter-01.md
      chapter-02.md
```

## Skits

Put public skits here:

```text
src/skits/basic-maintenance.md
```

## Novel chapters

Put public novel chapters here:

```text
src/novel/volume-01/chapter-01.md
src/novel/volume-01/chapter-02.md
```

## Titles: use front matter, filename as fallback

Best practice: use a clean filename for the URL and a small metadata block for the real displayed title.

```md
---
title: "Basic Maintenance"
kind: "skit"
order: 1
listed: true
published: true
---

# Basic Maintenance

Story text...
```

For novel chapters:

```md
---
title: "Chapter 1 — Neon Rain"
kind: "novel"
type: "chapter"
volume: "Volume 1"
order: 1
listed: true
published: true
---
```

If there is no front matter, HaruReader falls back to the filename/title heading.

## Hide something without deleting it

```yaml
listed: false
```

or:

```yaml
published: false
```

Then rebuild the manifest:

```bash
python tools/build_harureader_manifest.py
```
