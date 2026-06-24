---
name: flowtime
description: Complete reference for managing Flowtime plugin data in Obsidian — projects (folder notes with frontmatter), buckets (time budget categories), tasks (markdown task lines with dates/durations/buckets), and sessions (NDJSON tracking history). Covers full CRUD operations on all entities by editing vault markdown files directly.
---

# Flowtime Skill — Agent Reference

Use this skill when helping a user manage their Obsidian vault using the Flowtime plugin. Flowtime stores all data in plain markdown files — the agent operates on the vault directly, then the plugin renders it.

---

## Canonical Workspace Layout

The recommended Flowtime vault structure keeps the root clean — **2-3 user-facing files + 2 folders**:

```
vault/
├── Dashboard.md              ← Daily overview (overdue + today + dueweek)
├── Dashboard Weekly.md       ← Weekly overview (+ weekly + budget + sessions)
├── Daily/                    ← Daily notes (YYYY-MM-DD.md)
├── Projects/                 ← All projects (if nested layout)
│   ├── ProjectA/
│   │   ├── ProjectA.md       ← Folder note (type: project) — has `flowtime-project` block
│   │   ├── ProjectA Tasks.md ← Task management — raw markdown task lines
│   │   └── ProjectA Wiki.md  ← Knowledge base — specs, decisions, reference
│   ├── ProjectB/
│   │   ├── ProjectB.md
│   │   ├── ProjectB Tasks.md
│   │   └── ProjectB Wiki.md
│   └── ...
├── flowtime/
│   └── sessions/             ← Session NDJSON files (auto-managed)
├── Craft/                    ← Other content (not Flowtime-managed)
├── Notion/                   ← Other content (not Flowtime-managed)
└── .obsidian/                ← Core config
```

**Key rules:**
- **Vault root** should have only dashboards, `Daily/`, and `Projects/` — everything else is infrastructure
- **`flowtime-project` code block** goes ONLY on the folder note (`ProjectA.md`), NOT on the Tasks page — that avoids duplicate task rendering
- **Projects** can be at vault root (flat) or nested under `Projects/` — set `projectsRoot` accordingly in settings
- **Project scaffolding** = 3 files: folder note (frontmatter + `flowtime-project` block) + Tasks doc + Wiki doc
- **Do NOT** put placeholder/fake tasks in project templates — they clutter Flowtime tables with noise

### Two Dashboard Files

| File | Blocks | Purpose |
|------|--------|---------|
| `Dashboard.md` | `flowtime-overdue` + `flowtime-today` + `flowtime-dueweek` | Quick daily check |
| `Dashboard Weekly.md` | Above + `flowtime-weekly` + `flowtime-buckets` + `flowtime-sessions` | Weekly planning & review |

### Flat vs Nested Layout

| | Flat (default) | Nested |
|--|---------------|--------|
| Layout | Projects at vault root | Projects under `Projects/` |
| `projectsRoot` | `""` | `"Projects"` |
| Root clutter | Higher — projects are top-level | Cleaner — only 2-3 files |
| Best for | Few projects (<5) or simple vaults | Many projects or mixed vaults |

### Decision Gate

| If the information is... | Put it in... | Format |
|--------------------------|-------------|--------|
| Something to DO with a deadline | **Project Tasks doc** (or any task line) | `- [ ] description @date @bucket:name` |
| Reference / knowledge / spec / decision | **Project Wiki** | Regular markdown in the project folder |
| Daily/weekly overview and cross-project view | **Dashboard.md** | Flowtime code blocks at vault root |

## Data Model Overview

Flowtime has four entity types. All live in markdown files in the vault:

| Entity | Storage | Format |
|--------|---------|--------|
| **Project** | Folder + folder note + management doc + wiki | `ProjectName/` with `type: project` frontmatter |
| **Bucket** | Plugin settings (JSON) | `data.json` via `app.vault.readJson`/`app.vault.writeJson` |
| **Task** | Inline markdown lines | `- [ ] description @date @1.5h @b:bucket-id #project/Name` |
| **Session** | NDJSON files | `flowtime/sessions/YYYY-MM-DD.ndjson` |

---

## 0. OVERVIEW DOCUMENT (Dashboard)

The vault has a high-level overview document (typically `Dashboard.md` at the vault root) for daily and weekly planning. This is the central hub for:

- **Daily planning** — `flowtime-today` and `flowtime-overdue` code blocks
- **Weekly review** — `flowtime-weekly` and `flowtime-dueweek` code blocks
- **Budget tracking** — `flowtime-buckets` block for weekly time budgets
- **Session history** — `flowtime-sessions` block for time tracking review

