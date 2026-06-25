# Flowtime v0.5.0

An Obsidian plugin that turns task management into **interactive tables** with code blocks, inline countdown timers, time budgets, session tracking, a status bar timer, **automatic routine generation**, and a **week planning view** with list and timeline grid modes. Zero external dependencies.

---

## Features

### Code Block Views

Eight code block types give you different perspectives on your tasks:

| Block | Mode | Scope |
|-------|------|-------|
| ` ```flowtime-today` | today | Tasks scheduled for today |
| ` ```flowtime-overdue` | overdue | Tasks with dates before today |
| ` ```flowtime-dueweek` | dueweek | Tasks due tomorrow through Sunday |
| ` ```flowtime-weekly` | weekly | This week's tasks grouped by project |
| ` ```flowtime-project` | project | Tasks for the project containing this code block |
| ` ```flowtime-buckets` | budget | Weekly time-budget overview per bucket |
| ` ```flowtime-sessions` | sessions | Time-tracking session history and analytics |
| ` ```flowtime-weekplan` | weekplan | Week-at-a-glance with list/grid toggle (v0.5.0) |

### Quick Entry (Cmd+Shift+I)

Press **Cmd+Shift+I** (Mac) or **Ctrl+Shift+I** (Windows/Linux) to open the Quick Entry modal. Also available via command palette ("Add Task").

- Natural language date shortcuts:
  - `@today` / `@tomorrow` / `@yesterday`
  - `@monday` through `@sunday` — next occurrence
  - `@next-week` / `@next-month`
  - `@weekend` / `@next-monday`
  - Any explicit `YYYY-MM-DD` date
- Set a duration (`10m`, `30m`, `1h`, `1.5h`)
- Select a project from the dropdown
- Pick a time bucket
- Live preview shows the final task line before saving

### Interactive Time Editing

Each task row has inline time controls:

- **Start time** — text input with datalist (7:00–20:00, 30-min steps) — type any time
- **Duration** — text input with common durations (10m–4h) — type `45m`, `1.5h`, etc.
- **End preview** — auto-calculated end time shown as `→ HH:mm` below the inputs
- **Auto-save** — changes are saved to the source file after 300ms of inactivity

### Per-Row Countdown Timer

Every task with a duration gets a timer column:

- **▶ Play** — start the countdown timer for that task
- **⏸ Pause** — pause without recording
- **↺ Reset** — restart the timer to its original duration
- **Progress bar** — fills from left to right; turns amber at 80%, red at 100%
- Timer blinks red when expired
- Sound plays on expiry (configurable)
- Linked to the status bar timer — starting a row timer starts the status bar timer too

### Status Bar Timer

A persistent timer in the Obsidian status bar:

- **Click** — pause/resume the currently running timer
- **Right-click** — stop and record the session
- Shows task name (truncated) and remaining time
- Displays `⏱ --` when idle
- Records completed sessions to the session store

### Checkbox Toggle

Click the checkbox in any table to toggle task completion:

- Matches **Obsidian's native checkbox** pixel-perfect: 14×14px, 1px border, 4px radius, SVG mask checkmark
- Uses `--checkbox-color` / `--checkbox-border-color` / `--checkbox-radius` CSS variables
- Completed tasks are marked `[x]` in the source file
- Hidden from view on next render

### Project Detection

Flowtime detects which project a task belongs to via:

- **Folder notes** — a `project.md` inside a folder that matches the folder name
- **Frontmatter markers** — `type: project` or any configurable key/value pair
- **Inline tags** — `@p:ProjectName` anywhere in task text
- Uncategorized tasks appear under "Other"

### Time Budgets (Buckets)

Organize tasks into time-buckets with weekly limits:

- Built-in buckets: Deep Work, Admin, Meetings (configurable)
- Each bucket has a name, color, and weekly hour limit
- Tasks tagged with `@b:bucket-id` or `@bucket:bucket-id` are assigned to that bucket
- **Weekly overview** (`flowtime-buckets`): shows progress bars for each bucket vs. limit
- **Daily cap**: configurable daily hour budget with progress bar in today view
- Color-coded states: normal (accent), warning (amber >80%), over (red >100%)

