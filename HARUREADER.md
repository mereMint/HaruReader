# HaruReader

A small static GitHub Pages reader for selected Harutronic skits and future novel chapters.

## Important idea

HaruReader does **not** scan the whole repository. It only publishes curated files from `src/`.
That means you upload/copy only the skits you think are good enough into `src/skits/`.
Drafts, Obsidian notes, AI instructions, logistics, and worldbuilding notes stay out of the website.

## Source structure

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

## Naming + titles

Use **both** filename convention and front matter:

- Filename = clean path: `src/skits/basic-maintenance.md` or `src/novel/volume-01/chapter-01.md`.
- Front matter = real display metadata: title, kind, order, volume, visibility.

Example skit:

```md
---
title: "Basic Maintenance"
kind: "skit"
order: 1
listed: true
published: true
---
```

Example novel chapter:

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

Hide something from the website with:

```yaml
listed: false
```

or:

```yaml
published: false
```

## Files

- `index.html` is the whole app shell.
- `assets/styles.css` contains the black/white minimal design, dark mode by default.
- `assets/app.js` loads Markdown files directly in the browser.
- `content-manifest.json` lists public `src/` files.
- Reading progress is stored locally in the browser with `localStorage`.
- The reader has a typewriter reveal and a “Show instantly” fallback.

## Updating the library

When you add, rename, hide, or remove public texts, rebuild the manifest:

```bash
python tools/build_harureader_manifest.py
```

Then commit the changed `content-manifest.json` together with your `src/` files.

## GitHub Pages

This is static: no server, no backend, no npm build step. Enable GitHub Pages for the repository and serve from the `main` branch root.
