---
name: flowtime-vault
description: Flowtime project and bucket management — full CRUD for projects (folders, folder notes, management/wiki docs) and buckets (time budget categories).
---

# Flowtime Vault — Projects & Buckets

Load `setup.md` first for vault structure, data model, vault API, and agent contract.

---

## 1. PROJECTS

A project is a **folder** containing a **folder note** (same name) with frontmatter, plus dedicated docs for tasks and knowledge.

### Structure

```
Website-Redesign/
  Website-Redesign.md              ← folder note / project home (type: project)
  Website-Redesign Tasks.md        ← task management (flowtime blocks + task lines)
  Website-Redesign Wiki.md         ← knowledge base (specs, decisions, notes)
```

### Folder Note Frontmatter

```markdown
---
type: project
name: Website Redesign
status: active
tags: [project]
---
```

- `type: project` — default marker (configurable in settings)
- `name:` — display name (optional, falls back to folder name)
- Tasks reference a project by location (inside folder) or `#project/Name` tag

### READ Projects

Scan markdown files where **basename matches parent folder name**, check frontmatter for `type: project`:

```
files = app.vault.getMarkdownFiles()
for each file:
  if file.basename != parent_folder_name: skip
  content = await app.vault.read(file)
  parse frontmatter for "type: project"
  if found: this is a project
```

### CREATE Project

1. Create folder: `app.vault.createFolder("ProjectName")`
2. Create folder note from template:
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
   Replace `{{DATE}}` with today (YYYY-MM-DD).

**Plugin command:** `Cmd+P` → "Flowtime: New Project".

### Scaffold Management Doc + Wiki

After creating the project, scaffold two more files:

**Tasks doc** (`ProjectName Tasks.md`):
````markdown
# ProjectName — Tasks

   ## 🎯 Milestones @ms

```flowtime-project
```

- [ ] Define scope 🔺 @{{DATE}} @1h
- [ ] First milestone @{{DATE}}
- [ ] Daily check-in 🔁 every day @{{DATE}} @15m

## 📋 Backlog

- [ ] Future improvement
- [ ] Long-term goal
````

**Wiki doc** (`ProjectName Wiki.md`):
```markdown
# ProjectName — Wiki

## Overview

## Architecture

## Decisions

## Reference Links

## Meeting Notes
```

### DELETE Project

1. Delete folder note: `app.vault.delete(folderNoteFile)`
2. Delete folder: `await app.vault.delete(folder, true)` (recursive)

**WARNING:** Destructive — confirm with user first.

### UPDATE Project

- **Rename:** Not directly supported. Move folder + update folder note.
- **Display name:** Edit `name:` in frontmatter.
- **Status:** Edit `status:` (`active`, `archived`, `completed`).

---

## 2. BUCKETS (Time Budgets)

Time-budget categories with weekly limits. Canonical source is `Flowtime/Buckets.md` (v1.7.0+) — a markdown file with YAML frontmatter that agents can read and write directly.

### Default Buckets

| id | name | color | weeklyLimit |
|----|------|-------|-------------|
| deep-work | Deep Work | #4a9eff | 20h |
| admin | Admin | #a8a8a8 | 5h |
| meetings | Meetings | #e6a700 | 5h |

### Canonical File: Flowtime/Buckets.md (v1.7.0+)

Bucket definitions live in a markdown file at vault root:

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
```

The plugin reads this file on startup and loads the `buckets` array from the YAML frontmatter. Settings UI edits sync back to this file. Agents write YAML frontmatter — no Obsidian API needed.

### READ Buckets

**Inside Obsidian (plugin API):**
```javascript
plugin.settings.buckets
// Returns: [{ id, name, color, weeklyLimit, sortOrder }, ...]
```

**Headless / agent context:**
```javascript
// Read Flowtime/Buckets.md and parse YAML frontmatter
const fs = require("fs")
const content = fs.readFileSync("Flowtime/Buckets.md", "utf-8")
// Extract between --- markers, parse the buckets: array
```

### CREATE Bucket

**Inside Obsidian:**
```javascript
plugin.settings.buckets.push({
  id: "new-bucket-id",        // lowercase, hyphenated, auto-from-name
  name: "New Bucket",
  color: "#4a9eff",
  weeklyLimit: 10,
  sortOrder: plugin.settings.buckets.length,
});
await plugin.saveData(plugin.settings);
// Also writes Flowtime/Buckets.md automatically
```

**Plugin command:** `Cmd+P` → "Flowtime: Add Bucket".

**Headless / agent context:**
Edit the YAML frontmatter in `Flowtime/Buckets.md`:
```yaml
buckets:
  - id: deep-work
    ...
  - id: new-bucket-id
    name: New Bucket
    color: "#4a9eff"
    weeklyLimit: 10
    sortOrder: 3
```
Then notify user: "Reload Obsidian to pick up changes"

**Naming:** `name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")`

### UPDATE Bucket

**Inside Obsidian:**
```javascript
const bucket = plugin.settings.buckets.find(b => b.id === "deep-work");
if (bucket) {
  bucket.name = "Deep Focus Work";
  bucket.weeklyLimit = 25;
  await plugin.saveData(plugin.settings);
}
```

**Headless / agent context:**
Edit the YAML entry in `Flowtime/Buckets.md` directly.

### DELETE Bucket

**Inside Obsidian:**
```javascript
plugin.settings.buckets = plugin.settings.buckets.filter(b => b.id !== "deep-work");
await plugin.saveData(plugin.settings);
```

**Headless / agent context:**
Remove the YAML entry from `Flowtime/Buckets.md`.

### Assigning Tasks to Buckets

```
- [ ] Code review @today @1h @b:deep-work
- [ ] Standup @today @15m @bucket:meetings
```