### Session History

Time spent is recorded automatically when the status bar timer stops:

- `flowtime-sessions` view shows a filterable history table
- Filter by date range, bucket, or search task text
- **Session analytics**: daily totals, per-bucket breakdown, summary stats
- Sessions stored in `_flowtime-sessions.json` in your vault

### Filter, Sort & Group

Each table has a toolbar with:

- **Filter** — build a filter with field + operator + value
  - Fields: Bucket, Project, Date, Task Text, Duration, Status, Priority
  - Operators: is, is not, contains, >, ≥, <, ≤, exists, does not exist
  - Active filter shown below the panel
- **Sort** — click any column header to sort; shift-click for multi-column sort
  - Sort indicators (▲/▼) show current direction
- **Group** — primary and secondary grouping
  - Group by: Bucket, Project, Date, Status
  - Sub-group headers for nested organization

### Column Visibility

Click the **☰ Columns** button in any table toolbar to toggle individual columns:

| Column | Default visibility |
|--------|--------------------|
| ✓ Checkbox | Always |
| Task text | Always |
| Time | Today mode only |
| Timer | Today mode only |
| Date | All modes except Today |
| Project | Hidden (toggle on) |
| Bucket | Hidden (toggle on) |
| Source | Hidden (toggle on) |
| Actions | Compact modes (overdue/dueweek/weekly) |

### Bulk Operations

Compact modes (overdue, dueweek, weekly) have bulk action buttons:

- **📅 Assign All to Today** — reschedule every visible task to today
- **🗑 Backlog All** (overdue only) — remove dates from all visible tasks

### Date Popup

Click the date badge in any task row to open a date picker:

- Native date input for picking any date
- Quick buttons: Today, Tomorrow, Next Week
- **✕ Backlog** — remove the date and send to backlog
- Tasks moved to today stay in view; tasks moved to other dates are removed from the current view

### Task Detail Popup

Click any task text to open a floating detail panel:

- Edit the task's date
- Change the task's bucket assignment
- View the project name (click to open)
- View the source file (click to open)
- Close saves pending changes

### Recurrence (v0.5.0)

Mark recurring tasks with `🔁` — the plugin generates real task instances into your daily notes:

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

### Routines Folder (v0.5.0)

Create `.md` files in `flowtime/routines/` with task lines using the recurrence markers above. The plugin scans the folder, evaluates what's due, and writes task instances into your daily notes. Generation history is tracked in `flowtime/routines/.generated.json` to prevent duplication across synced devices.

**How it works:**

1. Create `flowtime/routines/Daily.md` (or any name) with tasks + recurrence markers
2. On plugin load, the engine generates instances for today + rest of the week
3. Each instance becomes a real task line in `2026-06-24.md` — editable, deletable, checkable
4. Deleting an instance removes it permanently — the engine won't re-create it
5. **Vacation mode** (settings or weekplan toolbar) pauses all generation

### Weekplan View (v0.5.0)

````markdown
```flowtime-weekplan
```
````

Renders Monday–Friday with all your week's tasks. Two view modes toggled via the toolbar:

**List view** — day-by-day sections with inline editing:

- Per-day budget bars showing scheduled hours vs daily cap
- Inline time/duration inputs with auto-save
- Checkbox, timer, delete per task
- Routines marked with 🔁 badge

**Grid view** — horizontal timeline grid:

| | Mon 24 | Tue 25 | Wed 26 | Thu 27 | Fri 28 |
|---|--------|--------|--------|--------|--------|
| 09:00 | Deep Work | Meeting | Writing | Deep Work | Standup |
| 10:00 | (spans) | | | | |

- Tasks positioned by their time range (30min slot rows)
- Today column and current time slot highlighted
- Click any task card → edit popup with time, duration, checkbox, delete
- Untimed tasks listed at bottom of each day column

### Inbox Capture & Processing

A GTD-inspired inbox for dumping raw tasks without syntax pressure.

