# Flowtime

Flowtime is a task management plugin for Obsidian that puts your tasks in tables — editable, filterable, time-tracked tables. Tag tasks with dates, durations, buckets, projects, and priorities in plain markdown, then view them through one of eight code block renderers. No queries to write, no external dependencies.

The workflow: capture freely into your inbox, tag with `@today` or `@b:deep-work` as you go, then plan your day from the `flowtime-today` table. Reschedule overdue items, track time with countdown timers, and review your week with the weekplan grid. Every edit writes back to your markdown files — your data stays yours.

---

## What it does

Seven code block types show your tasks in different ways:

| Block | Mode | Scope |
|-------|------|-------|
| ` ```flowtime-today` | today | Tasks scheduled for today |
| ` ```flowtime-overdue` | overdue | Tasks with dates before today |
| ` ```flowtime-dueweek` | dueweek | Tasks due tomorrow through Sunday |
| ` ```flowtime-weekly` | weekly | This week's tasks grouped by project |
| ` ```flowtime-project` | project | Tasks for the project containing this code block |
| ` ```flowtime-buckets` | budget | Weekly time-budget overview per bucket |
| ` ```flowtime-sessions` | sessions | Time-tracking session history and analytics |
| ` ```flowtime-weekplan` | weekplan | Week-at-a-glance with list/grid toggle |

## Task entry

**Quick entry (Cmd+Shift+I)** — opens a modal. Type task text, set a date, duration, bucket, and project. Preview the final line before saving.

Date shortcuts: `@today`, `@tomorrow`, `@monday`–`@sunday`, `@next-week`, `@next-monday`, or any `YYYY-MM-DD`.

Durations: `10m`, `30m`, `1h`, `1.5h` — typed inline or picked from the modal.

**@-completions** — type `@` in any note for inline task macros and directives:

- `@td` → new today task, `@tm` → tomorrow, `@now` → 15m today
- `@today`, `@overdue`, `@weekly` → insert code blocks
- `@b:deep-work`, `@p:Website`, `@30m`, `@high` → tag the task

**Inbox capture** — `Inbox.md` lives at vault root. Dump raw thoughts there, one per line. No syntax required. Process them through the **Process Inbox** command — a modal walks each line and lets you promote it to a task, project, wiki entry, or snooze it.

**Auto-Process Inbox** — a faster path: run `Cmd+P` → "Flowtime: Auto-Process Inbox". It scans every line in your inbox and auto-converts items that already have a date (`@today`, `@2026-06-27`, etc.) into proper task lines, routing them to the target file (daily note, project file if `@p:` present, or active file). Items without a date stay in the inbox for manual processing. Snoozed items are left untouched.

Examples of auto-parseable lines:
```
Review PR @today @1h @b:deep-work
Design mockup @tomorrow @p:Website @2h
Fix login bug @2026-06-27 @30m
```

Lines that stay in the inbox (no date → not enough info):
```
Buy groceries
Research authentication libraries
```

