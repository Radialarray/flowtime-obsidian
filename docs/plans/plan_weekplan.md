# Weekplan Mode — Routines + Weekly Planning

Design doc for adding routine generation and a week-level planning view to Flowtime.

---

## Problem

Recurring tasks in Flowtime are a dead end today. `🔁 every day` gets parsed but never acted upon — there's no engine that generates task instances from templates. Users manually copy-paste the same tasks every day/week.

There's also no week-level planning view. The `flowtime-weekly` block groups tasks by project, but you can't see your entire Monday–Friday schedule laid out and tweak it before the week starts.

---

## Solution Overview

Two features that build on each other:

### Feature A: Routine Engine

A new engine that scans a designated routines folder, parses template task lines with recurrence markers, and generates real task instances into daily notes.

### Feature B: Weekplan View

A new `flowtime-weekplan` code block that renders Monday–Friday with all tasks (routines + one-offs) in a day-by-day list layout, with inline editing.

---

## Design Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Where do routines live? | `flowtime/routines/` folder (configurable in settings) |
| 2 | How is interval specified? | Per-line. Each task line gets a recurrence marker (see syntax below) |
| 3 | Where does the engine write instances? | Daily notes (`YYYY-MM-DD.md`). Routines become real, editable tasks. |
| 4 | What if a generated instance is deleted? | It's gone. Permanently. The engine won't re-create it unless you re-add the routine template. This lets you skip a day without fighting the engine. |
| 5 | What if a generated instance is moved to another day? | Treated as a regular task. The engine won't re-create for the original slot. |
| 6 | How does the engine know what's already been generated? | A metadata file `flowtime/routines/.generated.json` tracks `{ routineFile, taskLineHash, targetDate }` — stored in the vault, so it syncs across devices and prevents double-generation. |
| 7 | Are routine times fixed or relative? | Fixed. `@06:00—06:30` means exactly that slot. Users edit instances directly if they want to shift. |
| 8 | How do users skip routines globally? | **Vacation mode** — a toggle in settings or a quick-action button that pauses all routine generation until turned off. |
| 9 | Weekplan layout order? | Phase 1: day-by-day list. Phase 2: horizontal timeline grid. |
| 10 | Does the weekplan view show routines only or all tasks? | All tasks for each day — routines (labelled "🔁") + one-off tasks. |

---

## Recurrence Syntax

Extend the existing `🔁` marker with interval specifiers. The parser already understands `🔁 every day/week/month`. Add:

| Marker | Meaning |
|--------|---------|
| `🔁 every day` | Every day (existing, now actionable) |
| `🔁 every workday` | Monday–Friday |
| `🔁 every week` | Every Monday (existing, now actionable) |
| `🔁 every month` | 1st of every month (existing, now actionable) |
| `🔁 every Sun` | Every Sunday |
| `🔁 every Mon Wed Fri` | Monday, Wednesday, Friday |
| `🔁 every 2nd Sun` | 2nd Sunday of each month |
| `🔁 every month on 15th` | 15th of every month |
| `🔁 every 3 days` | Every 3 days from last generation |

Internally, the parser extracts `unit` and `params` from the marker string. The engine evaluates "is today a match?" based on the marker.

---

## Routine Engine — Architecture

### Files

```
flowtime/routines/
├── Daily.md             ← Template file (any name, any file)
├── Morning.md           ← Another template file
├── Weekly Review.md
└── .generated.json      ← Metadata: { routineFile, taskLineHash, targetDate, marker }
```

### Engine Flow

```
1. Plugin loads
   ↓
2. Engine scans flowtime/routines/*.md
   ↓
3. For each routine file → parse task lines with recurrence markers
   ↓
4. For each task line:
   - Hash the line to get a stable fingerprint
   - Check .generated.json: has this line already been generated for today (or this week/month)?
   - If not → evaluate recurrence against today:
     - "every day" → yes
     - "every workday" → yes if Mon-Fri
     - "every week" → yes if Monday
     - "every Mon Wed Fri" → yes if day matches
     - "every 2nd Sun" → yes if second Sunday of month
     - etc.
   - If due → write task line to the daily note, record in .generated.json
5. Done
```

### Trigger Points

