# Flowtime Plugin — Architecture & Implementation Plan

> A single Obsidian plugin for daily task planning, timeboxing, project-aware task management, and quick capture. **Zero external plugin dependencies** — replaces Tasks Plugin, Day Planner, nldates, and QuickAdd.

---

## 1. Design Decisions

### 1.1 Task Format

```
- [ ] task description #project/tag @today ⏳ 2026-06-24 📅 2026-06-28 🔺 🔁 every day
```

| Element | Syntax | Purpose |
|---------|--------|---------|
| Checkbox | `- [ ]` / `- [x]` | Standard task, togglable from table |
| Project | `#project/tag` | Obsidian-native tag, autocompleted, scannable |
| Natural date | `@today`, `@next-monday` | Human input, parsed to real date |
| Scheduled | `⏳ YYYY-MM-DD` | Machine-readable scheduled date |
| Due | `📅 YYYY-MM-DD` | Machine-readable due date |
| Time block | `09:00—11:30` | Timebox slot, parsed natively (no Day Planner dep) |
| Priority | `🔺⏫🔼🔽⏬` | Parsed + displayed in table |
| Recurrence | `🔁 every day` | Parsed, recurred tasks auto-regenerated |

**Date parsing**: `@` prefix triggers natural language parser → resolves to `YYYY-MM-DD`. Examples: `@today`, `@tomorrow`, `@next-monday`, `@in-3-days`, `@fri`, `@2026-12-01`. Integrated directly.

**Project format**: `#project/subproject` — uses Obsidian tags with autocomplete. Configurable tag prefix (default: `project/`). Plugin strips the prefix when displaying project name.

**Dependency-free approach**: The plugin handles everything natively — task parsing, timeboxing, date management, recurrence, priority display, quick capture, templates. Users uninstall Tasks Plugin, Day Planner, nldates, QuickAdd. **Zero external plugin dependencies.**

### 1.7 Notifications

Configurable via Obsidian Notice API, controlled in settings:

| Event | Default | Notification |
|-------|---------|-------------|
| Timer expired | On | `Notice` + optional sound (AudioContext beep) |
| Task completed | On | Brief `Notice` |
| Bulk action done | On | `Notice` with count (e.g. "✅ 5 saved") |
| Error / failure | On | Error `Notice` |

Settings controls:
- **Sound on timer expiry** — toggle (default: on)
- **Notice duration** — ms (default: 4000, 0 = persistent until dismissed)
- **Quiet mode** — suppress all non-error notices (default: off)

### 1.2 Project Detection

**Mode: Frontmatter marker + folder fallback.**

Traverse directory tree upward from task file until a folder note with `type: project` in frontmatter is found. Project name comes from `name` or `title` frontmatter field, falls back to folder name.

Configurable options in settings:
- Frontmatter key: `type` (default), can also set: `is_project`, `project`
- Frontmatter value: `project` (default), can also set: `true`
- Name frontmatter key: `name` (default), also tries `title`, `alias`
- Fallback: use folder name

Example folder note (`Projects/Website Redesign/Website Redesign.md`):
```markdown
---
type: project
name: Website v2
status: active
---
```

Task file at `Projects/Website Redesign/tasks/design.md` → detected project: "Website v2".

Task file at `Inbox/random.md` (no project marker found) → project: `Inbox` (folder fallback) or "Unassigned".

### 1.3 Quick Entry

**Phase 1**: Command palette "Flowtime: Add Task" → modal  
**Phase 2**: Hotkey `Cmd+Shift+T` → same modal  
**Phase 3**: Slash command `/add-task` in editor → inline popup  

Modal fields:
- **Task text** (required, text input)
- **Date** (natural language input, default: `@today`)
- **Project** (suggester dropdown: auto-detected from active file, recent projects, or type to search)
- **Duration** (optional dropdown: 10m/15m/30m/1h/etc)
- **Target file** (default: daily note, or active file, or project note — configurable)

Output: Inserts task line into target file. If date field contains `@today`, resolves and writes `⏳ 2026-06-24`. If project selected, appends `#project/name`.

### 1.4 Status Bar Timer

Shows currently running task name + countdown in Obsidian status bar. Click to pause/resume. Right-click to stop. Only one timer runs at a time. Starting a new timer stops the previous one.

Format: `⏱ 23:45 — Review designs  [⏸]`

### 1.5 Plugin Name

Rename from `flowtime` to `flowtime`. Reflects broader scope.

### 1.6 Native Task Management (replaces Tasks Plugin)

All task lifecycle operations handled directly:

