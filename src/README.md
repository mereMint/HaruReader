# Adding content

Create a UTF-8 Markdown file in the appropriate folder and copy one of these headers.

## Canonical short story

```markdown
---
title: "Story title"
order: 1
listed: true
published: true
canon: true
canonId: "haru.story-name"
continuity: "main"
storyYear: 2083
timelineOrder: "TBD"
preview: "A short description shown in the library."
tags: [mystery, Mina]
---

# Story title

Your story starts here.
```

Files under `src/stories/` can be promoted to Harutronic canon. Canon promotion is deliberate: `published: true` controls publication, while `canon: true` controls canon status. Every published story must declare canon status explicitly. Every canonical story needs a unique stable `canonId`, a `continuity`, a valid four-digit `storyYear` or `"TBD"`, and a positive numeric `timelineOrder` or `"TBD"`.

When only a directly linked sequence is known, keep the global `timelineOrder` as `"TBD"` and add a stable sequence:

```yaml
sequenceId: "linked-story-sequence"
sequenceOrder: 1
```

Filenames are not permanent canon identifiers and may change without changing `canonId`.

## Skit or non-canon story

Use `src/skits/` for a skit. Skits are non-canon by default and must explicitly use:

```yaml
canon: false
```

A skit may become canon only after a separate continuity review. Deliberate promotion requires moving it to `src/stories/`, assigning a unique `canonId`, and updating the Harutronic canon index. Files that remain under `src/skits/` must use `canon: false`; publication alone never promotes a skit.

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
