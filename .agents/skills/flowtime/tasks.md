---
name: flowtime-tasks
description: Flowtime daily business — task CRUD, dashboard, daily/weekly planning, code blocks, sessions, time tracking, and common workflows.
---

# Flowtime Tasks — Daily Business

Load `setup.md` first for vault structure, data model, task format, date parsing, vault API, and agent contract.

---

## 1. DASHBOARD

The overview document (typically `Dashboard.md` at vault root) is the central hub for daily/weekly planning.

### Typical Layout

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
- `Cmd+P` → "Insert daily dashboard"
- `Cmd+P` → "Insert weekly dashboard"

### Agent's Role

1. Check if `Dashboard.md` exists — offer to create if missing
2. Scan vault for tasks matching the requested view (today, overdue, weekly)
3. Present structured summary grouped by project
4. Offer to create/modify tasks, reschedule overdue items, update budgets

---

## 2. TASK CRUD

### READ Tasks (All)

Scan every markdown file excluding `.obsidian/` and `.git/`:

```javascript
for each file in app.vault.getMarkdownFiles():
  if file.path.startsWith(".obsidian") || file.path.startsWith(".git"): skip
  content = await app.vault.read(file)
  lines = content.split("\n")
  for each line at index i:
    parsed = parseTaskLine(line, file, i)
    if parsed: add to results
```

Completed tasks have `status === "x"`, `"X"`, or `"-"` — filter out when showing active tasks.

### READ Tasks (Filtered)

Date-based filters after reading all tasks:

| View Mode | Filter |
|-----------|--------|
| **today** | `taskDate === today` |
| **overdue** | `taskDate < today` and taskDate exists |
| **dueweek** | `taskDate >= tomorrow` and `taskDate <= sunday` |
| **weekly** | `taskDate >= monday` and `taskDate <= sunday` |
| **project** | `project === targetProjectName` |

Date helpers:
- `today = YYYY-MM-DD`
- `monday = today - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)`
- `sunday = monday + 6`

### CREATE Task

1. Determine target file (daily note, active file, or project note)
2. Build task line:
   ```
   - [ ] Task description @2026-06-24 @1.5h @b:deep-work #project/ProjectName
   ```
3. Append:
   ```javascript
   content = await app.vault.read(file)
   newContent = content.trimEnd() + "\n" + taskLine + "\n"
   await app.vault.modify(file, newContent)
   ```

**Target file priority:** user-specified → daily note (basename = today) → project folder note → active file.

**Plugin shortcut:** `Cmd+Shift+I` or "Add Task" command.

### UPDATE Task

Edit the task's line in its source file:

```javascript
content = await app.vault.read(file)
lines = content.split("\n")
// Modify lines[task.line]
await app.vault.modify(file, lines.join("\n"))
```

**Change date:**
```javascript
line = line.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "").trimEnd()
line = line + ` @${newDate}`
// Remove date entirely (backlog):
line = line.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "").trimEnd()
```

**Change bucket:**
```javascript
line = line.replace(/@(?:bucket|b):[^\s]+/g, "").trimEnd()
if (bucketId) line = line + ` @b:${bucketId}`
```

**Change duration:**
```javascript
line = line.replace(/@\d+(?:\.\d+)?[hm]/g, "").trimEnd()
if (minutes > 0) {
  const durStr = minutes < 60 ? `${minutes}m` : `${minutes / 60}h`
  line = line + ` @${durStr}`
}
```

**Change time block:**
```javascript
line = line.replace(/^\s*(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})\s*/, "").trimStart()
if (timeBlock) line = line.replace(/^(\s*[-*+]\s*\[[^\]]*\]\s*)/, `$1${timeBlock} `)
```

**Change status:**
```javascript
line = line.replace(/\[(\s)\]/, "[x]")   // complete
line = line.replace(/\[([xX])\]/, "[ ]") // uncomplete
```

### DELETE Task

```javascript
content = await app.vault.read(file)
lines = content.split("\n")
lines.splice(task.line, 1)
await app.vault.modify(file, lines.join("\n"))
```

### Recurring Tasks

Pattern: `🔁 every <period>`. When completing a recurring task:
1. Update date to next occurrence
2. Keep checkbox `[ ]` (stays open, advances date)

**Supported periods:** `every day`, `every week`, `every month`, `every 2 weeks`, etc.

---

## 3. CODE BLOCKS

Add these to any markdown note:

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

## 4. SESSIONS (Time Tracking)

Stored as NDJSON in `.obsidian/plugins/flowtime/sessions/YYYY-MM-DD.ndjson`.

### Format

```json
{"type":"session","date":"2026-06-24","start_time":"2026-06-24T09:00:00.000Z","end_time":"2026-06-24T10:30:00.000Z","duration_minutes":90,"bucket":"deep-work","task_text":"Code review","notes":""}
```

Completion records:
```json
{"type":"completion","date":"2026-06-24","bucket":"deep-work","task_text":"Code review","completed_at":"2026-06-24T10:30:00.000Z"}
```

### READ Sessions

```javascript
const sessionDir = app.vault.configDir + "/plugins/flowtime/sessions"
const listing = await app.vault.adapter.list(sessionDir)
const files = listing.files.filter(f => f.endsWith(".ndjson"))

for each file:
  content = await app.vault.adapter.read(file)
  lines = content.split("\n").filter(l => l.trim())
  for each line:
    record = JSON.parse(line)
```

### Filter by Date

Filename contains the date: `path.match(/(\d{4}-\d{2}-\d{2})\.ndjson$/)`

### Get Daily Totals

Group by date + bucket, sum `duration_minutes`.

### Get Weekly Totals

Group daily totals by ISO week (Monday-starting).

---

## 5. COMMON WORKFLOWS

### "Show me what's on my plate today"

1. Determine today: `YYYY-MM-DD`
2. Scan all files for tasks where `taskDate === today` and `status !== "x"`/`"X"`
3. Resolve project name via tag parsing
4. Present grouped by project

### "Add a task to X for tomorrow"

1. Locate project folder note for X, or find the daily note
2. Append: `- [ ] [description] @tomorrow @1h @b:deep-work #project/X`
3. Include duration and bucket if given

### "What tasks are overdue?"

1. Scan for `taskDate < today` and `taskDate !== ""` and `status !== "x"`
2. Present with date, project, and actions (reschedule, backlog, delete)

### "Move all overdue tasks to today"

For each overdue task, replace date with today's date.

### "Show me this week's budget"

1. Determine Monday/Sunday of current ISO week
2. For each bucket, sum `durationMinutes` of tasks with that bucket + date in range
3. Present: name, used hours, limit, remaining

### "I want a new bucket called Design"

1. Create: `id=design`, `name=Design`, `color=#ff6b6b`, `weeklyLimit=15`, `sortOrder=3`
2. Add to `plugin.settings.buckets`, save
