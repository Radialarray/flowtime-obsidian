# Flowtime

Obsidian plugin that turns task management into **interactive tables** with code blocks, natural language dates, inline countdown timers, and a status bar timer. Zero external dependencies.

---

## Features

### Code Blocks

Six code blocks give you different views of your task database:

| Block | ID | Scope |
|-------|-----|-------|
| ```` ```flowtime-today ```` | today | Tasks scheduled for today (`⏳ today`) |
| ```` ```flowtime-overdue ```` | overdue | Tasks with `⏳` before today |
| ```` ```flowtime-dueweek ```` | dueweek | Tasks due this week (tomorrow through Sunday) |
| ```` ```flowtime-weekly ```` | weekly | Grouped by project, all tasks for the week |
| ```` ```flowtime-project ```` | project | Tasks belonging to a specific project folder |

### Quick Entry (Cmd+Shift+T)

Press **Cmd+Shift+T** (Mac) or **Ctrl+Shift+T** (Windows/Linux) to open the Quick Entry modal. Also available from the command palette as "Add Task".

- Enter task text with natural language dates:
  - `@today` — schedule for today
  - `@tomorrow` — schedule for tomorrow
  - `@next-monday` — schedule for next Monday
  - `@monday` through `@sunday` — next occurrence of that day
  - `@next-week` — one week from today
  - `@next-month` — one month from today
  - `@weekend` — next Saturday
- Set a duration (10m, 15m, 30m, 1h, etc.)
- Pick a project from the dropdown
- Live preview shows the rendered task line before saving

### Timeboxing with Per-Row Timers

Each task row in the table has inline timer controls:

- **▶ Play** — start a countdown timer for that task's duration
- **⏸ Pause** — pause the timer
- **↺ Reset** — reset the timer to its original duration
- Timer turns **red and blinks** when time is up
- Notification fires on expiry

### Status Bar Timer

A persistent timer lives in the Obsidian status bar:

- **Click** — pause/resume the currently running timer
- **Right-click** — stop the timer entirely
- Shows task name (truncated at 30 chars) and remaining time
- Displays `⏱ --` when no timer is active

### Project Detection

Flowtime automatically detects project folders using:

- Folder notes (a note in a folder with the same name as the folder)
- Frontmatter markers (`flowtime-project: true` or `category: project`)
- Notes in any folder are listed as "Uncategorized" by default

### Checkbox Toggle

Click the checkbox in the table to complete a task. The task is marked `[x]` in its source file and hidden from the table on the next refresh.

### Recurrence

Mark recurring tasks with:
- `🔁 every day`
- `🔁 every week`
- `🔁 every month`

When a recurring task is completed, it automatically reschedules to the next occurrence.

### Templates

Three commands available from the command palette:

- **Insert daily dashboard** — inserts ```` ```flowtime-today ``` ```` and ```` ```flowtime-overdue ``` ```` blocks
- **Insert weekly dashboard** — inserts ```` ```flowtime-weekly ``` ```` block
- **New Project** — creates a folder with a project note (frontmatter marker included)

### Configurable Settings

14 settings accessed from Settings → Flowtime:

| Setting | Default | Description |
|---------|---------|-------------|
| Status bar timer | on | Show/hide the status bar timer |
| Tasks path | / | Root folder for task search |
| Notice duration | 4000ms | Duration of popup notifications |
| Quiet mode | off | Suppress non-error notifications |
| Default duration | 30m | Default timebox for new tasks |
| Day start | 07:00 | Start of workday for dropdown |
| Day end | 20:00 | End of workday for dropdown |
| Default project | (none) | Project auto-selected in Quick Entry |
| Weekly view range | 7d | Number of days to show in weekly view |
| Project order | alphabetically | Sort order for project list |
| Show empty projects | off | Show/hide projects with no tasks |
| Auto-save interval | 0 (off) | Auto-save all open tables every N minutes |
| Done task filter | hide | Show/hide completed tasks |
| Font size | (theme default) | Override table font size |

### Cross-Table Refresh

When a task's date is changed in any table, all other tables on the same page refresh automatically.

---

## Task Format Reference

Flowtime reads the standard Tasks plugin emoji format from any note in your vault:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `⏳ <date>` | Scheduled date | `⏳ 2026-06-24` |
| `📅 <date>` | Due date | `📅 2026-06-28` |
| `🔼` `🔺` `🔽` | Priority | |
| `#backlog` | Backlog tag | |
| `HH:mm—HH:mm` | Time block | `09:00—11:30` |
| `🔁 every <period>` | Recurrence | `🔁 every week` |

A complete task example:

```markdown
- [ ] 09:00—11:30 Code review ⏳ 2026-06-24 🔼 📅 2026-06-28
```

Day Planner reads tasks with time blocks from any file.

---

## Setup

### Creating a Project

1. Run the **New Project** command from the command palette
2. Enter a project name
3. A folder is created with a project note that contains `flowtime-project: true` in its frontmatter
4. Tasks tagged with `#<project-name>` or placed in that folder will appear under the project

### Creating a Daily Note

Add these code blocks to your daily note template:

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

Add to your weekly note template:

````markdown
```flowtime-weekly
```
````

---

## Requirements

- Obsidian v1.8.7+

---

## Settings Reference

All settings are in **Settings → Flowtime**.

| Setting | Key | Default | Details |
|---------|-----|---------|---------|
| Status bar timer | `statusBarTimer` | `true` | When off, the status bar timer is hidden entirely |
| Tasks path | `tasksPath` | `/` | Only tasks below this path are shown. Use a subfolder to scope. |
| Notice duration | `noticeDuration` | `4000` | In milliseconds |
| Quiet mode | `quietMode` | `false` | Suppresses "Saved!"-style notices |
| Default duration | `defaultDuration` | `30` | In minutes. Used when no duration is specified. |
| Day start | `dayStart` | `07:00` | Start time for the dropdown picker |
| Day end | `dayEnd` | `20:00` | End time for the dropdown picker |
| Default project | `defaultProject` | `""` | Pre-selected project in Quick Entry. Empty = none. |
| Weekly view range | `weeklyRange` | `7` | Number of days to include in the weekly view |
| Project order | `projectOrder` | `"alpha"` | Options: `alpha`, `recent` |
| Show empty projects | `showEmptyProjects` | `false` | When off, projects with zero tasks are hidden |
| Auto-save interval | `autoSaveInterval` | `0` | In minutes. 0 = off. Auto-saves all modified tables. |
| Done task filter | `doneTaskFilter` | `"hide"` | Options: `hide`, `dim`, `show` |
| Font size | `fontSize` | `""` | Empty = use theme default. Set to e.g. `14px` to override. |

---

## Development

```bash
git clone ~/dev/flowtime
# Edit main.js / styles.css
cp main.js styles.css /path/to/vault/.obsidian/plugins/flowtime/
# Reload Obsidian
```