| Capability | How |
|------------|-----|
| Create task | Quick entry modal |
| Toggle complete | Click checkbox in table → marks `[x]` in source file |
| Filter by date | Code blocks: today / overdue / due-week / weekly / project |
| Recurrence | Parse `🔁 every [N] [day/week/month]`, auto-generate next instance on completion |
| Priority | Parse `🔺⏫🔼🔽⏬`, display in table, sort by priority |
| Bulk actions | Assign all to today, backlog all, complete all |
| Vault-wide search | Scan all `.md` files for tasks (already implemented, extended) |

No Tasks Plugin query language — preset views via code blocks cover all needed use cases.

---

## 2. Architecture

### 2.1 Module Structure

```
main.js              — Plugin entry, registration, settings tab
src/
  project-engine.js  — Folder traversal, frontmatter parsing, project resolution
  task-parser.js     — Parse task lines, extract emoji/dates/tags/time/project
  date-parser.js     — Natural language → YYYY-MM-DD (@today, @next-monday, etc.)
  quick-entry.js     — Modal for task capture, suggester, auto-detect project
  status-timer.js    — Status bar timer, single-instance, pause/resume
  renderer.js        — Table rendering (code blocks), row building, popups
  template-engine.js — Load, render, insert templates; "New Project" command
  settings.js        — Settings defaults + tab
styles.css           — All styles
manifest.json        — Plugin metadata
```

### 2.2 Data Flow

```
Vault markdown files
    │
    ▼
task-parser.js ─────► extracts tasks with dates, projects, times
    │
    ▼
project-engine.js ───► resolves project per task (cached)
    │
    ▼
renderer.js ─────────► builds table rows with project column
    │
    ▼
status-timer.js ─────► per-row timer → status bar sync
```

### 2.3 Project Cache

Project resolution (folder traversal + frontmatter read) is expensive. Cache results keyed by file path. Invalidate on file save/modify for files in affected directory trees.

---

## 3. Settings Tab

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `projectFrontmatterKey` | string | `type` | Frontmatter key that marks a project folder |
| `projectFrontmatterValue` | string | `project` | Value that triggers project detection |
| `projectNameKey` | string | `name` | Frontmatter key for project display name |
| `fallbackToFolderName` | boolean | `true` | Use folder name as project if no marker found |
| `tagPrefix` | string | `project/` | Prefix for project tags (stripped in display) |
| `quickEntryTargetFile` | dropdown | `daily-note` | Where new tasks land: daily note, active file, or project file |
| `dateFormat` | string | `YYYY-MM-DD` | Display format for dates |
| `statusBarTimer` | boolean | `true` | Show running timer in status bar |
| `projectsRoot` | string | `""` | Root folder for projects (empty = vault root) |
| `dailyTemplate` | text | (see 5.2) | Template for daily note dashboard |
| `weeklyTemplate` | text | (see 5.3) | Template for weekly note dashboard |
| `projectTemplate` | text | (see 5.1) | Template for new project folder notes |
| `timerSound` | boolean | `true` | Play beep sound when timer expires |
| `noticeDuration` | number | `4000` | Notice display duration in ms (0 = persistent) |
| `quietMode` | boolean | `false` | Suppress all non-error notices |

---

## 4. Code Block Types

| Code block | Mode | Shows |
|------------|------|-------|
| `task-planner` | today | Tasks with ⏳ today |
| `task-planner-overdue` | overdue | Tasks with ⏳ before today |
| `task-planner-dueweek` | dueweek | Tasks with 📅 or ⏳ this week |
| `task-planner-weekly` | weekly | All tasks this week, grouped by project |
| `task-planner-project` | project | All tasks for the project of the current note |

**New columns added to all tables:**
- **Project** — resolved project name, linked to project folder note
- **Priority** — emoji displayed, sortable
- **Checkbox** — click to toggle complete (marks `[x]` in source)

---

## 5. Templates

Templates are the glue between project detection, daily workflow, and quick entry. Shipped as defaults, overridable in settings.

### 5.1 Project Folder Note Template

The marker that `project-engine.js` detects. User creates new project via command "Flowtime: New Project".

```markdown
---
type: project
name: {{NAME}}
status: active
tags: [project]
---

# {{NAME}}

## 🎯 Goal

## 📋 Tasks
```

Placement: `{{PROJECTS_ROOT}}/{{NAME}}/{{NAME}}.md`

### 5.2 Daily Note Template

Inserted via "Flowtime: Insert daily dashboard" command. Embeds all table code blocks.