### Typical Dashboard Layout

````markdown
# Dashboard

## 🔄 Carry Over
```flowtime-overdue
```

## 🎯 Today
```flowtime-today
```

## ⚠️ Due This Week
```flowtime-dueweek
```

## 📊 Weekly Budget
```flowtime-buckets
```

## 📈 Sessions
```flowtime-sessions
```
````

**Plugin shortcuts:**
- `Cmd+P` → "Insert daily dashboard" — inserts today/overdue/due-week blocks
- `Cmd+P` → "Insert weekly dashboard" — inserts weekly review blocks
- Create it manually as a `Dashboard.md` file at the vault root

### Agent's Role

When a user asks about their day or week:
1. Check if `Dashboard.md` exists. If not, offer to create it.
2. Scan the vault for tasks matching the requested view (today, overdue, weekly, etc.)
3. Present a structured summary grouped by project
4. Offer to create/modify tasks, reschedule overdue items, or update budgets

---

## 1. PROJECTS

A project is a **folder** containing a **folder note** (same name as the folder) with frontmatter, plus dedicated docs for task management and knowledge.

### Project Structure

```
Website-Redesign/                     ← project folder
  Website-Redesign.md                 ← folder note / project home (type: project)
  Website-Redesign Tasks.md           ← TASK MANAGEMENT — tasks, sprints, flowtime blocks
  Website-Redesign Wiki.md            ← WIKI / KNOWLEDGE BASE — specs, decisions, reference
  meeting-notes.md
  research.md
```

**Three standard files inside each project:**

| File | Purpose | Content |
|------|---------|---------|
| **`ProjectName.md`** (folder note) | Project home page | Frontmatter `type: project`, high-level goals, `flowtime-project` block |
| **`ProjectName Tasks.md`** | Task management | Task lines, sprint planning, action items, flowtime code blocks |
| **`ProjectName Wiki.md`** | Knowledge base | Architecture docs, meeting notes, specs, research, decisions |

### Folder Note Frontmatter

```markdown
---
type: project
name: Website Redesign
status: active
tags: [project]
---
```

- `type: project` is the default marker (configurable in settings)
- `name:` is the display name (optional, falls back to folder name)
- Tasks reference a project either by location (being inside a project folder) or by a `#project/Name` tag (configurable prefix)

### READ Projects

Scan all markdown files. For each file where the **basename matches the parent folder name**, check frontmatter for `type: project`:

```
files = app.vault.getMarkdownFiles()
for each file:
  if file.basename != parent_folder_name: skip
  content = await app.vault.read(file)
  parse frontmatter for "type: project"
  if found: this is a project (name from frontmatter or folder name)
```

Alternatively, use `plugin.projectEngine.getAllProjects()` from within an Obsidian context.

### CREATE Project

1. Create a folder: `app.vault.createFolder("ProjectName")`
2. Create a folder note from the project template:
   ```
   ---
   type: project
   name: ProjectName
   status: active
   tags: [project]
   ---

   # ProjectName

   ## 🎯 Goal

   ## 📋 Tasks

   ```flowtime-project
   ```

   - [ ] Define scope 🔺 @{{DATE}}
   - [ ] First milestone @{{DATE}}
   - [ ] Daily check-in 🔁 every day @{{DATE}}

   ## 📝 Notes
   ```
3. Replace `{{DATE}}` with `today`'s date (YYYY-MM-DD), `{{NAME}}` with the project name.

**Plugin command:** Ask user to run `Cmd+P` → "Flowtime: New Project" → enter name.

### Recommended: Scaffold Project Management Doc + Wiki

After creating the project folder and folder note, scaffold two additional docs:

**Project Management doc** (`ProjectName Tasks.md` — contains tasks and flowtime blocks):
````markdown
# ProjectName — Tasks

## 🎯 Active Sprint

```flowtime-project
```

- [ ] Define scope 🔺 @{{DATE}} @1h
- [ ] First milestone @{{DATE}}
- [ ] Daily check-in 🔁 every day @{{DATE}} @15m

## 📋 Backlog

- [ ] Future improvement
- [ ] Long-term goal
````

**Wiki / Knowledge Base doc** (`ProjectName Wiki.md` — reference information):
```markdown
# ProjectName — Wiki

## Overview

## Architecture

## Decisions

## Reference Links

## Meeting Notes
```

**Example project folder after scaffolding:**
```
Website-Redesign/
  Website-Redesign.md              ← folder note / project home (type: project)
  Website-Redesign Tasks.md        ← task management (flowtime blocks + task lines)
  Website-Redesign Wiki.md         ← knowledge base (specs, decisions, notes)
```

