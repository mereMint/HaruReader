# Adding content

Create a UTF-8 Markdown file in the appropriate folder and copy one of these headers.

## Skit or short story

```markdown
---
title: "Story title"
order: 1
listed: true
published: true
preview: "A short description shown in the library."
tags: [mystery, Mina]
---

# Story title

Your story starts here.
```

Use `src/skits/` for a skit or `src/stories/` for a short story. The folder assigns the correct content type automatically.

## Book chapter

```markdown
---
title: "Chapter 1: Title"
volume: "Volume 1"
order: 1
listed: true
published: true
preview: "A short description shown in the library."
---

# Chapter 1: Title

Your chapter starts here.
```

Save it as `src/books/book-name/chapter-01.md`. The `book-name` folder becomes the visible series name.

Optional content warnings can be placed directly below the title:

```markdown
> **Content warning:** violence, death
```

Do not edit `content-manifest.json` by hand. Run `tools/publish.ps1`, or let the GitHub Action rebuild it after pushing.