```markdown
## 🔄 Carry Over
\`\`\`task-planner-overdue
\`\`\`

## 🎯 Today
\`\`\`task-planner
\`\`\`

## ⚠️ Due This Week
\`\`\`task-planner-dueweek
\`\`\`

## 📝 Notes
```

### 5.3 Weekly Note Template

Inserted via "Flowtime: Insert weekly dashboard" command.

```markdown
## 📊 This Week (by project)
\`\`\`task-planner-weekly
\`\`\`

## ⚠️ Due Next Week
\`\`\`task-planner-dueweek
\`\`\`

## 📝 Review
```

### 5.4 Template Delivery

Option C (chosen): **Ship defaults, overridable in settings.**

- Three template fields in settings tab: daily, weekly, project
- Commands insert template content at cursor or into new file
- Variables available: `{{DATE}}`, `{{WEEK_START}}`, `{{WEEK_END}}`, `{{NAME}}` (for project)
- `{{PROJECTS_ROOT}}` configurable in settings (default: root of vault or `Projects/`)

No dependency on Templater or QuickAdd for template insertion — handled natively.

---

## 6. End-to-End Daily Workflow

```
Morning:
  1. Open daily note → dashboard auto-loads
  2. See: project column, time blocks, timers
  3. Cmd+Shift+T → quick-add tasks (auto-project, auto-date)
  4. Set start times + durations
  5. Start timer on first task → status bar shows countdown

During day:
  1. Status bar timer runs, click to pause
  2. Complete/carry-over tasks via date popup
  3. Add ad-hoc tasks via quick entry

Weekly review:
  1. Open weekly note → tasks grouped by project
  2. Bulk actions: assign all to today, backlog all
  3. Plan next week's tasks
```

---

## 7. Implementation Order

### Sprint 1: Foundation
- [ ] Rename plugin to `flowtime`
- [ ] Split into modules (`src/`)
- [ ] Add settings tab with all config options
- [ ] Update manifest.json

### Sprint 2: Project Engine
- [ ] Implement folder traversal + frontmatter parsing
- [ ] Project cache with invalidation
- [ ] Add project column to all table renderers
- [ ] Resolve `#project/tag` from task lines

### Sprint 3: Quick Entry
- [ ] Natural language date parser (`@today`, `@next-monday`, etc.)
- [ ] Modal UI (task text, date, project suggester, duration)
- [ ] Command palette registration
- [ ] Auto-detect project from active file
- [ ] Insert formatted task into target file

### Sprint 4: Status Bar Timer
- [ ] StatusBarItem integration
- [ ] Sync with running per-row timer
- [ ] Click to pause/resume, right-click to stop
- [ ] Show task name in status bar

### Sprint 5: Dashboards & Templates
- [ ] `task-planner-weekly` code block (this week, grouped by project)
- [ ] `task-planner-project` code block (project-scoped tasks)
- [ ] Template engine: load/save/insert templates
- [ ] "Insert daily dashboard" command
- [ ] "Insert weekly dashboard" command
- [ ] "New Project" command (creates folder note from template)
- [ ] Checkbox toggle in table (complete task from table)
- [ ] Recurrence parsing + auto-regeneration (`🔁 every day/week/month`)

### Sprint 6: Polish
- [ ] Hotkey Cmd+Shift+T for quick entry
- [ ] Slash command `/add-task`
- [ ] Performance: incremental task parsing
- [ ] Theme compatibility fixes

---

## 8. Migration Path

Users currently rely on:
- Tasks Plugin emoji format (⏳ 📅 🔁 🔺) → **kept, parsed natively**
- Day Planner time format (HH:mm—HH:mm) → **kept, parsed natively**
- Existing code blocks (`task-planner`, etc.) → **kept, extended with new types**

**Goal**: Users can uninstall Tasks Plugin, Day Planner, nldates, QuickAdd. Flowtime handles all task management.

---

## 9. File Manifest

| File | New/Modify | Purpose |
|------|------------|---------|
| `main.js` | Refactor | Entry, registration, settings tab |
| `styles.css` | Extend | New components (modal, suggester, status bar) |
| `manifest.json` | Update | New name, version bump |
| `src/project-engine.js` | New | Project detection + cache |
| `src/task-parser.js` | New | Extract task metadata from lines |
| `src/date-parser.js` | New | Natural language date parsing |
| `src/quick-entry.js` | New | Quick capture modal |
| `src/status-timer.js` | New | Status bar timer |
| `src/renderer.js` | Refactor | Extract from main.js |
| `src/template-engine.js` | New | Template loading, rendering, insertion |
| `src/settings.js` | New | Settings defaults + tab |