### DELETE Project

1. Delete the folder note: `app.vault.delete(folderNoteFile)`
2. Delete the folder and all contents: `await app.vault.delete(folder, true)` (the `true` forces recursive delete)

**WARNING:** This removes all files inside the project folder. Ask user to confirm.

### UPDATE Project

- **Rename:** Not directly supported in Flowtime. Move the folder + update the folder note.
- **Change display name:** Edit `name:` in frontmatter.
- **Change status:** Edit `status:` in frontmatter (`active`, `archived`, `completed`).

---

## 2. BUCKETS (Time Budgets)

Buckets are time-budget categories with weekly limits. They live in plugin settings data.

### Default Buckets

| id | name | color | weeklyLimit |
|----|------|-------|-------------|
| deep-work | Deep Work | #4a9eff | 20h |
| admin | Admin | #a8a8a8 | 5h |
| meetings | Meetings | #e6a700 | 5h |

### READ Buckets

Access via plugin settings:
```
plugin.settings.buckets
// Returns: [{ id, name, color, weeklyLimit, sortOrder }, ...]
```

From vault data directly:
```
data = await app.vault.readJson(".obsidian/plugins/flowtime/data.json")
buckets = data.buckets
```

### CREATE Bucket

Modify the plugin settings buckets array:

```javascript
plugin.settings.buckets.push({
  id: "new-bucket-id",        // lowercase, hyphenated
  name: "New Bucket",
  color: "#4a9eff",
  weeklyLimit: 10,
  sortOrder: plugin.settings.buckets.length,
});
await plugin.saveData(plugin.settings);
```

**Plugin command:** Ask user to run `Cmd+P` → "Flowtime: Add Bucket".

**Bucket naming convention:** `id` is auto-generated from name: `name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")`.

### UPDATE Bucket

Update a bucket by its `id`:

```javascript
const bucket = plugin.settings.buckets.find(b => b.id === "deep-work");
if (bucket) {
  bucket.name = "Deep Focus Work";
  bucket.weeklyLimit = 25;
  await plugin.saveData(plugin.settings);
}
```

### DELETE Bucket

```javascript
plugin.settings.buckets = plugin.settings.buckets.filter(b => b.id !== "deep-work");
await plugin.saveData(plugin.settings);
```

### Assigning Tasks to Buckets

Add `@b:bucket-id` or `@bucket:bucket-id` to the task line:
```
- [ ] Code review @today @1h @b:deep-work
- [ ] Standup @today @15m @bucket:meetings
```

---

## 3. TASKS

Tasks are markdown list items with checkbox status and annotation tags.

### Task Line Format

```
- [ ] description @date @duration @bucket:bucket-id @project:name 🔁 every week
- [x] completed task @2026-06-24 @30m @b:deep-work
```

### Task Elements

| Element | Syntax | Example | Notes |
|---------|--------|---------|-------|
| Checkbox | `- [ ]` / `- [x]` | `- [ ] Write API spec` | Required. Space = open, x = done |
| Time block | `HH:mm—HH:mm` at start | `09:00—11:30` | Optional. Auto-calculates duration |
| Date | `@YYYY-MM-DD` | `@2026-06-24` | Also `@today`, `@tomorrow`, `@next-monday` |
| Duration | `@1.5h` or `@30m` | `@1.5h` | Hours or minutes |
| Bucket | `@b:name` / `@bucket:name` | `@b:deep-work` | Links to bucket definition |
| Project tag | `@p:Name` | `@p:Website` | New `@p:` syntax (v0.4.0). Legacy `#project/Name` still works |
| Priority (color dot) | `🟥` / `🟨` / `🟩` | `🟥` | 🟥=high, 🟨=med, 🟩=low |
| Priority text | `@high` / `@med` / `@low` | `@high` | Aliases for 🟥/🟨/🟩 (v0.4.0) |
| Status tag | `@soon` | `@soon` | Marks as backlog/up-next. Shows in "📋 Up Next" section (v0.4.0) |
| Recurrence | `🔁 every <period>` | `🔁 every day` | Auto-reschedules on completion |

