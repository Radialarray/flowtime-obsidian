# List View for Flowtime

Alternative lightweight view for the today/soon tables. Toggleable per-view and configurable as default in settings.

## Motivation

The table view is powerful for scheduling but heavy for quick scanning. A list view reduces visual noise, enables drag-and-drop scheduling, and lets the user reorganize tasks by dragging between note headings.

## Rendering

No `<table>` grid. Each task is a `<div>` row:

```
⠿ ☐ Task text                     09:00 → 09:30  ⏱
⠿ ☐ Another task                                   ⏱
⠿ ☐ Task with only start         10:00             ⏱
```

| Element | Behavior |
|---------|----------|
| `⠿` | Drag handle (`.ft-list-drag`) — `cursor: grab`, starts drag |
| `☐` | Checkbox — same toggle as table view |
| Task text | Click opens source file. Hover shows popover with full metadata |
| `09:00 → 09:30` | Time range — shown only if start+duration set (same format as table time cell) |
| `⏱` | Timer button — same start/stop as table view |

### Popover on hover

Same metadata as the table's detail popup — bucket, project, sprint, priority, source file, date — rendered as a floating card.

## Drag & Drop

### Between list items (time reordering)

- Source dragged between two tasks **both with times** → dragged task gets assigned a slot time (midpoint or next available), persisted to source file
- Source dragged after a timed task followed **only by untimed tasks or end of list** → no time assigned (clear time if set)
- Source dragged between **two untimed tasks or at end** → no change

### On page headings (date/status change)

The note's own markdown headings (h3 `###`) become recognized drop zones:

| Heading text | Drop action |
|---|---|
| `### Today` / `### today` | Set `taskDate = today` |
| `### Tomorrow` / `### tomorrow` | Set `taskDate = tomorrow` |
| `### Overdue` / `### overdue` | Set `taskDate = yesterday` or remove date |
| `### Soon` / `### soon` | Add `@soon`, clear `taskDate` |
| `### Next Week` / `### next week` | Set `taskDate = +7 days` |
| `### YYYY-MM-DD` (e.g. `### 2026-07-01`) | Set `taskDate = that date` |
| anything else | No action |

This makes the note itself a scheduling surface — user writes headings as buckets, then drags tasks between them.

## Toggle & Default

**Toolbar button**: `☰ List` / `⊞ Table` — in today + soon modes. Same location as column visibility button.

**Setting**: `Settings → Default view → Table | List`. Affects new code blocks (and optionally current ones on reload).

## Implementation Plan

### Files to modify
- `src/renderer.js` — add `_renderListView()`, toolbar toggle, popover, drag/drop handlers
- `src/settings.js` — add `defaultView` setting (table/list)
- `src/styles.css` — list view styles, drag states, popover styles

### Breakdown

1. **List view renderer** — `_renderListView()` builds div rows instead of a table
2. **Hover popover** — shared component used in both list + table view
3. **Drag source (list items)** — `dragstart` on `⠿` handle, `dragover`/`drop` between items
4. **Drop zones (headings)** — scan note headings, register as drop targets
5. **Toggle button + state** — toolbar button to switch, setting for default
6. **Persistence wiring** — time swaps → file edits, heading drops → date changes