- Plugin load (background, debounced)
- Each time the daily note is opened (if it's today's date and doesn't have routines yet)
- A "Generate Routines" command in the command palette
- A "Regenerate Routines" button in the weekplan view toolbar
- Manual: user edits a routine file → watches for save (debounced)

### Anti-duplication

`.generated.json` is key to this working across devices. Since it lives in the vault and syncs via Obsidian Sync/Git, every device sees the same generation state. Schema:

```json
{
  "entries": [
    {
      "routineFile": "flowtime/routines/Daily.md",
      "lineHash": "sha256-of-line-content",
      "targetDate": "2026-06-24",
      "generatedAt": "2026-06-24T06:00:00"
    }
  ]
}
```

If a task line is deleted from the daily note, the entry stays in `.generated.json` — the engine sees it was already generated and won't re-create it. If the user wants it back, they can clear the entry or re-add the routine.

---

## Weekplan View — Day-by-Day List (Phase 1)

### Code Block

```
## This Week
```flowtime-weekplan
```

```

### Render Output

```

┌─────────────────────────────────────────────────────────┐
│ 📅 Week 26 — Mon 24 Jun → Fri 28 Jun    [🔄] [✏️] [⏸] │
│                                                         │
│  Monday 24 Jun — 6.5h / 12h ████████░░░░               │
│  ⏰ 06:00—06:30  Morning pages        🔁 daily  [☐] 🗑️│
│  ⏰ 06:30—06:45  Review goals         🔁 daily  [☐] 🗑️│
│  ⏰ 09:00—12:00  Deep Work: Feature X          [☐] ⏱  │
│  ⏰ 13:00—14:30  Client Meeting  @p:Acme      [☐] 🗑️ │
│  ⏰ 16:00—17:00  Daily review       🔁 daily  [☐] 🗑️ │
│  ────────────────────────────────────────               │
│                                                         │
│  Tuesday 25 Jun — 4.0h / 12h ████░░░░░░░░              │
│  ⏰ 06:00—06:30  Morning pages        🔁 daily  [☐] 🗑️│
│  ⏰ 06:30—06:45  Review goals         🔁 daily  [☐] 🗑️│
│  ⏰ 10:00—11:00  Standup prep                 [☐] 🗑️ │
│  ...                                                   │
│                                                         │
│  ➕ Add task to this week                               │
└─────────────────────────────────────────────────────────┘

```

### Interactions

- **Checkbox** — checks off the task in the source file
- **🗑️** — removes the task instance from this day (records it as deleted in `.generated.json`)
- **⏱** — starts/stops inline countdown timer (reuses existing timer code)
- **Time/duration dropdowns** — inline editing like today's table
- **🔄** — regenerate routines (re-evaluates what's due)
- **⏸** — toggle vacation mode (pause all routine generation)
- **Daily budget bar** — visual progress bar showing scheduled hours / daily cap
- **➕ Add task** — quick entry modal, pre-sets date to the selected day

### Data Flow

The weekplan renderer loads tasks for each day (Mon-Fri) using the same `_getFileTasks` pipeline used by other modes, plus routine instances that haven't been written yet. It combines them and renders day-by-day.

---

## Weekplan View — Horizontal Timeline Grid (Phase 2)

Later enhancement. A proper week grid:

```

┌────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│            │ Mon 24   │ Tue 25   │ Wed 26   │ Thu 27   │ Fri 28   │
├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ 06:00      │ Morning  │ Morning  │ Morning  │ Morning  │ Morning  │
├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ 07:00      │          │          │          │          │          │
├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ 08:00      │          │          │          │          │          │
├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ 09:00      │ Deep     │ Meeting  │ Deep     │ Writing  │ Standup  │
│            │ Work     │          │ Work     │          │          │
├────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ ...        │          │          │          │          │          │
└────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

```

Tasks appear as cells spanning their time range. Drag-to-resize. Click to edit. Routines shown with a subtle border/label indicating they're routine-generated.

---

## Settings to Add

Under a new "Routines" section in settings:

| Setting | Default | Description |
|---------|---------|-------------|
| Routines folder | `flowtime/routines/` | Where routine template files live |
| Vacation mode | off | Pause all routine generation |
| Auto-generate on startup | on | Run routine engine when plugin loads |
| Generate when opening daily note | on | Also run when today's daily note is opened |
| Workdays | Mon,Tue,Wed,Thu,Fri | Define what "workday" means |
| Hide completed routines | off | Don't show checked-off routines in weekplan |
| Week start day | Monday | First day of the week |

---

## Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `src/routine-engine.js` | Scans routines folder, evaluates recurrence, generates instances, tracks `.generated.json` |
| `src/recurrence-parser.js` | Parses `🔁 every ...` strings into structured interval objects |
| `src/weekplan-renderer.js` | Renders the `flowtime-weekplan` block (day-by-day list) |

### Modified files

| File | Changes |
|------|---------|
| `src/renderer.js` | Register `weekplan` mode alongside `today`/`weekly`/etc |
| `src/task-parser.js` | Tighten recurrence extraction, add workday/custom-day support |
| `src/settings.js` | Add routines section with folder path, vacation toggle, workday config |
| `main.js` | Wire RoutineEngine into plugin lifecycle (load, save, commands) |
| `styles.css` | Weekplan list layout styles + timeline grid styling (Phase 2) |

---

## Implementation Order

1. **Recurrence parser** — extend `parseRecurrence` to handle all interval types
2. **Routine engine** — scan routines folder, evaluate due tasks, write instances, track `.generated.json`
3. **Settings** — routines section in settings tab
4. **Weekplan view (list)** — new code block mode, day-by-day rendering
5. **Vacation mode** — global toggle that suppresses generation
6. **Weekplan view (timeline grid)** — horizontal grid view (later phase)

---

## Open Questions

- Should the routine file itself be rendered as a preview somewhere (so you can see what's in it without opening the file)?
- What about routine files that contain non-task content (notes, headers)? — skip non-task lines, they're just context for the template
- Should routine tasks have a special visual indicator in the daily note (a routine badge/icon) that's separate from the `🔁` in the text?
- How does the engine handle a routine file that's been deleted? — `.generated.json` entries for it get cleaned up on next run
- When exactly is "monthly" generated? 1st of month, or the date the routine was created?
