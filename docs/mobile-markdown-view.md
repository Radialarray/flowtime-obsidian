# Mobile Markdown View — Aggregated Task Rendering

## Problem

Mobile usage of Flowtime has fundamental issues:

- **Table view**: unusable on phones, horizontal scroll triggers Obsidian sidebars
- **List view**: better but still custom DOM, drag-and-drop unreliable with touch, swipe gestures conflict with sidebar swipes, time inputs too small
- **ListEnhancer (existing)**: enhances static `- [ ]` lines with checkboxes/timers/drag, but only works on pre-existing task lines — doesn't aggregate from the vault

## Concept

A unified mobile-first view where:

1. **Headings are view selectors**. `## Today` aggregates tasks dated today (like `flowtime-today`). `## Overdue` aggregates overdue. `## Soon` aggregates @soon tasks. `## Weekly` shows this week's plan. Etc.

2. **Tasks rendered as native markdown**. The plugin injects aggregated task lines as standard `- [ ]` lines under each heading. Obsidian renders them natively — no custom table/list DOM, no horizontal scroll, no sidebar conflicts.

3. **ListEnhancer makes them interactive**. Once task lines are in the DOM, the existing ListEnhancer injects drag handles, checkboxes, and timers. Drag tasks between headings to reschedule (drag from `## Overdue` to `## Today` = reassign date to today). Check off a task → updates source file → re-aggregates.

4. **Single source of truth**. Same vault data as the `flowtime` code blocks. Changes made in this view reflect everywhere. Changes made elsewhere reflect here on re-render.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  today-mobile.md                                  │
│  ┌──────────────────────────────────────────────┐│
│  │ ## Today                           [Refresh] ││
│  │ - [ ] Morning review @30m @b:deep-work       ││
│  │ - [ ] Write proposal @2h                      ││
│  │ - [x] Check emails                            ││
│  │                                              ││
│  │ ## Overdue                                    ││
│  │ - [ ] Fix login bug @1h                       ││
│  │                                              ││
│  │ ## Soon                                       ││
│  │ - [ ] Refactor auth @soon                     ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### Data Flow

```
Vault files (Daily.md, Inbox.md, Projects/*.md, etc.)
    │
    ▼
FlowtimeRenderer.loadTasks()  ← same aggregation logic
    │
    ▼
MarkdownAggregator.inject(todayMobileFile, headings, tasks)
    │  writes aggregated - [ ] lines under matching headings
    ▼
today-mobile.md (modified on disk)
    │
    ▼
Obsidian Live Preview renders markdown natively
    │
    ▼
ListEnhancer._enhance() injects drag handles, checkboxes, timers
```

### Heading → Aggregation Mapping

| Heading | Aggregation | Source |
|---------|------------|--------|
| `# Today` or `## Today` | Tasks dated today | `renderMode: "today"` |
| `# Overdue` or `## Overdue` or `## Carry over` | Tasks past their date | `renderMode: "overdue"` |
| `# Soon` or `## Soon` or `## Up next` | Tasks tagged @soon | `renderMode: "soon"` |
| `# Due Week` or `## Due Week` | Tasks due this week | `renderMode: "dueweek"` |
| `# Weekly` or `## Weekly` | This week's plan | `renderMode: "weekly"` |
| `# Backlog` or `## Backlog` | Tasks with no date, no @soon | Not aggregated — user writes manually |

### Refresh Strategy

- **On file save**: debounced re-aggregation (300ms)
- **On checkbox toggle**: immediate re-aggregation of the affected heading
- **On drag-drop to heading**: immediate re-aggregation of source + target headings
- **On timer expiry**: session written, no re-aggregation needed
- **Manual refresh button**: per-heading or global refresh

### ListEnhancer Modifications

Current ListEnhancer only activates on `type: flowtime-list` frontmatter notes. For this to work:

1. Add `type: flowtime-mobile` (or reuse `flowtime-list`) to the mobile note
2. ListEnhancer already handles `- [ ]` lines with checkboxes, timers, drag handles
3. **Need**: touch event support for drag-drop (`touchstart/touchmove/touchend` in addition to mouse events)
4. **Need**: drag-onto-heading triggers re-aggregation with the appropriate date/status change
5. **Need**: checkbox toggle → re-aggregate affected section

### Task Line Format

Injected lines mirror Flowtime's existing format:

```
- [ ] Task text @30m @b:deep-work @2026-06-26 @p:project/MyProject
```

Components:
- `- [ ]` or `- [x]` — markdown checkbox
- Task text — plain text
- `@30m` or `@2h` — duration (optional)
- `@b:bucket-id` — bucket assignment (optional)
- `@YYYY-MM-DD` — date (optional, rendered differently per section)
- `@p:project/path` — project tag (optional)

## Implementation Phases

### Phase 1: MarkdownAggregator module

New file: `src/markdown-aggregator.ts`

```
export function createMarkdownAggregator(app, plugin) {
  // Takes a heading text → resolves to RenderMode
  // Runs loadTasks() aggregation for that mode
  // Formats tasks as markdown lines
  // Injects under matching heading in target file
  // Handles diff-based updates (only changes what's needed)
}
```

Key methods:
- `resolveHeadingMode(heading: string): RenderMode | null`
- `aggregateTasks(mode: RenderMode): Promise<TaskRow[]>`
- `formatTaskLine(task: TaskRow): string`
- `injectSection(file: TFile, heading: string, tasks: TaskRow[]): Promise<void>`
- `refreshAll(file: TFile): Promise<void>`
- `refreshSection(file: TFile, heading: string): Promise<void>`

### Phase 2: ListEnhancer touch support

- Add `touchstart/touchmove/touchend` handlers alongside existing mouse handlers
- 300ms delay kill via `touch-action: manipulation` on drag handles
- Visual feedback: highlight row on touch, scale transform

### Phase 3: Heading drop → re-aggregation

- When a task is dragged onto a heading in the mobile view:
  1. Parse the heading text
  2. Determine the action (date assignment, @soon tag, etc.)
  3. Update the source file via `app.vault.modify()`
  4. Re-aggregate both source and target sections
- Drop zones: same as current ListEnhancer heading logic (`_parseHeadingAction`)

### Phase 4: Mobile default

- On `Platform.isMobile`, replace flowtime code block rendering with a link/button to the mobile markdown view
- Or: auto-open the mobile file when a flowtime block would render
- Add toolbar button "Open as markdown" in desktop mode

### Phase 5: Polish

- Section collapsibility (fold ## Overdue when empty)
- Empty section styling ("No overdue tasks 🎉")
- Manual refresh button per section
- Auto-refresh on file focus
- Bucket progress bars under sections? (stretch)

## Files

| File | Purpose |
|------|---------|
| `src/markdown-aggregator.ts` | New — aggregation + line injection logic |
| `src/list-enhancer.ts` | Modified — touch DnD, heading-drop re-aggregation |
| `src/main.ts` | Modified — wire up aggregator, mobile detection |
| `src/renderer.ts` | Modified — mobile path redirect |
| `docs/mobile-markdown-view.md` | This document |
