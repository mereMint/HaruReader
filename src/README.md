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

## Story ambience

HaruReader reads subtle background moods from invisible author cues. Place a cue on its own line before a scene:

```markdown
<!-- ambient: rain -->

Rain hammered against the windows.

<!-- ambient: dark -->

She stepped inside the unlit house and closed the door.
```

Moods can be layered when a beat needs more nuance:

```markdown
<!-- ambient: rain, storm, grief -->
```

Available moods are `neutral`, `rain`, `storm`, `dark`, `night`, `danger`, `warm`, `suspense`, `grief`, `forest`, `clinical`, `neon`, `moonlight`, `emergency`, `monitor`, `mist`, and `flicker`. A cue stays active until the next cue. These comments never appear in the story, and readers can turn ambience off from the reading controls.

Use `suspense` while a threat is anticipated, `danger` once it becomes immediate, and `grief` for the emotional aftermath. Setting layers such as `night`, `forest`, `clinical`, and `neon` can remain underneath those emotional layers. `rain` adds rainfall without lightning; combine `rain, storm` only when the scene genuinely includes severe weather and flashes. `moonlight`, `emergency`, `monitor`, `mist`, and `flicker` are accent layers for more specific environments. Use `neutral` to clear every previous layer.
