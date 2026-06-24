# Flowtime v0.4.0

An Obsidian plugin that turns task management into **interactive tables** with code blocks, inline countdown timers, time budgets, session tracking, and a status bar timer. Zero external dependencies.

---

## Features

### Code Block Views

Six code block types give you different perspectives on your tasks:

| Block | Mode | Scope |
|-------|------|-------|
| ` ```flowtime-today` | today | Tasks scheduled for today |
| ` ```flowtime-overdue` | overdue | Tasks with dates before today |
| ` ```flowtime-dueweek` | dueweek | Tasks due tomorrow through Sunday |
| ` ```flowtime-weekly` | weekly | This week's tasks grouped by project |
| ` ```flowtime-project` | project | Tasks for the project containing this code block |
| ` ```flowtime-buckets` | budget | Weekly time-budget overview per bucket |
| ` ```flowtime-sessions` | sessions | Time-tracking session history and analytics |

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
- **Inline tags** — `#project/ProjectName` with configurable prefix
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

### Recurrence

Mark recurring tasks with `🔁`:

- `🔁 every day` / `🔁 every week` / `🔁 every month`
- When marked complete, auto-reschedules to the next occurrence
- Recurrence directive is cleaned from displayed task text

### Inbox Capture & Processing

A GTD-inspired inbox for dumping raw tasks without syntax pressure.

**`Inbox.md`** is auto-created at vault root. Open it and type anything — one line per thought. No syntax required. Tags are optional but pre-filled during processing (`@today`, `@b:deep-work`, `@p:Website`).

**Capture methods:**

- Open `Inbox.md` directly and type
- `⌘+P` → **Append to Inbox** — quick textarea prompt
- Set Quick Entry target to "Inbox" in settings → `⌘+Shift+I` writes to inbox
- Type `@inbox` on a blank line → expands to `- [ ]`

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
| `#tag` | Project tag (with prefix) | `#project/website` |
| `🔁 every <period>` | Recurrence | `🔁 every week` |

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
4. Tasks in that folder or tagged with `#project/<name>` appear under the project

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
| Tag prefix | `project/` | Prefix for inline project tags (`#project/Name`) |
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
