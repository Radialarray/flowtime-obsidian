# Flowtime Skill

Use this skill when working in a vault that uses the Flowtime plugin for task and project management.

## What Flowtime Handles

1. **Project Wiki** — reference notes, designs, specs, meeting notes. Lives in project folders.
2. **Actionable Tasks** — timeboxed to-do items with dates, buckets, and projects. Rendered in code block tables.

## Decision Gate

When adding information to a vault using Flowtime, always classify:

| If the information is... | Put it in... | Format |
|--------------------------|-------------|--------|
| Reference / knowledge / spec / decision | **Project Wiki** | Regular markdown in the project folder |
| Something to DO with a deadline | **Task** | `- [ ] description @date @bucket:name` |

**Examples:**
- "The API uses OAuth2 with refresh tokens" → Project Wiki
- "Update the login page to use new API" → Task (`- [ ] Update login page @today @1h @bucket:deep-work`)
- "Meeting notes from design review" → Project Wiki
- "Implement dark mode toggle" → Task (`- [ ] Add dark mode toggle @today @2h @bucket:deep-work`)

## Task Syntax (v0.3.0)

```
- [ ] Write API spec @today @1.5h @bucket:deep-work @p:backend @due:tomorrow @every-week
```

| Element | Example | Meaning |
|---------|---------|---------|
| Checkbox | `- [ ]` / `- [x]` | Open / completed |
| Date | `@today`, `@next-monday`, `@2026-06-24` | Scheduled date |
| Duration | `@1.5h`, `@30m` | Time estimate (auto-converted) |
| Bucket | `@bucket:deep-work`, `@b:deep-work` | Time budget category |
| Project | `@project:backend`, `@p:backend` | Project association |
| Due date | `@due:tomorrow`, `@due:2026-06-28` | Due date |
| Recurrence | `@every-week`, `@every-2-weeks` | Auto-regenerates on completion |
| Time block | `09:00—11:30` | Optional timebox (legacy format) |

**Add a task:** `Cmd+Shift+I` (or type `/add-task` in editor) → opens modal with date parsing, bucket/project picker.

## Project Structure

A project is a **folder** with a **folder note** (same name as folder) containing frontmatter:

```markdown
---
type: project
name: Website Redesign
status: active
tags: [project]
---
```

**Create a new project:** `Cmd+P` → "Flowtime: New Project"

## Buckets (Time Budgets)

Buckets are time-constrained categories configured in Settings → Buckets.
Defaults: Deep Work (20h/week), Admin (5h/week), Meetings (5h/week).
Tasks must belong to a bucket via `@bucket:<name>`.

## Code Blocks

| Code block | Shows |
|------------|-------|
| ` ```flowtime-today ``` ` | Tasks with @today |
| ` ```flowtime-overdue ``` ` | Tasks past their date |
| ` ```flowtime-dueweek ``` ` | Tasks due this week |
| ` ```flowtime-weekly ``` ` | All tasks this week, grouped by project |
| ` ```flowtime-project ``` ` | Tasks for the current note's project |
| ` ```flowtime-buckets ``` ` | Budget overview with progress bars |
| ` ```flowtime-sessions ``` ` | Timer session history + analytics |

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Add Task | Cmd+Shift+I | Modal with date + bucket + project picker |
| Add Task at Cursor | — | Insert task template at cursor |
| Insert daily dashboard | — | Inserts today/overdue/due-week blocks |
| Insert weekly dashboard | — | Inserts weekly review blocks |
| New Project | — | Creates project folder + folder note |
| Onboard / Migrate | — | Converts old dates + code blocks |

## Views Features

Each table view has a toolbar with:
- **☰ Columns** — toggle column visibility (check, task, project, bucket, source, date, timer)
- **🔍 Filter** — filter by any field (bucket, project, date, text, duration) with AND/OR/NOT logic
- **Group By** — two-level grouping (bucket, project, date, status)
- **Column sort** — click headers to sort, shift-click for secondary sort
- **💾 Save View** — persist current filter/sort/group/columns as a named view
- **📂 Load View** — restore any saved view

## Status Bar Timer

When a task timer is running: `⏱ MM:SS — Task name`. Click to pause/resume, right-click to stop. Timer progress bar fills as time elapses.
