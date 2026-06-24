# Flowtime — Obsidian Plugin

Daily task planning, timeboxing, and project-aware task management with inline timers.

## Installation

1. Copy the `flowtime/` folder to your vault's `.obsidian/plugins/` directory
2. In Obsidian: **Settings → Community plugins → Reload plugins**
3. Enable **Flowtime** in the plugins list

## Quick Start

Create a note with these code blocks:

```
## 🎯 Today
\`\`\`flowtime-today
\`\`\`

## 🔄 Overdue
\`\`\`flowtime-overdue
\`\`\`

## 📊 This Week
\`\`\`flowtime-weekly
\`\`\`

## 📊 Budget Overview
\`\`\`flowtime-buckets
\`\`\`

## 📋 Sessions
\`\`\`flowtime-sessions
\`\`\`
```

## Task Syntax

```
- [ ] Write API spec @today @1.5h @bucket:deep-work @p:backend @due:tomorrow @every-week
```

| Element | Example | Description |
|---------|---------|-------------|
| Date | `@today`, `@next-monday`, `@2026-06-24` | Scheduled date |
| Duration | `@1.5h`, `@30m` | Time estimate |
| Bucket | `@bucket:deep-work`, `@b:deep-work` | Time budget category |
| Project | `@project:backend`, `@p:backend` | Project association |
| Due date | `@due:tomorrow`, `@due:2026-06-28` | Due date |
| Recurrence | `@every-week`, `@every-2-weeks` | Auto-regenerating task |

## Features

- **5 table views**: today, overdue, due-week, weekly (by project), project-scoped
- **Buckets**: time-budget categories with weekly limits and daily caps
- **Progress bars**: color-coded (normal/warning/over) for budgets and timers
- **Timer**: per-row countdown + status bar sync, pause/resume
- **Quick entry**: Cmd+Shift+I opens modal with date parsing, project/bucket picker
- **Session tracking**: timer sessions and completions persisted to vault, queryable
- **Views**: sort by columns, filter tasks, group by bucket/project, persist named views
- **Templates**: daily/weekly dashboard templates, new project command
- **Recurrence**: auto-generates next task instance on completion

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Add Task | Cmd+Shift+I | Open quick entry modal |
| Add Task at Cursor | — | Insert task template at cursor |
| Insert daily dashboard | — | Insert daily code blocks |
| Insert weekly dashboard | — | Insert weekly code blocks |
| New Project | — | Create project folder + note |
| Onboard / Migrate | — | Run migration wizard |

## Development

```bash
npm run dev     # Watch mode rebuild
npm run build   # Production build
bash release.sh # Assemble release package
bash test.sh    # Integration tests (Obsidian must be running)
node test/unit/filter-engine.test.js  # Unit tests
node test/unit/task-parser.test.js
node test/unit/budget-state.test.js
```