### Full Examples

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🟨 @1.5h @b:deep-work @p:backend
- [ ] Review PR draft @soon @high
- [ ] Morning standup @tomorrow @med @15m @b:meetings
```

### `@due:` Syntax

In addition to `@date`, tasks can use `@due:YYYY-MM-DD` or `@due:tomorrow` to mark a due date. The `due:` prefix is preserved in the raw task line and is displayed in the `taskDate` field. Both `@YYYY-MM-DD` and `@due:YYYY-MM-DD` are treated identically by the parser.

```markdown
- [ ] Submit report @due:2026-06-30 @1h @b:admin
- [ ] Pay invoice @due:tomorrow
```

### Parsing a Task Line (for agent code)

Pattern: `/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/`

The parsed task object has these fields:

```javascript
{
  file,              // obsidian TFile reference
  line,              // line number in file
  rawLine,           // full original line text
  time,              // time block string e.g. "09:00—11:30"
  taskDate,          // YYYY-MM-DD string or ""
  durationMinutes,   // number (0 if none)
  rawText,           // text after checkbox minus time block
  cleanText,         // rawText with all directives stripped
  status,            // "" (empty string = open) or "x" / "X" (done)
  priority,          // emoji or null
  bucket,            // bucket id string or null
}
```

> **Note on status field:** In the `_taskCache` and the runtime parser, an open task has `status: ""` (empty string), not `" "` (space). Completed tasks have `status: "x"` or `"X"`. Always use `status === "x" || status === "X"` to check completion, and `!status || status.trim() === ""` for open tasks.

### Date Parsing Available Keywords

The plugin's `parseDate()` function supports: `today`, `tod`, `tomorrow`, `tom`, `yesterday`, `yes`, `monday`–`sun` (next occurrence), `next monday` (skip one occurrence), `next week`, `in 3 days`, `in 1w`, `in 1m`, `YYYY-MM-DD`, `YYYY/MM/DD`, `DD.MM.YYYY`, `MM/DD/YYYY`.

### Agent Date Shortcut

When you need to insert a task date, use the plugin's natural date parser rather than computing dates yourself. The mapping:

| Agent Input | Output |
|-------------|--------|
| `@today` | Current date in YYYY-MM-DD |
| `@tomorrow` | Next calendar day YYYY-MM-DD |
| `@monday` | Next Monday (skips if today is Monday) |
| `@next-monday` | Monday after next |
| `@next-week` | 7 days from now |
| `@weekend` | Not supported — use next Saturday/Sunday |
| `YYYY-MM-DD` | Exact date |

### @-Command Macros (v0.4.0)

Type `@` at the **start of a line** (no task marker) to open command macros. Select one and it expands the entire line:

| Macro | Expands to |
|-------|-----------|
| `@td` | `- [ ]  @today ` — quick today task |
| `@tm` | `- [ ]  @tomorrow ` — tomorrow task |
| `@tk` | `- [ ]  ` — empty skeleton |
| `@now` | `- [ ]  @today @15m ` — quick 15min pomodoro |
| `@1h` | `- [ ]  @today @1h ` — quick 1h block |
| `@rec` | `- [ ]  🔁 every day @today ` — daily recurring |
| `@rep` | `- [ ]  🔁 every week @monday ` — weekly recurring |
| `@today` | ``flowtime-today`` code block |
| `@overdue` | ``flowtime-overdue`` code block |
| `@weekly` | ``flowtime-weekly`` code block |
| `@budget` | ``flowtime-buckets`` code block |
| `@proj` | ``flowtime-project`` code block |
| `@sessions` | ``flowtime-sessions`` code block |

### READ Tasks (List All)

Scan every markdown file (excluding `.obsidian/` and `.git/`):

```javascript
for each file in app.vault.getMarkdownFiles():
  if file.path.startsWith(".obsidian") || file.path.startsWith(".git"): skip
  content = await app.vault.read(file)
  lines = content.split("\n")
  for each line at index i:
    parsed = parseTaskLine(line, file, i)
    if parsed: add to results
