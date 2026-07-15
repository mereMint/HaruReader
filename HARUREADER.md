# HaruReader publishing

HaruReader is a static GitHub Pages reader. Stories are Markdown files under `src/`; the library index and cache versions are generated automatically.

## Fast publishing workflow

1. Add or edit a Markdown file using one of the folders below.
2. Edit `src/roadmap.md` when the roadmap changes.
3. Run `powershell -ExecutionPolicy Bypass -File tools/publish.ps1` before committing.
4. Commit and push to `main`.

The GitHub Pages Action rebuilds `content-manifest.json` and updates cache versions during every deployment. This means direct uploads or edits on GitHub also work without manually editing JSON.

For the Action-based publishing flow, set the repository's Pages source once to **GitHub Actions** under **Settings → Pages → Build and deployment**.

## Content folders

- `src/skits/name.md` for skits.
- `src/stories/name.md` for short stories.
- `src/books/book-name/chapter-01.md` for books and chapters. The book folder becomes the series name.

See `src/README.md` for copy-ready frontmatter examples.

## Roadmap

Only edit `src/roadmap.md`. It is intentionally excluded from the library.

- Start completed entries with `+`.
- Start upcoming entries with `-`.
- Use `Title | Description` for each entry.

## Publishing controls

- `published: false` or `listed: false` keeps a file out of the library.
- `comingSoon: true` shows a locked card without a release date.
- `releaseAt: 2026-08-01T18:00:00+02:00` locks content until that time.
- `order` controls ordering within a type or series.

Generated cache versions ensure GitHub Pages loads matching HTML, CSS, JavaScript, the manifest, and the roadmap after each deployment.
