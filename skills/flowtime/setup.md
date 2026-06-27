---
name: flowtime-setup
description: Flowtime onboarding, settings, vault structure, data model, plugin commands, vault API reference, and agent contract. Load this before vault.md or tasks.md when the agent needs shared context.
---

# Flowtime Setup — Data Model, Settings & Agent Contract

Shared reference for the Flowtime Obsidian plugin. All other flowtime sub-skills depend on the information here.

---

## Vault Structure

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
└── Routines/                 ← Routine template .md files (default location)
```

## Data Model

| Entity | Storage | Format |
|--------|---------|--------|
| **Project** | Folder + folder note + management doc + wiki | `ProjectName/` with `type: project` frontmatter |
| **Bucket** | `Flowtime/Buckets.md` (canonical) | YAML frontmatter with `buckets:` array |
| **Task** | Inline markdown lines | `- [ ] description @date @1.5h @b:bucket-id #project/Name` |
| **Session** | NDJSON files (plugin folder) | `.obsidian/plugins/flowtime/sessions/YYYY-MM-DD.ndjson` |

### Vault Architecture (v1.7.0)

```
vault/
├── Flowtime/              ← User data as markdown (syncs, readable without plugin)
│   ├── Buckets.md         ← Bucket definitions (YAML frontmatter)
│   ├── Routines/          ← Routine template .md files (default: Flowtime/Routines/)
│   └── Sprints.md         ← Sprint definitions (future)
├── .obsidian/
│   └── plugins/flowtime/
│       ├── data.json      ← Plugin mechanics (timerSound, dailyCap, etc.)
│       ├── sessions/      ← Session tracking
│       ├── task-cache.json
│       └── task-index.json
```

The `Flowtime/` folder separates **user data** (markdown, syncs, agent-accessible) from **plugin mechanics** (JSON, cache, sessions). Agents only need to read/write markdown files in `Flowtime/` — no `.obsidian/` traversal required.

## Task Line Format

```
- [ ] description @date @duration @bucket:bucket-id @project:name 🔁 every week
```

### Task Elements

| Element | Syntax | Example | Notes |
|---------|--------|---------|-------|
| Checkbox | `- [ ]` / `- [x]` | `- [ ] Write API spec` | Required |
| Time block | `HH:mm—HH:mm` at start | `09:00—11:30` | Optional. Auto-calculates duration |
| Date | `@YYYY-MM-DD` | `@2026-06-24` | Also `@today`, `@tomorrow`, `@next-monday` |
| Duration | `@1.5h` or `@30m` | `@1.5h` | Hours or minutes |
| Bucket | `@b:name` / `@bucket:name` | `@b:deep-work` | Links to bucket definition |
| Milestone | `@ms:name` | `@ms:mvp` | Groups tasks under a milestone |
| Milestone heading | `## Name @ms` | `## MVP @ms` | Marks a heading as a milestone section in project notes |
| Project tag | `#project/Name` | `#project/website` | Configurable prefix |
| Priority | Emoji | `🔺⏫🔼🔽⏬` | 🔺=highest, ⏬=lowest |
| Recurrence | `🔁 every <period>` | `🔁 every day` | Auto-reschedules on completion |

### Full Example

```markdown
- [ ] 09:00—11:30 Code review @2026-06-24 🔼 @1.5h @b:deep-work @ms:mvp #project/backend
```

### Parsing (regex)

Checkbox + text: `/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/`

Parsed task object fields: `file`, `line`, `rawLine`, `time`, `taskDate`, `durationMinutes`, `rawText`, `cleanText`, `status`, `priority`, `bucket`, `milestone`.

### Clean task text (remove all directives)

```
.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "")
.replace(/@\d+(?:\.\d+)?[hm]/g, "")
.replace(/@(?:bucket|b):[^\s]+/g, "")
.replace(/@ms:[^\s]+/g, "")
.replace(/🔺|⏫|🔼|🔽|⏬/g, "")
.replace(/🔁 every \d* (day|days|week|weeks|month|months)/g, "")
.replace(/#\S+/g, "")
```

### Duration parsing

- `@1.5h` = 90 minutes, `@30m` = 30 minutes — regex: `/@(\d+(?:\.\d+)?)([hm])/`

### Date parsing keywords

`today`, `tod`, `tomorrow`, `tom`, `yesterday`, `yes`, `monday`–`sun` (next occurrence), `next monday`, `next week`, `in 3 days`, `in 1w`, `in 1m`, `YYYY-MM-DD`, `YYYY/MM/DD`, `DD.MM.YYYY`, `MM/DD/YYYY`.

### Date shortcut