Also: `@inbox` anywhere on a line (captures preceding text to inbox) and `@p:ProjectName` (captures to that project's Tasks.md).

## Extract to new note

**Extract to new note (`Ctrl+G` / `Cmd+G`)** — select one or more lines in a note, press the shortcut, and Flowtime creates a new note in the same folder from your selection. The first selected line becomes the title, stripped of list markers, headings, and `@`-directives. All remaining selected lines move to the new note, and the selection is replaced with a `[[wikilink]]` pointing to it. The new note opens in a new tab.

If a file with that title already exists, Flowtime appends ` 2`, ` 3`, etc. to avoid overwrites.

**Undo extract** — run from the command palette to delete the last extracted file. Also attempts `editor.undo()` to revert the source text. Use this within 30 seconds of the extraction.

**Append to existing page** — if the first selected line already contains a `[[wikilink]]` to an existing page (e.g. `[[Meeting Notes]] some context`), Flowtime skips creating a new note. Instead it appends the remaining selected lines to that existing page and replaces the selection with just the `[[wikilink]]`. The target page is opened in a new tab.

Examples:

```markdown
# Before selection (3 lines)
## Active Sprint
- [ ] Fix login bug @today @1h @b:deep-work
- [ ] Review PR @tomorrow

# After Ctrl+G
[[Active Sprint]]

# New note Active Sprint.md
## Active Sprint
- [ ] Fix login bug @today @1h @b:deep-work
- [ ] Review PR @tomorrow
```

With a task as the first line, `@`-directives are stripped from the filename and link:

```markdown
# Before
- [ ] Review PR @today @1h @b:deep-work
- [ ] Merge branch

# After
[[Review PR]]

# New note Review PR.md
- [ ] Review PR @today @1h @b:deep-work
- [ ] Merge branch
```

With an existing page link as the first line, content appends to that page:

```markdown
# Before selection (3 lines)
[[Active Sprint]]
- [ ] New bug fix @today @30m

# After — content appended to Active Sprint.md, link stays in current note
[[Active Sprint]]

# Active Sprint.md now has the new task appended
## Active Sprint
- [ ] Fix login bug @today @1h @b:deep-work
- [ ] Review PR @tomorrow
- [ ] New bug fix @today @30m
```

## Views

Every code block renders as an interactive table **or list** — toggle with the `☰ List` / `⊞ Table` button in the toolbar. Set your preferred default in Settings → Display → Default view.

### Table view

Inline-editable columns with sort, filter, and group:

**Time inputs** — each task row has editable start time and duration fields. Type `7:30`, `45m`, `1.5h` — the end time auto-calculates below. Changes save to the source file after 300ms.

**Countdown timers** — tasks with a duration get a play button. Click to start a countdown. It pauses, resets, plays a sound when done. The progress bar fills from left to right — amber at 80%, red at done. Running a row timer also starts the status bar timer.

**Status bar timer** — shows the active task and remaining time. Left-click to pause/resume, right-click to stop and record the session.

**Checkboxes** — click to toggle `[x]` in the source file. Uses Obsidian's native checkbox styling.

**Date popup** — click the date badge on any row. Pick a date, jump to today/tomorrow/next-week, or click ✕ to backlog it.

**Task detail popup** — click any task text. Edit the date and bucket, open the source file or project note.

**Column visibility** — the ☰ Columns button in any table toolbar lets you toggle individual columns. Defaults shown below:

| Column | Default |
|--------|---------|
| ✓ Checkbox | Always |
| Task text | Always |
| Time | Today mode only |
| Timer | Today mode only |
| Date | All modes except Today |
| Project | Hidden |
| Bucket | Hidden |
| Source | Hidden |
| Actions | Compact modes (overdue/dueweek/weekly) |

**Bulk operations** — compact modes have buttons to assign all visible tasks to today, or backlog them all (overdue mode).

**Filter, sort, group** — each view has a toolbar:

- Filter by bucket, project, date, text, duration, status, or priority. Operators: is, is not, contains, >, <, exists.
- Sort by clicking column headers (table) or dragging (list). Shift-click for multi-column sort.
- Group by bucket, project, date, or status — with nested sub-headers.

### List view

A lightweight alternative to the table — tasks as compact div rows:

```
⠿ ☐ Task text here                     09:00—09:30  ▶ 30:00 ↺
```

- **⠿ Drag handle** — grab to reorder. Tasks get a sort index (`@i:number` in the source file) that persists the new order. Drop between two timed tasks to assign a midpoint time; drop next to one timed task to share its time.
- **Time inputs** — tasks without a time show small start/duration fields. Type a value and it auto-saves.
- **Inline timer** — each row has ▶ play, time display, ↺ reset. Same countdown behavior as the table view.
- **Hover popover** — hover on task text: a floating card shows project, bucket, milestone, priority, date, and source file.
- **Table freeze** — when dragging, the list stays in place (no scrolling) so you can reorder without losing your place.

## Cross-table refresh

Change a task's date or time in one table and all other tables on the same page update automatically. No manual reload.

## Project detection

A task belongs to a project if:

- It lives in a folder with a folder note that has `type: project` frontmatter
- The folder itself is named after a project
- The task text contains `@p:ProjectName`
- It has a `#project/Name` tag (legacy)

Tasks that don't match any project show under "Other".

## Milestones

Milestones are lightweight grouping markers for project tasks. No settings or definitions needed — they emerge naturally from your markdown.

**Tagging tasks:** Add `@ms:milestone-name` to any task line. The milestone appears as a column in table views (toggle it on via the ☰ Columns menu) and you can filter or group by it in any view.

```markdown
- [ ] Launch landing page @2026-07-01 @ms:mvp @1h @b:deep-work
- [ ] Set up analytics @2026-07-02 @ms:mvp @30m
```

**Defining milestones in project notes:** Use `## Name @ms` headings in a project's folder note or Tasks.md. Place tasks underneath the heading — they become part of that milestone in the markdown structure. Add freeform text between tasks to describe goals, scope, or notes for that milestone.

```markdown
## 🚀 MVP Launch @ms

Core goals for the initial release:
- Stripe integration for payments
- Email verification flow

- [ ] Landing page @2026-07-01 @ms:mvp @1h
- [ ] Payment integration @2026-07-05 @ms:mvp @3h

## 📈 Growth Phase @ms

Post-launch improvements focused on retention and referrals.

- [ ] Referral system @2026-08-01 @ms:growth @2h
- [ ] A/B testing framework @2026-08-10 @ms:growth @1.5h
```

Unlike the old sprints feature (removed in v2.0), milestones require no settings, no color pickers, and no start/end dates in the plugin UI. They live entirely in your markdown — the plugin simply exposes them as sortable, filterable, groupable tags.

## Time budgets (buckets)

Organize tasks into categories with weekly hour limits. Built-in buckets: Deep Work, Admin, Meetings. Define your own in `Flowtime/Buckets.md` (YAML frontmatter) or via settings. Tag a task with `@b:deep-work` or `@bucket:deep-work`.

The `flowtime-buckets` view shows progress bars per bucket — normal (accent), warning (amber >80%), over (red >100%). There's also a configurable daily cap with a progress bar in the today view.

Bucket definitions live in `Flowtime/Buckets.md` at vault root — a plain markdown file that syncs and is readable without the plugin. See [Agent access](#agent-access-v170) below.

## Session history

Every time the status bar timer stops (or a row timer finishes), a session is recorded. The `flowtime-sessions` view shows a filterable history table with daily totals and per-bucket breakdown. Sessions live in `.obsidian/plugins/flowtime/sessions/` — hidden from the file explorer but synced.

## Recurrence & routines

Mark tasks with `🔁` to make them repeat:

| Syntax | Meaning |
|--------|---------|
| `🔁 every day` | Every day |
| `🔁 every workday` | Monday–Friday |
| `🔁 every week` | Every Monday |
| `🔁 every month` | 1st of every month |
| `🔁 every Mon` | Every Monday |
| `🔁 every Mon Wed Fri` | Monday, Wednesday, Friday |
| `🔁 every 2nd Sun` | 2nd Sunday of each month |
| `🔁 every last Fri` | Last Friday of each month |
| `🔁 every month on 15th` | 15th of every month |
| `🔁 every 3 days` | Every 3 days from last generation |

Put these lines in `.md` files inside `Flowtime/Routines/` (configurable). The plugin reads the folder, figures out what's due, and writes real task instances into your daily notes. Generation history is tracked in the plugin folder to prevent dupes across synced devices.

Delete an instance and it stays gone — the engine won't recreate it. Vacation mode (toggle in settings or the weekplan toolbar) pauses all generation.

On plugin load, the engine generates instances for today and the rest of the week. It also watches the routines folder for changes.

To support long-running Obsidian sessions, the engine re-generates automatically at **6 AM and 6 PM** each day. This ensures new routine tasks appear without needing a restart, even if Obsidian stays open for days or weeks at a time.

## Weekplan view

````markdown
```flowtime-weekplan
```
````

Shows Monday–Friday with all your week's tasks. Two view modes you can toggle:

**List view** — day-by-day sections. Each day shows scheduled hours vs. daily cap as a progress bar. Inline editing for time, duration, checkbox, delete. Routines get a 🔁 badge.

**Grid view** — horizontal timeline grid:

| | Mon 24 | Tue 25 | Wed 26 | Thu 27 | Fri 28 |
|---|--------|--------|--------|--------|--------|
| 09:00 | Deep Work | Meeting | Writing | Deep Work | Standup |
| 10:00 | | | | | |

Tasks sit in their time range (30min slot rows). The current day and time slot are highlighted. Click a card to edit time, duration, checkbox, or delete. Untimed tasks live at the bottom of each day column.

## Templates

Four commands:

- **Insert daily dashboard** — drops `flowtime-today` + `flowtime-overdue` blocks at cursor
- **Insert weekly dashboard** — drops `flowtime-weekly` + `flowtime-dueweek` blocks
- **Insert weekplan** — drops `` ```flowtime-weekplan ``` `` block at cursor
- **Create Daily/Weekly Dashboard** — creates the actual Dashboard.md files at vault root

## Content width

Settings → Display has a slider for reading view max width. Default 0 uses Obsidian's ~700px. Slide it to 1920px to give tables more room. Applies live.

## Task format

Flowtime parses task lines from any markdown file in your vault:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `[ ]` / `[x]` | Checkbox status | `- [ ] Task name` |
| `HH:mm—HH:mm` | Time block | `09:00—11:30` |
| `@YYYY-MM-DD` or `⏳ YYYY-MM-DD` | Scheduled date | `@2026-06-24` |
| `@Nh` or `@Nm` | Duration | `@1.5h` or `@30m` |
| `@b:name` or `@bucket:name` | Time bucket | `@b:deep-work` |
| `🔺⏫🔼🔽⏬` | Priority | |
| `@p:Name` | Project assignment | `@p:website` |
| `@i:number` | Sort index (drag reorder) | `@i:5500` |
| `🔁 every <interval>` | Recurrence | `🔁 every workday` |

Complete example:

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🔼 @1.5h @b:deep-work
```

## Floating Editor

Click any task text (in table or list view) to open the floating editor — a unified editing dialog for all task fields:

- **Task text** — edit inline, preserves `@`-directives automatically
- **Date** — date picker
- **Duration** — dropdown (10m–4h)
- **Bucket** — dropdown from configured buckets
- **Project** — read-only display with link to project note
- **Source link** — 🔗 button in the top-right corner opens the source markdown file at the task's line

Save with Enter or the Save button. Click outside to dismiss. The old read-only hover popover is gone — click now opens the editor in both table and list views.

## Enhanced Markdown Notes

Add `type: flowtime-list` to a note's frontmatter to activate live task enhancement. No code blocks needed — the note itself becomes interactive:

- **Drag handles** — ⠿ on every task line for drag-and-drop reorder
- **Checkbox toggle** — click to check off, writes back to the source file
- **Inline timer** — ⏱ button starts a countdown per task
- **Heading drop zones** — drag a task onto `### Today`, `### Tomorrow`, `### Soon`, `### Next Week`, or `### YYYY-MM-DD` to change its date/status
- **Recurrence handling** — completing a recurring task auto-generates the next instance

## Tab History

When you close a tab (Cmd+W) that you navigated to from a Flowtime link, the plugin automatically returns you to the previous tab instead of the next one in the tab bar. Enabled by default in Settings → Notifications → Tab history. Useful after clicking the 🔗 source link in the floating editor.

## Performance

The `TaskIndex` cache eliminates repeated full vault scans on every render — tasks are indexed once at startup and updated incrementally. Drag-drop in list view uses batched DOM reads and O(1) row lookups to avoid layout thrashing. See `docs/perf-improvements.md` for details.

## Setup

**New project** — run the command, enter a name. Creates a folder with a project note, optionally Tasks.md and Wiki.md.

**Daily dashboard** — add to your daily note template:

````markdown
## 🔄 Carry Over
```flowtime-overdue
```

## 🎯 Today
```flowtime-today
```

## ⚠️ Due This Week
```flowtime-dueweek
```
````

**Weekly dashboard:**

````markdown
## 📊 This Week
```flowtime-weekly
```

## ⚠️ Due Next Week
```flowtime-dueweek
```
````

**Budget overview:**

````markdown
## 📊 Weekly Budget
```flowtime-buckets
```
````

## Settings

In Settings → Flowtime.

| Setting | Default | Description |
|---------|---------|-------------|
| **Project Detection** | | |
| Frontmatter key | `type` | Frontmatter field marking a note as a project root |
| Frontmatter value | `project` | Value of that field |
| Project name key | `name` | Frontmatter field used as display name |
| Fallback to folder name | on | Use folder name when no frontmatter marker is found |
| Tag prefix | `project/` | Prefix for @p: project tags |
| Projects root | (empty) | Root folder for project detection; empty = scan entire vault |
| **Quick Entry** | | |
| Default target file | daily-note | Where new tasks save: daily note / active file / project file / inbox |
| **Inbox** | | |
| Inbox file path | `Inbox.md` | Path to the inbox file |
| Default duration | 30m | Pre-filled duration when processing inbox items |
| Default bucket | (none) | Pre-filled bucket when processing inbox items |
| **Buckets** | | |
| Bucket tag prefix | `budget/` | Prefix for bucket inline tags |
| Daily budget cap | 12h | Maximum scheduled hours before warning |
| Bucket definitions | `Flowtime/Buckets.md` | Canonical source (YAML frontmatter). Also editable in settings. |
| **Notifications** | | |
| Timer sound | on | Beep when a countdown timer reaches zero |
| Notice duration | 4000ms | Notification display time |
| Quiet mode | off | Suppress non-error notices |
| Tab history | on | Navigate back to previous tab on close instead of next tab |
| **Display** | | |
| Default view | Table | Default view for code blocks: Table or List |
| Date format | YYYY-MM-DD | Moment.js format for dates |
| Show timer in status bar | on | Show/hide the persistent countdown |
| Content width | 0 | Slider (0–1920px). 0 = use Obsidian default width |
| **Routines** | | |
| Routines folder | `Flowtime/Routines/` | Folder for routine template `.md` files |
| Vacation mode | off | Pause all routine generation |
| Auto-generate on startup | on | Run routine engine when plugin loads |
| Auto-generate on open daily note | on | Generate when today's daily note is opened |
| Workdays | 1,2,3,4,5 | Day indices for 🔁 every workday (0=Sun, 6=Sat) |
| Week start day | Monday | First day of the week for weekplan view |
| Hide completed routines | off | Don't show checked-off routines in weekplan |
| **Templates** | | |
| Daily template | (built-in) | Template for the daily dashboard command |
| Weekly template | (built-in) | Template for the weekly dashboard command |
| Project template | (built-in) | Template for new project notes |

## Agent access (v1.7.0)

Flowtime stores user-facing data as plain markdown in the `Flowtime/` directory at your vault root. This means AI coding agents can read and write bucket definitions, routine templates, and sprint plans without needing access to Obsidian plugin internals.

```
vault/
├── Flowtime/              ← Agent-accessible markdown (syncs with your vault)
│   ├── Buckets.md         ← Bucket definitions (YAML frontmatter)
│   └── Routines/          ← Routine template .md files
├── .obsidian/
│   └── plugins/flowtime/
│       ├── data.json      ← Plugin mechanics (timerSound, dailyCap, etc.)
│       └── sessions/      ← Time-tracking session data
```

**`Flowtime/Buckets.md` format:**

```markdown
---
buckets:
  - id: deep-work
    name: Deep Work
    color: "#4a9eff"
    weeklyLimit: 20
    sortOrder: 0
  - id: admin
    name: Admin
    color: "#a8a8a8"
    weeklyLimit: 5
    sortOrder: 1
---
```

The plugin reads this file on startup and writes changes back on every settings save. Agents edit the YAML frontmatter directly — reload Obsidian to pick up changes.

## Requirements

Obsidian v1.8.7+

## Privacy

Flowtime scans your vault's markdown files to find task annotations, time blocks, project frontmatter, and tags. This scanning is entirely local — no data leaves your vault, and there are no network requests, telemetry, or analytics. The plugin works fully offline.

What the plugin accesses:

- **File paths** — reads file names and paths to discover task-carrying notes
- **File content** — reads markdown files to parse inline task syntax
- **Metadata cache** — uses Obsidian's built-in cache for frontmatter lookups (avoids raw file reads where possible)

Flowtime does not collect, transmit, or store any of your data outside your Obsidian vault.

## Development

```bash
npm run build
cp dist/main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/flowtime/
npm run release
cp -r dist/ /path/to/vault/.obsidian/plugins/flowtime/
# Reload Obsidian
```