```

**Every task that has `status === "x"` or `"X"` or `"-"` is completed** and should be filtered out when showing active tasks.

### READ Tasks (Filtered)

When the user wants tasks by view, apply these date-based filters after reading all tasks:

| View Mode | Filter |
|-----------|--------|
| **today** | `taskDate === today` |
| **overdue** | `taskDate < today` and taskDate exists |
| **dueweek** | `taskDate >= tomorrow` and `taskDate <= sunday` |
| **weekly** | `taskDate >= monday` and `taskDate <= sunday` (this week) |
| **project** | `project === targetProjectName` |

Where `today`, `monday` and `sunday` are derived from current date:
- `today = YYYY-MM-DD`
- `monday = today - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)`
- `sunday = monday + 6`

### CREATE Task

1. Determine target file (daily note, active file, or project note)
2. Build task line:
   ```
   - [ ] Task description @2026-06-24 @1.5h @b:deep-work #project/ProjectName
   ```
3. Append to file:
   ```javascript
   content = await app.vault.read(file)
   newContent = content.trimEnd() + "\n" + taskLine + "\n"
   await app.vault.modify(file, newContent)
   ```

**Target file priority:**
1. If user specifies a file, use that
2. If user asks for "daily note": find file whose basename = today's date (YYYY-MM-DD)
3. If user asks for "project file": find the folder note of the task's project
4. Default: active file

**Plugin shortcut:** Ask user to press `Cmd+Shift+I` or run command "Add Task" → modal opens.

### UPDATE Task

To modify a task, you must edit its line in its source file:

1. Read the file content
2. Split into lines
3. Replace the specific line (identified by `file.path` + `line` index)
4. Write back: `await app.vault.modify(file, lines.join("\n"))`

**Change date:** Replace or add `@YYYY-MM-DD` in the line:
```javascript
// Replace existing date: remove old @date, append new one
line = line.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "").trimEnd()
line = line + ` @${newDate}`

// Or remove date entirely (backlog):
line = line.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "").trimEnd()
```

**Change bucket:** Replace or add `@b:bucket-id`:
```javascript
// Replace existing bucket directive
line = line.replace(/@(?:bucket|b):[^\s]+/g, "").trimEnd()
if (bucketId) line = line + ` @b:${bucketId}`
```

**Change duration:** Replace or add `@1.5h`:
```javascript
line = line.replace(/@\d+(?:\.\d+)?[hm]/g, "").trimEnd()
if (minutes > 0) {
  const durStr = minutes < 60 ? `${minutes}m` : `${minutes / 60}h`
  line = line + ` @${durStr}`
}
```

**Change time block:** Replace the leading time block:
```javascript
line = line.replace(/^\s*(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})\s*/, "")
  .trimStart()
if (timeBlock) line = line.replace(/^(\s*[-*+]\s*\[[^\]]*\]\s*)/,
  `$1${timeBlock} `)
```

**Change status (complete/uncomplete):**
```javascript
// Mark complete:
line = line.replace(/\[(\s)\]/, "[x]")
// Mark incomplete:
line = line.replace(/\[([xX])\]/, "[ ]")
```

### DELETE Task

```javascript
content = await app.vault.read(file)
lines = content.split("\n")
lines.splice(task.line, 1)  // remove the line
await app.vault.modify(file, lines.join("\n"))
```

### Recurring Tasks

Tasks with `🔁` directive auto-reschedule when completed. The pattern is:
```
- [ ] Morning review 🔁 every day @2026-06-24
```

When you mark such a task complete (change `[ ]` to `[x]`), you should also:
1. Update the date to the next occurrence
2. Change `[x]` back to `[ ]` (it stays open, just advances to next date)

**Supported periods:** `every day`, `every week`, `every month`, `every 2 weeks`, etc.

---

## 4. SESSIONS (Time Tracking)

Sessions are recorded automatically when a timer runs to completion or is stopped. They are stored as NDJSON files.

### Storage Format

```
flowtime/sessions/YYYY-MM-DD.ndjson
```

Each line is a JSON record:

```json
{"type":"session","date":"2026-06-24","start_time":"2026-06-24T09:00:00.000Z","end_time":"2026-06-24T10:30:00.000Z","duration_minutes":90,"bucket":"deep-work","task_text":"Code review","notes":""}
```

Completion records (from checkbox toggle):
```json
{"type":"completion","date":"2026-06-24","bucket":"deep-work","task_text":"Code review","completed_at":"2026-06-24T10:30:00.000Z"}
```

### READ Sessions

```javascript
// List all session NDJSON files
listing = await app.vault.adapter.list("flowtime/sessions")
files = listing.files.filter(f => f.endsWith(".ndjson"))

for each file:
  content = await app.vault.adapter.read(file)
  lines = content.split("\n").filter(l => l.trim())
  for each line:
    record = JSON.parse(line)
    // record.type === "session" || record.type === "completion"
