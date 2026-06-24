# Flowtime

Obsidian plugin that turns your task management into **interactive tables** with time blocks, countdown timers, and date reassignment. Works with the Tasks plugin and Day Planner.

---

## Features

### 🎯 Today Table (` ```task-planner ``` `)
Shows all tasks with `⏳ today`. Set time blocks and run countdown timers:

- **Start time** — type any time or pick from dropdown (`07:00`–`20:00`)
- **Duration** — pick ADHD-friendly blocks (10m, 15m, 30m, 1h, 1.5h… 4h)
- **Live preview** — shows calculated end time as you adjust
- **Countdown timer** — per-task inline timer with ▶/⏸/↺ controls. Beeps + notification when time's up
- **Date badge** — click to open popup: reassign to Today/Tomorrow/Next Week or send to Backlog
- **Save All** — batch-writes time blocks to source files in `HH:mm—HH:mm` format (Day Planner reads this)

### 🔄 Carry Over Table (` ```task-planner-overdue ``` `)
Shows tasks with `⏳` before today:

- **Per-row buttons**: [📅 Today] moves task to today, [🗑 Backlog] removes its date
- **Bulk actions**: "Assign All to Today" or "Backlog All"
- **Date popup**: same as Today table for custom dates

### ⚠️ Due This Week Table (` ```task-planner-dueweek ``` `)
Shows tasks with `📅` or `⏳` this week (tomorrow through Sunday):

- **Per-row buttons**: [📅 Today] schedules for now, [📅 On Due] picks the due date
- **Bulk actions**: "Assign All to Today"
- Shows `📅` date if available, falls back to `⏳` date

### Live Cross-Table Sync
Change a task's date in any table → all other tables on the page refresh automatically. Assign to Today in Due Week → it appears in the Today table instantly.

---

## Usage

Add these code blocks to your daily note:

````markdown
## 🔄 Carry Over
```task-planner-overdue
```

## 🎯 Today
```task-planner
```

## ⚠️ Due This Week
```task-planner-dueweek
```
````

---

## Task Syntax

Use the Tasks plugin emoji format. The table reads these from any note in your vault:

| Emoji | Meaning | Example |
|-------|---------|---------|
| `⏳` | Scheduled date | `⏳ 2026-06-24` |
| `📅` | Due date | `📅 2026-06-28` |
| `🔼` `🔺` `🔽` | Priorities | |
| `#backlog` | Backlog tag | |

A task with both time and date:

```markdown
- [ ] 09:00—11:30 Code review ⏳ 2026-06-24 🔼
```

Day Planner automatically reads tasks with time blocks from any file.

---

## Requirements

- Obsidian v1.8.7+
- [Tasks Plugin](https://publish.obsidian.md/tasks/) (recommended)
- [Day Planner Plugin](https://github.com/ivan-lednev/obsidian-day-planner) (for timeline view)

---

## Development

```bash
git clone ~/dev/flowtime
# Edit main.js / styles.css
cp main.js styles.css /path/to/vault/.obsidian/plugins/flowtime/
# Reload Obsidian
```
