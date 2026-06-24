# Flowtime Skill

Use this skill when working in a vault that uses the Flowtime plugin for task and project management.

## What Flowtime Handles

Flowtime manages two kinds of information in your vault:

1. **Project Wiki** — reference notes, designs, specs, meeting notes. Lives in project folders.
2. **Actionable Tasks** — timeboxed to-do items with dates and project tags. Rendered in code block tables.

## Decision Gate

When adding information to a vault using Flowtime, always classify:

| If the information is... | Put it in... | Format |
|--------------------------|-------------|--------|
| Reference / knowledge / spec / decision | **Project Wiki** | Regular markdown in the project folder |
| Something to DO with a deadline | **Task** | `- [ ] description @date #project/name` |

**Examples:**
- "The API uses OAuth2 with refresh tokens" → Project Wiki (add to project note)
- "Update the login page to use new API" → Task (`- [ ] Update login page @2026-06-28 #project/website`)
- "Meeting notes from design review" → Project Wiki (create or append to meeting note)
- "Implement dark mode toggle" → Task (`- [ ] Add dark mode toggle @2026-06-27 #project/website`)

## Task Format

```
- [ ] task description @2026-06-24 #project/name 🔺 🔁 every week
```

| Element | Syntax | Meaning |
|---------|--------|---------|
| Checkbox | `- [ ]` / `- [x]` | Open / completed |
| Date | `@YYYY-MM-DD` or `@today` | Due / scheduled date |
| Project | `#project/name` | Links task to project |
| Priority | `🔺⏫🔼🔽⏬` | Highest to lowest |
| Recurrence | `🔁 every N day/week/month` | Auto-regenerates on completion |
| Time block | `09:00—11:30` | Optional timebox |

**Add a task inline:** type `- [ ] task name @today #project/name` directly in any note.

**Add a task via modal:** Cmd+Shift+I (or Cmd+P → "Flowtime: Add Task")

## Project Structure

A project is a **folder** with a **folder note** (file named same as the folder) containing frontmatter:

```markdown
---
type: project
name: Website Redesign
status: active
tags: [project]
---
```

The folder note marks the project boundary. Tasks in that folder (or subfolders) automatically belong to that project.

**Create a new project:** Cmd+P → "Flowtime: New Project"

## Code Blocks

Drop these into any note to see task tables:

| Code block | Shows |
|------------|-------|
| ` ```flowtime-today ``` ` | Tasks with @today |
| ` ```flowtime-overdue ``` ` | Tasks past their date |
| ` ```flowtime-dueweek ``` ` | Tasks due this week |
| ` ```flowtime-weekly ``` ` | All tasks this week, grouped by project |
| ` ```flowtime-project ``` ` | Tasks for the current note's project |

## Commands

| Command | Shortcut | What it does |
|---------|----------|-------------|
| Add Task | Cmd+Shift+I | Modal with date + project picker |
| Add Task at Cursor | (assign in Hotkeys) | Inserts task syntax at cursor |
| Insert daily dashboard | — | Inserts today/overdue/due-week blocks |
| Insert weekly dashboard | — | Inserts weekly review blocks |
| New Project | — | Creates project folder + folder note |
| Onboard / Migrate | — | Converts old dates + code blocks |

## Quick Capture Patterns

**From anywhere in the vault:**
- Cmd+Shift+I → add task to daily note
- Type `- [ ] task @today #project/name` inline

**In a daily note:**
- `flowtime-today` block shows timeboxed today tasks
- Start timers with ▶, save time blocks with 💾 Save All
- Check off tasks → fade with strikethrough, stay visible

**In a project note:**
- `flowtime-project` block shows all tasks for that project
- Add tasks inline or via modal

## Status Bar Timer

When a task timer is running, the Obsidian status bar shows `⏱ MM:SS — Task name`. Click to pause/resume, right-click to stop.