```

### Filter Sessions by Date

```javascript
const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})\.ndjson$/)
// The date in the filename IS the session date — use it for range filtering
```

### Get Daily Totals

```javascript
// Group sessions by date + bucket, sum duration_minutes
// Returns [{ date, bucket, total_minutes }, ...]
```

### Get Weekly Totals

```javascript
// Group daily totals by ISO week (Monday-starting)
// Returns [{ weekStart, bucket, total_minutes }, ...]
```

---

## 5. PLUGIN COMMANDS

These are registered Obsidian commands. You can ask the user to run them via the command palette (`Cmd+P`).

| Command ID | Name | Shortcut | What it does |
|-----------|------|----------|-------------|
| `add-task` | Add Task | `Cmd+Shift+I` | Opens Quick Entry modal |
| `add-task-inline` | Add Task at Cursor | — | Inserts `- [ ] @today ` at cursor |
| `@` completions | (built-in) | — | `@` in task lines → directives (@today, @b:, @p:, @soon). `@` at line start → command macros (@td, @now, @weekly) |
| `insert-daily-dashboard` | Insert daily dashboard | — | Inserts today/overdue/due-week blocks |
| `insert-weekly-dashboard` | Insert weekly dashboard | — | Inserts weekly review blocks |
| `new-project` | New Project | — | Creates project folder + all 3 files (folder note, Tasks.md, Wiki.md) |
| `add-bucket` | Add Bucket | — | Opens bucket creation modal |
| `onboard` | Onboard / Migrate | — | Multi-step setup wizard: layout → dashboards → buckets → daily notes → first project (v0.4.0) |
| `reset-settings` | Reset to Defaults | — | Clears settings + cache, resets to factory defaults (v0.4.0) |
| `rebuild-cache` | Rebuild Task Cache | — | Clears task cache, rebuilds on next render (v0.4.0) |

---

## 6. CODE BLOCKS

These are Obsidian code blocks the plugin renders. Add them to any markdown note:

````markdown
```flowtime-today       # Tasks scheduled for today (with inline timer)
```flowtime-overdue     # Tasks past their date
```flowtime-soon        # Tasks tagged with @soon (up next / backlog)
```flowtime-dueweek     # Tasks due tomorrow through Sunday
```flowtime-weekly      # This week's tasks grouped by project
```flowtime-project     # Tasks for the note's containing project
```flowtime-buckets     # Budget overview with progress bars
```flowtime-sessions    # Session history + analytics
````

---

## 7. SETTINGS

Settings are stored in the plugin's `data.json` (read via `plugin.loadData()`, write via `plugin.saveData()`).

Key settings for agent use:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `buckets` | array | [...] | Bucket definitions |
| `dailyCap` | number | 12 | Daily hour budget cap |
| `projectFrontmatterKey` | string | `type` | Frontmatter field marking a project |
| `projectFrontmatterValue` | string | `project` | Value of that field |
| `projectNameKey` | string | `name` | Frontmatter field for display name |
| `fallbackToFolderName` | bool | true | Use folder name when no frontmatter |
| `tagPrefix` | string | `project/` | Prefix for project tags |
| `projectsRoot` | string | "" | Root folder for projects (empty = entire vault) |
| `quickEntryTargetFile` | string | `daily-note` | Default task target |

To read/write settings:

```javascript
// Read
const data = await plugin.loadData()
// or: const data = await app.vault.readJson(".obsidian/plugins/flowtime/data.json")

// Write
plugin.settings.buckets = newBuckets
await plugin.saveData(plugin.settings)
```

---

## 8. COMMON WORKFLOWS

### "Show me what's on my plate today"

1. Determine today's date: `YYYY-MM-DD`
2. Scan all markdown files for tasks where `taskDate === today` and `status !== "x"` and `status !== "X"`
3. For each task, also resolve the project name via `projectEngine.resolve()` or tag parsing
4. Present as a structured list grouped by project

### "Create a new project called X"

1. Create folder `X/`
2. Create folder note `X/X.md` with frontmatter `type: project, name: X, status: active`
3. Create management doc `X.md` with ````flowtime-project```` block and starter tasks
4. Create wiki doc `X Wiki.md` with standard knowledge base sections
5. Offer to open the new project files

### "Add a task to X for tomorrow"

1. Locate the project folder note for X, or find/add the daily note
2. Append:
   ```
   - [ ] [user description] @tomorrow @1h @b:deep-work #project/X
   ```
3. If user gave a duration and/or bucket, include those

### "What tasks are overdue?"

1. Scan all markdown files for tasks where `taskDate < today` and `taskDate !== ""` and `status !== "x"`
2. Present with date, project, and an action suggestion (reschedule to today, backlog, or delete)

### "Move all overdue tasks to today"

For each overdue task (taskDate exists and < today):
1. Replace the date in the task line with today's date
2. Write the file back

### "Show me this week's budget"

1. Determine Monday and Sunday of current ISO week
2. For each bucket definition in settings, compute total durationMinutes of tasks with that bucket and a date within the week
3. Present bucket name, used hours, limit, and remaining

### "I want a new bucket called Design"

1. Create a bucket: id=`design`, name=`Design`, color=`#ff6b6b`, weeklyLimit=15, sortOrder=3
2. Add it to `plugin.settings.buckets`
3. Save settings