| Input | Output |
|-------|--------|
| `@today` | Current YYYY-MM-DD |
| `@tomorrow` | Next calendar day |
| `@monday` | Next Monday (skips today) |
| `@next-monday` | Monday after next |
| `@next-week` | 7 days from now |

---

## Settings

Plugin mechanics (timers, display, notifications) are stored in `.obsidian/plugins/flowtime/data.json`. User-facing data (buckets, routines) lives in `Flowtime/*.md` at vault root.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `buckets` | array | [...] | Overridden by `Flowtime/Buckets.md` on startup |
| `dailyCap` | number | 12 | Daily hour budget cap |
| `projectFrontmatterKey` | string | `type` | Frontmatter field marking a project |
| `projectFrontmatterValue` | string | `project` | Value of that field |
| `projectNameKey` | string | `name` | Frontmatter field for display name |
| `fallbackToFolderName` | bool | true | Use folder name when no frontmatter |
| `tagPrefix` | string | `project/` | Prefix for project tags |
| `projectsRoot` | string | "" | Root folder for projects |
| `quickEntryTargetFile` | string | `daily-note` | Default task target |

### Agent Access (v1.7.0)

Bucket definitions live in `Flowtime/Buckets.md` as YAML frontmatter — readable without the plugin, syncs with your vault, and agents can edit it directly:

```javascript
// Read buckets (agent context)
const fs = require("fs")
const content = fs.readFileSync("Flowtime/Buckets.md", "utf-8")
// Parse YAML frontmatter for the "buckets" array
```

**`Flowtime/Buckets.md` format:**

```markdown
---
buckets:
  - id: deep-work
    name: Deep Work
    color: "#4a9eff"
    weeklyLimit: 20
    sortOrder: 0
  - id: admin
    name: Admin
    color: "#a8a8a8"
    weeklyLimit: 5
    sortOrder: 1
---
# Buckets

Time budget categories managed by Flowtime.
```

```javascript
// Read settings (inside Obsidian plugin API)
const data = await plugin.loadData()

// Write settings (via plugin)
plugin.settings.buckets = newBuckets
await plugin.saveData(plugin.settings)  // also writes Flowtime/Buckets.md
```

---

## Plugin Commands

Ask user to run via `Cmd+P`:

| Command ID | Name | Shortcut | What |
|-----------|------|----------|------|
| `add-task` | Add Task | `Cmd+Shift+I` | Quick Entry modal |
| `add-task-inline` | Add Task at Cursor | — | Inserts `- [ ] @today ` |
| `auto-process-inbox` | Auto-Process Inbox | — | Batch-process inbox items that have `@date` tags — routes to daily note or `@p:` project file |
| `process-inbox` | Process Inbox | — | Interactive one-by-one inbox processing modal |
| `append-to-inbox` | Append to Inbox | — | Quick textarea → inbox dump |
| `insert-daily-dashboard` | Insert daily dashboard | — | today/overdue/due-week blocks |
| `insert-weekly-dashboard` | Insert weekly dashboard | — | Weekly review blocks |
| `new-project` | New Project | — | Creates project folder + note |
| `add-bucket` | Add Bucket | — | Bucket creation modal |
| `extract-to-new-note` | Extract to new note | `Ctrl+G` / `Cmd+G` | Extracts selection to a new note (or appends to existing [[wikilink]] page) |
| `onboard` | Onboard / Migrate | — | Migrates old formats |

---

## Vault API Reference

```javascript
// Read
const content = await app.vault.read(file)

// Write
await app.vault.modify(file, newContent)

// Create file
await app.vault.create(path, content)

// Delete file
await app.vault.delete(file)

// Create folder
await app.vault.createFolder(path)

// Delete folder (recursive)
await app.vault.delete(folder, true)

// All markdown files
const files = app.vault.getMarkdownFiles()

// Get by path
const file = app.vault.getAbstractFileByPath(path)

// List directory
const listing = await app.vault.adapter.list(path)

// Read/write JSON
const data = await app.vault.readJson(path)
await app.vault.writeJson(path, data)

// Exists
const exists = await app.vault.adapter.exists(path)
```

---

## Agent Contract

### DO
- Read vault before making changes
- Check `status !== "x"` for active tasks
- Use `@b:<id>` for bucket assignment (short form)
- Use `@ms:<name>` for milestone assignment
- Use `#project/<Name>` for cross-folder project references
- Respect daily budget cap (default 12h)
- Use natural dates (`@today`, `@tomorrow`) for readability

### DON'T
- Don't create duplicate projects — check first
- Don't modify `.obsidian/` or `.git/`
- Don't use non-standard list markers
- Don't remove completed tasks unless asked
- Don't create empty tasks

### Error Handling
- Report file read/write failures
- Skip unparseable task lines, continue scanning
- Skip project creation if folder exists
- **Confirm with user before deleting a project** — it's destructive
