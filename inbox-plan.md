# Flowtime Inbox — Implementation Plan

## Overview

Add an **inbox capture + processing** feature to the Flowtime plugin. A single `Inbox.md` file at vault root accepts raw lines (no syntax required). A processing command lets the user transform each line into a proper Flowtime entity: task, project, or wiki note.

## Guiding Principles

- **Capture first, organize later.** The inbox imposes no syntax rules. Any line is valid.
- **Process in batch.** One command opens a modal that walks through unprocessed lines.
- **Progressive detail.** Tags in the inbox line (`@today`, `@b:`, `#project/`) are preserved and pre-filled during processing.
- **Delete on process.** Once a line is processed, it's removed from the inbox. No archive section.
- **No auto-processing.** The user always decides what each line becomes.
- **Single inbox file.** `Inbox.md` at vault root. No multi-inbox support.

---

## 1. Inbox File

### Location

`Inbox.md` at the vault root (configurable via `inboxPath` setting).

### Auto-create

On plugin load, if `Inbox.md` doesn't exist, create it with:

```markdown
# 📥 Inbox

Capture tasks, ideas, and notes here. One line per item.
Process them with **Flowtime: Process Inbox**.
```

(Only if the configured `inboxPath` doesn't already exist.)

### What It Accepts

| Type | Example | Notes |
|------|---------|-------|
| Plain text | `Fix the login button` | No syntax required at all |
| Formatted task | `- [ ] Update docs @today @30m` | Existing task syntax preserved |
| Tagged line | `Research SSR @b:deep-work #project/Website` | Tags are pre-filled during processing |
| URLs / fragments | `https://example.com/api-docs` | Left as-is, user decides action |
| Ideas / notes | `Maybe write a blog post` | Could become task, project, or wiki note |

### What's NOT Allowed

- Blank lines — skipped silently (treated as separators, not items)
- Lines starting with `#` or `##` — treated as headings, not items to process

---

## 2. Capture Methods

### Method A: Open Inbox.md directly

User opens `Inbox.md` in Obsidian and types raw lines. The @-completions system (`AtCompletionsSuggest`) works inside the inbox file — if they want to add context, they can, but it's optional.

### Method B: `@inbox` macro (new)

Inside `Inbox.md` (or anywhere), typing `@inbox` on a blank line expands to `- [ ]` — a quick task skeleton for capture-fast mode. This is a new command macro in `AtCompletionsSuggest`.

### Method C: Quick Entry → Inbox target (new)

A new option in the `quickEntryTargetFile` setting: `"inbox"`. When selected, `Cmd+Shift+I` (Add Task) writes the task line directly to `Inbox.md` instead of the daily note or active file. The line is stored raw (no date required).

### Method D: "Append to Inbox" command (new)

A simple command `Flowtime: Append to Inbox` that shows a text prompt modal — just a textarea and submit. Raw text goes as a new line at the end of `Inbox.md`. Minimal UI, minimal friction.

---

## 3. Processing — The Core Feature

### Command

**`Flowtime: Process Inbox`** — no hotkey by default (user can assign in Obsidian settings).

### What It Does

1. Reads `Inbox.md`
2. Parses all "processable lines" (non-blank, non-heading)
3. Opens a modal showing them one at a time (or as a list, see UI options below)
4. For each line, user picks an action and provides the required info
5. After confirming, the line is transformed into its target
6. Processed lines are **removed** from the inbox file
7. User gets a summary notice: "Inbox: 3 processed, 0 skipped"

### Processable Lines — Definition

A line qualifies for processing if it's:

- Non-empty (after trimming)
- Not a heading (`#` or `##` prefix)
- Not a horizontal rule (`---`, `***`, `___`)

Everything else is a candidate. Including already-completed task lines (`- [x] ...`).

The `Inbox.md` file may have a heading structure — only lines **after** the last top-level heading (or between headings, excluding the heading lines themselves) are candidates. This lets the user keep notes/headers in the inbox without them being treated as items.

Actually, simpler rule: **every non-blank, non-heading line** in the file is a candidate. Headings (`#`, `##`, `###`) and blank lines are ignored. This is easier to reason about.

### Actions

| Action | What Happens | Required Input | Optional Input |
|--------|-------------|---------------|----------------|
| **Task** | Line becomes a Flowtime task line and is appended to the target file (daily note, project tasks, or Dashboard) | — | Date, duration, bucket, project, priority |
| **Project** | A new project folder + folder note + Tasks.md are scaffolded. The line becomes the first task in Tasks.md | Project name (pre-filled from line) | Whether to scaffold Wiki.md |
| **Wiki** | The line is appended to the target project's Wiki.md under an "📥 From Inbox" section | Which project | Section header, prepended timestamp |
| **Discard** | The line is removed from the inbox with no further action | — | — |
| **Snooze** | The line stays in the inbox but gets a `@YYYY-MM-DD` appended. It will be skipped in future processing until that date passes | A future date | — |

---

## 4. Processing Modal UI

### Layout

The modal shows one inbox item at a time with:

```
┌─────────────────────────────────────┐
│ 📥 Process Inbox       3 of 12     │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Fix the login button           │ │
│ │ (editable text — tweak before   │ │
│ │  processing)                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Action: [Task ▼]                    │
│                                     │
│ ── Conditional fields ──            │
│ Date:     [today        ▼] 📅      │
│ Duration: [30m          ▼]         │
│ Bucket:   [deep-work    ▼]         │
│ Project:  [Website      ▼] 📁      │
│ Priority: [🔺 High      ▼]         │
│                                     │
│ [ Skip ] [ Process ] [ Done ]       │
└─────────────────────────────────────┘
```

### Key Design Decisions

1. **One-at-a-time** (not a table of all items). Forces focus on one decision at a time. Reduces cognitive load.

2. **Editable text**. The user can tweak the task description before processing. Changes are saved to the inbox line if the user skips back.

3. **Conditional fields**. When "Task" is selected, show date/duration/bucket/project/priority. When "Project" is selected, show project name + scaffold toggles. When "Wiki" is selected, show project selector + section header. When "Discard" or "Snooze", show minimal fields.

4. **Pre-fill from line tags**. If the inbox line contains `@today`, the date field pre-fills to "today". If it contains `@b:admin`, bucket pre-fills to admin. If it contains `#project/Name`, project pre-fills accordingly. The user can override any pre-filled value.

5. **Skip vs. Process**. "Skip" leaves the line untouched in the inbox and moves to the next. "Process" applies the action and removes the line. "Done" exits the modal (lines that weren't processed stay in the inbox).

6. **Progress indicator**. "3 of 12" at the top so the user knows where they are.

---

## 5. Task Output Targets

When a line is processed as **Task**, where does the resulting task line go?

| Setting Value | Behavior |
|--------------|----------|
| `daily-note` (default) | Append to today's daily note. If none exists, create it. Fall back to `Inbox.md` itself as a holding area. |
| `active-file` | Append to the currently open file in Obsidian |
| `project-file` | If a project is assigned, append to that project's Tasks.md or folder note. If no project assigned, fall back to daily note. |
| `inbox` | Not valid for processing (circular). Falls back to daily note. |

This reuses the existing `quickEntryTargetFile` setting. No new setting needed.

---

## 6. Implementation Pieces

### Files

| File | What | New/Edit |
|------|------|----------|
| `src/inbox-processor.js` | `InboxProcessor` class — reads inbox, parses lines, writes back processed output | **New** |
| `src/inbox-processor.js` | `ProcessInboxModal` class — the processing modal UI | **New** |
| `src/append-to-inbox.js` | `AppendToInboxModal` — simple text prompt for quick capture | **New** |
| `main.js` | Register commands, auto-create inbox, register `@inbox` macro, add inbox target to settings | Edit |
| `src/settings.js` | Add `inboxPath` setting field (default `"Inbox.md"`) | Edit |
| `styles.css` | Styling for the processing modal (reuse existing `.flowtime-quick-entry` patterns) | Edit |

### Dependencies

| Dependency | Used For |
|-----------|----------|
| `ProjectEngine` | Project lookup in action dropdowns, resolve project from tag |
| `TemplateEngine` | Scaffold project when action = Project |
| `QuickEntryModal` | Reference UI pattern for the processing modal |
| `date-parser.js` (parseDate) | Date field input (same as Quick Entry) |
| `task-parser.js` (parseTaskLine) | Detecting pre-existing task syntax in inbox lines |

### Step-by-Step Build Order

1. **Settings** — add `inboxPath` to `DEFAULT_SETTINGS` and settings tab
2. **Auto-create** — add inbox file creation in `main.js` onload
3. **`@inbox` macro** — add to `AtCompletionsSuggest` command macros
4. **"Append to Inbox" command** — simple text prompt modal
5. **Quick Entry inbox target** — add `"inbox"` as a valid `quickEntryTargetFile` value; when selected, write to `Inbox.md`
6. **InboxProcessor module** — read/parse/write logic for the inbox file
7. **ProcessInboxModal** — the main processing UI
8. **"Process Inbox" command** — wire up the modal
9. **Styling** — modal layout, spacing, field groups
10. **Edge cases** — empty inbox, all-discarded, concurrent edits, inbox doesn't exist

---

## 7. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Inbox doesn't exist | Show "📥 Inbox not found. Create one?" with option to create or cancel. |
| Inbox is empty | Show "📥 Inbox is empty. Capture some tasks first." and exit. |
| File modified externally during processing | On write-back, re-read the file to get latest version, apply remaining lines, write. |
| No projects exist yet | Project field shows "(none)" and user can type a new project name. If they do, a project is auto-created on task assignment (or they choose "Create Project" action). |
| Line is too long (>500 chars) | Truncate display to 200 chars with "…" but preserve full text for processing. |
| All lines discarded | Modal shows nothing to do, exits cleanly. Inbox file is cleared. |
| Task target file doesn't exist | Create it (for daily notes) or fall back to inbox. Show warning. |

---

## 8. Settings

### New Settings Fields

```jsonc
{
  "inboxPath": "Inbox.md",        // Inbox file path (relative to vault root)
  "inboxDefaultDuration": 30,     // Default duration in minutes (pre-filled in processing)
  "inboxDefaultBucket": "",       // Default bucket id (optional)
  "inboxDefaultProject": ""       // Default project name (optional)
}
```

### Modified Setting

`quickEntryTargetFile` gains a new option: `"inbox"`.

---

## 9. Future Considerations (not in scope)

- **Inbox code block** (`flowtime-inbox`) — renders inbox as an interactive table inline in a note
- **Multiple inbox files** — named inboxes for different contexts
- **Inbox web clipper** — Obsidian URI or plugin API for external capture
- **Batch auto-process by pattern** — e.g., all URLs to wiki, all `- [ ]` lines to tasks
- **Undo processed** — keep a log of transforms for revert
- **Inbox rules/recipes** — YAML config that auto-maps certain patterns

---

## 10. Open Questions for Build Time

1. **Snooze format** — just `@YYYY-MM-DD` appended to the line, or a dedicated `@snooze:YYYY-MM-DD` tag? I'd start with a simple `@snooze YYYY-MM-DD` text appended so it's human-readable.

2. **Wiki section format** — should the line be appended with a timestamp? E.g.:

   ```
   ### 📥 From Inbox (2026-06-24)
   - Research SSR for landing page
   ```

   Or without timestamp, just under a static `## 📥 From Inbox` heading?

   I'd vote: **append under `## 📥 From Inbox` with a bullet line**, optionally prefixed with `- 2026-06-24:` for provenance.

3. **Multiple lines with same action** — if user processes several lines to the same project wiki, should they batch-append or go one by one? One-by-one is simpler and avoids complexity.

4. **Edit existing task from inbox** — if an inbox line already reads `- [ ] Fix login @today @30m @b:deep-work`, should the pre-fill override the existing tags or merge? **Merge** — keep what's there, the user can change in the modal.