---

## 9. WORKING WITH VAULT FILES

All direct vault operations use the Obsidian `Vault` API:

```javascript
// Read a file
const content = await app.vault.read(file)

// Write (overwrite) a file
await app.vault.modify(file, newContent)

// Create a file
await app.vault.create(path, content)

// Delete a file
await app.vault.delete(file)

// Create a folder
await app.vault.createFolder(path)

// Delete a folder (recursive)
await app.vault.delete(folder, true)

// Get all markdown files
const files = app.vault.getMarkdownFiles()

// Get a file by path
const file = app.vault.getAbstractFileByPath(path)

// List directory contents
const listing = await app.vault.adapter.list(path)

// Read a JSON file
const data = await app.vault.readJson(path)

// Write a JSON file
await app.vault.writeJson(path, data)

// Check file/folder exists
const exists = await app.vault.adapter.exists(path)
```

---

## 9.5 Operating from Outside Obsidian (CLI / Agent Context)

When an agent manages Flowtime without access to `app.vault` APIs (e.g., CLI-based agents, scripted setup), all operations must be done via direct file system access.

### Key Differences vs Inside-Obsidian

| Operation | Inside Obsidian | Outside Obsidian |
|-----------|---------------|------------------|
| Read file | `app.vault.read(file)` | Read file via filesystem |
| Write file | `app.vault.modify(file, content)` | Write file via filesystem |
| Create file | `app.vault.create(path, content)` | Write new file |
| Delete folder | `app.vault.delete(folder, true)` | `rm -rf` |
| Plugin settings | `plugin.loadData()` / `plugin.saveData()` | Edit `.obsidian/plugins/flowtime/data.json` directly |
| Daily notes config | Core Obsidian settings API | Edit `.obsidian/daily-notes.json` directly |
| Task re-index | Triggered automatically by plugin events | ❌ NOT available — must ask user to reopen Obsidian or trigger re-index manually |

### Files You Can Safely Edit from Outside Obsidian

| File | Purpose | Notes |
|------|---------|-------|
| `ProjectName/ProjectName.md` | Folder note | Standard markdown + frontmatter |
| `ProjectName/ProjectName Tasks.md` | Task management | Markdown with task lines |
| `ProjectName/ProjectName Wiki.md` | Knowledge base | Standard markdown |
| `Dashboard.md` | Overview | Flowtime code blocks |
| `Daily/YYYY-MM-DD.md` | Daily notes | Tasks + flowtime blocks |
| `.obsidian/daily-notes.json` | Daily notes folder config | Update `folder` key when moving daily notes |
| `flowtime/sessions/YYYY-MM-DD.ndjson` | Session data | NDJSON format, one JSON object per line |

### Plugin Settings (`data.json`) — Cautions

The file `.obsidian/plugins/flowtime/data.json` can be edited directly, but:

1. **Cache is now separate (v0.4.0+)**: The `_taskCache` has been moved to `.obsidian/plugins/flowtime/task-cache.json` so `data.json` stays lean. You can safely delete `task-cache.json` — it will rebuild on next render.
2. **Always valid JSON**: Use `jq` or a JSON validator before writing. Invalid JSON will crash the plugin on load.
3. **Restart required**: Changes to `data.json` only take effect when Obsidian reloads the plugin (restart or `Cmd+P` → "Reload app without saving").
4. **Watch for stale paths**: If you change `projectsRoot`, the old cache paths will be invalid. Run `Cmd+P` → "Flowtime: Rebuild Task Cache" after changing this setting.
5. **Empty `_taskCache` entries (legacy)**: In older versions, every file without tasks stored an empty array `[]` in the cache. v0.4.0+ only stores entries for files that actually have tasks, and cleans empty entries on load.

### Recommended Post-CLI Setup Steps

After making changes from the CLI, tell the user to do this in Obsidian:

1. **`Cmd+P` → "Flowtime: Rebuild Task Cache"** (clears + rebuilds cache on next render)
2. **`Cmd+P` → "Flowtime: Onboard / Migrate"** if migrating old date formats
3. **`Cmd+P` → "Flowtime: Reset to Defaults"** if settings are corrupted
4. **Verify** dashboards render correctly

### Editing `daily-notes.json`

The core Obsidian setting at `.obsidian/daily-notes.json` controls where daily notes are created:

