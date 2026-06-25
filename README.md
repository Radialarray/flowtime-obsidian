# Flowtime v1.0.0

Obsidian plugin for daily task planning, timeboxing, and project-aware task management with inline timers. No external dependencies.

---

## What it does

Eight code block types show your tasks in different ways:

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

Also: `@inbox` anywhere on a line (captures preceding text to inbox) and `@p:ProjectName` (captures to that project's Tasks.md).

## Tables

Every code block renders as an interactive table with inline editing.

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

**Filter, sort, group** — each table has a toolbar:

- Filter by bucket, project, date, text, duration, status, or priority. Operators: is, is not, contains, >, <, exists.
- Sort by clicking column headers. Shift-click for multi-column.
- Group by bucket, project, date, or status — with nested sub-headers.

## Cross-table refresh

Change a task's date or time in one table and all other tables on the same page update automatically. No manual reload.

## Project detection

A task belongs to a project if:

- It lives in a folder with a folder note that has `type: project` frontmatter
- The folder itself is named after a project
- The task text contains `@p:ProjectName`
- It has a `#project/Name` tag (legacy)

Tasks that don't match any project show under "Other".

## Time budgets (buckets)

Organize tasks into categories with weekly hour limits. Built-in buckets: Deep Work, Admin, Meetings (add your own in settings). Tag a task with `@b:deep-work` or `@bucket:deep-work`.

The `flowtime-buckets` view shows progress bars per bucket — normal (accent), warning (amber >80%), over (red >100%). There's also a configurable daily cap with a progress bar in the today view.

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

Put these lines in `.md` files inside `Routines/` (configurable). The plugin reads the folder, figures out what's due, and writes real task instances into your daily notes. Generation history is tracked in the plugin folder to prevent dupes across synced devices.

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
| `🔁 every <interval>` | Recurrence | `🔁 every workday` |

Complete example:

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🔼 @1.5h @b:deep-work
```

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
| Bucket definitions | Deep Work/Admin/Meetings | Each has name, color, weekly limit |
| **Notifications** | | |
| Timer sound | on | Beep when a countdown timer reaches zero |
| Notice duration | 4000ms | Notification display time |
| Quiet mode | off | Suppress non-error notices |
| **Display** | | |
| Date format | YYYY-MM-DD | Moment.js format for dates |
| Show timer in status bar | on | Show/hide the persistent countdown |
| Content width | 0 | Slider (0–1920px). 0 = use Obsidian default width |
| **Routines** | | |
| Routines folder | `Routines/` | Folder for routine template `.md` files |
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
