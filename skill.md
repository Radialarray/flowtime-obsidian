---
name: flowtime
description: Complete reference for managing Flowtime plugin data in Obsidian — projects (folder notes with frontmatter), buckets (time budget categories), tasks (markdown task lines with dates/durations/buckets), and sessions (NDJSON tracking history). Covers full CRUD operations on all entities by editing vault markdown files directly.
---

# Flowtime Skill — Agent Reference

Use this skill when helping a user manage their Obsidian vault using the Flowtime plugin. Flowtime stores all data in plain markdown files — the agent operates on the vault directly, then the plugin renders it.

---

## Vault Structure

The vault follows a **project-centric layout** with a high-level overview document for daily and weekly planning.

```
vault/
├── Dashboard.md              ← High-level overview (daily/weekly planning)
├── YYYY-MM-DD.md             ← Daily notes
├── ProjectA/                 ← Each project is a folder
│   ├── ProjectA.md           ← Folder note / project home (type: project)
│   ├── ProjectA Tasks.md     ← Task management, flowtime blocks, task lines
│   └── ProjectA Wiki.md      ← Knowledge base / reference wiki
├── ProjectB/
│   ├── ProjectB.md
│   ├── ProjectB Tasks.md
│   └── ProjectB Wiki.md
└── flowtime/
    └── sessions/             ← Session NDJSON files
```

### Decision Gate

| If the information is... | Put it in... | Format |
|--------------------------|-------------|--------|
| Something to DO with a deadline | **Project Management / Tasks doc** (or any task line) | `- [ ] description @date @bucket:name` |
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
| Project tag | `#project/Name` | `#project/website` | Configurable prefix in settings |
| Priority | Emoji | `🔺⏫🔼🔽⏬` | 🔺=highest, ⏬=lowest |
| Recurrence | `🔁 every <period>` | `🔁 every day` | Auto-reschedules on completion |

### Full Example

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🔼 @1.5h @b:deep-work #project/backend
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
  status,            // " " (open) or "x" / "X" (done)
  priority,          // emoji or null
  bucket,            // bucket id string or null
}
```

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
| `insert-daily-dashboard` | Insert daily dashboard | — | Inserts today/overdue/due-week blocks |
| `insert-weekly-dashboard` | Insert weekly dashboard | — | Inserts weekly review blocks |
| `new-project` | New Project | — | Creates project folder + folder note |
| `add-bucket` | Add Bucket | — | Opens bucket creation modal |
| `onboard` | Onboard / Migrate | — | Migrates old date format + code blocks |

---

## 6. CODE BLOCKS

These are Obsidian code blocks the plugin renders. Add them to any markdown note:

````markdown
```flowtime-today       # Tasks scheduled for today (with inline timer)
```flowtime-overdue     # Tasks past their date
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
- Don't modify files in `.obsidian/` or `.git/`
- Don't use `$` or other non-standard list markers — Obsidian uses `- [ ]` syntax
- Don't remove completed tasks from files unless explicitly asked — they serve as history
- Don't create empty tasks (must have at least a description)

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
.replace(/🔺|⏫|🔼|🔽|⏬/g, "")
.replace(/🔁 every \d* (day|days|week|weeks|month|months)/g, "")
.replace(/#\S+/g, "")
```

### Duration parsing
- `@1.5h` = 90 minutes, `@30m` = 30 minutes
- Regex: `/@(\d+(?:\.\d+)?)([hm])/`

### Date format
- Always use `YYYY-MM-DD` internally
- Display uses moment.js format from settings (default `YYYY-MM-DD`)