```json
{
  "folder": "Daily",
  "template": "Daily/Template.md",
  "format": "YYYY-MM-DD"
}
```

If you move daily notes to a new folder, update this file AND the `_taskCache` will have stale entries for old daily note paths.

### Handling Session Directory

In v0.4.0+, the plugin auto-creates `flowtime/sessions/` on load if it's missing. In earlier versions, warn the user that the plugin may not auto-create it.

---

## 9.6 Troubleshooting

### Stale Task Cache

If the task cache shows stale/incorrect data (e.g., deleted files still appearing, wrong dates):

1. **Clear and rebuild:** In Obsidian, run `Cmd+P` → "Flowtime: Rebuild Task Cache". Cache clears on next render.
2. **From CLI:** Edit `.obsidian/plugins/flowtime/task-cache.json` and set its content to `{}` (empty JSON object). The plugin will rebuild on next render.
3. **After changing `projectsRoot`:** The old cache paths become invalid. The plugin does NOT auto-clear in this case — run the rebuild command manually.

### Cache File Location (v0.4.0+)

The task cache is stored separately from `data.json` at:
```
.obsidian/plugins/flowtime/task-cache.json
```

This keeps `data.json` lean. If you delete this file, the plugin rebuilds it automatically on next render.

### Session Data Not Appearing

1. Check that `flowtime/sessions/` directory exists (v0.4.0+ creates it on load).
2. Session NDJSON files are named `YYYY-MM-DD.ndjson`. Each line must be valid JSON.
3. If a session file is corrupted, delete it or fix the JSON — the plugin silently skips unparseable lines.
4. Restart Obsidian after editing session files from outside.

### `_taskCache` in data.json (Legacy)

If you see `_taskCache` in `data.json` while running v0.4.0+, the plugin migrates it to the separate `task-cache.json` file automatically and strips it from `data.json` on next save. No action needed.

### Plugin Config Not Taking Effect

Changes to `.obsidian/plugins/flowtime/data.json` from outside Obsidian require one of:
- Reload the plugin: `Cmd+P` → "Reload app without saving"
- Restart Obsidian entirely
- Run `Cmd+P` → "Flowtime: Reset to Defaults" if settings are corrupted

---

## 10. AGENT CONTRACT

Guidelines for agent behavior when managing Flowtime data:

### DO
- Read the vault to understand existing projects and tasks before making changes
- Always check `status !== "x"` when listing active tasks (completed tasks are still in files but marked `[x]`)
- Use the `@b:<id>` format for bucket assignment (short form preferred)
- Use `#project/<Name>` tag when creating tasks that belong to a project but live in a different folder
- Respect the daily budget cap (default 12h) when scheduling tasks
- Use natural dates (`@today`, `@tomorrow`) for readability when the user will see the raw task line

### DON'T
- Don't create duplicate projects — check existing projects first
- Don't modify files in `.obsidian/` **except** `plugins/flowtime/data.json`, `plugins/flowtime/task-cache.json`, and `daily-notes.json` — these are safe to edit
- Don't modify `.git/` or any git-internal files
- Don't use `$` or other non-standard list markers — Obsidian uses `- [ ]` syntax
- Don't remove completed tasks from files unless explicitly asked — they serve as history
- Don't create empty tasks (must have at least a description)
- Don't delete `task-cache.json` without warning the user — it will be rebuilt but may cause a temporary performance hit on next render

### Error Handling
- If a file read/write fails, report the error to the user
- If a task line can't be parsed, skip it and continue scanning — don't crash
- If a project folder already exists when creating, skip the create step
- If deleting a project, confirm with the user first — it's destructive

---

## 11. QUICK REFERENCE

### Parse a task line (regex)
```
/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/
```

### Clean task text (remove all directives)
```
.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "")
.replace(/@\d+(?:\.\d+)?[hm]/g, "")
.replace(/@(?:bucket|b):[^\s]+/g, "")
.replace(/@p:[^\s]+/g, "")              // project directive
.replace(/@(?:high|med|low|soon)\b/gi, "") // status/priority tags
.replace(/[🟥🟨🟩]/g, "")                   // priority color dots
.replace(/🔁 every \d* (day|days|week|weeks|month|months)/g, "")
.replace(/#\S+/g, "")
```

### Duration parsing
- `@1.5h` = 90 minutes, `@30m` = 30 minutes
- Regex: `/@(\d+(?:\.\d+)?)([hm])/`

### Date format
- Always use `YYYY-MM-DD` internally
- Display uses moment.js format from settings (default `YYYY-MM-DD`)