**`Inbox.md`** is auto-created at vault root. Open it and type anything — one line per thought. No syntax required. Tags are optional but pre-filled during processing (`@today`, `@b:deep-work`, `@p:Website`).

**Capture methods:**

- Open `Inbox.md` directly and type
- `⌘+P` → **Append to Inbox** — quick textarea prompt
- Set Quick Entry target to "Inbox" in settings → `⌘+Shift+I` writes to inbox
- Type `@inbox` anywhere on a line — preceding text captured to Inbox.md, line cleared
- Type `@p:ProjectName` at end of line — preceding text captured to that project's Tasks.md

**Processing** (`⌘+P` → **Process Inbox**):
Opens a modal that walks through inbox lines one at a time. Each line gets one action:

| Action | Result |
|--------|--------|
| **✅ Task** | Becomes a proper Flowtime task line with date/duration/bucket/project/priority/recurrence — appended to daily note, active file, or project file |
| **📁 Project** | Scaffolds a new project folder + folder note + Tasks.md + Wiki.md. The line becomes the first task |
| **📖 Wiki** | Appends to a project's Wiki.md under an "📥 From Inbox" section |
| **🗑 Discard** | Removed from inbox |
| **⏰ Snooze** | Stays in inbox with `@snooze` date — hidden from processing until that date passes |

Tags already in the line pre-fill the form: `@today` → date, `@30m` → duration, `@b:deep-work` → bucket, `@p:Website` → project, `🟥` → priority, `🔁 every week` → recurrence.

Processed lines are removed from the inbox. Snoozed lines persist with their `@snooze` tag.

### Templates

Three commands available from the command palette:

- **Insert daily dashboard** — inserts `flowtime-today` and `flowtime-overdue` blocks
- **Insert weekly dashboard** — inserts `flowtime-weekly`, `flowtime-dueweek` blocks
- **New Project** — creates a folder with a project note with frontmatter marker

### Cross-Table Refresh

When a task's date or time changes in one table, **all other tables on the same page** refresh automatically — no manual reload needed.

### Content Width

A **Content width** slider in Settings → Display controls the reading view's max-width:

- **0** — use Obsidian's default width (~700px)
- **20–1920px** — widen the content area so tables get more horizontal space
- Applies live — no reload needed
- Affects the entire reading view (both live preview and reading mode)

---

## Task Format Reference

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
| `🔁 every <interval>` | Recurrence | `🔁 every workday`, `🔁 every Mon Wed Fri`, `🔁 every 2nd Sun` |

A complete task example:

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🔼 @1.5h @b:deep-work
```

---

## Setup

### Creating a Project

1. Run the **New Project** command from the command palette
2. Enter a project name
3. A folder is created with a project note containing the frontmatter marker
4. Tasks in that folder or tagged with `@p:<name>` appear under the project

### Creating a Daily Dashboard

Add to your daily note template:

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

### Weekly Dashboard

````markdown
## 📊 This Week
```flowtime-weekly
```

## ⚠️ Due Next Week
```flowtime-dueweek
```
````

### Budget Overview

````markdown
## 📊 Weekly Budget
```flowtime-buckets
```
````

---

## Settings Reference

All settings in **Settings → Flowtime**.

| Setting | Default | Description |
|---------|---------|-------------|
| **Project Detection** | | |
| Frontmatter key | `type` | Frontmatter field marking a note as a project root |
| Frontmatter value | `project` | Value of that field |
| Project name key | `name` | Frontmatter field used as display name |
| Fallback to folder name | on | Use folder name when no frontmatter marker is found |
| Tag prefix | `project/` | Prefix for @p: project tags (legacy #project/ prefix is deprecated) |
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
| **Routines (v0.5.0)** | | |
| Routines folder | `flowtime/routines/` | Folder for routine template `.md` files |
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

---

## Requirements

- Obsidian v1.8.7+

---

## Development

```bash
# Build
npm run build

# Deploy to vault
cp dist/main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/flowtime/

# Create a release build
npm run release
cp -r release/flowtime /path/to/vault/.obsidian/plugins/

# Reload Obsidian to apply changes
```
