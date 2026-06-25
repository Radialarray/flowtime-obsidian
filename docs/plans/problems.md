# Flowtime — Problems & Improvements

> Friction points, bugs, and onboarding improvements discovered during a fresh vault setup.
> Date: 2026-06-24 | Flowtime v0.4.0

---

## 1. Onboarding — No "Clean Setup" Workflow

**Problem:** Setting up a fresh Flowtime workspace requires manual steps across 4 different locations:
- Create `Dashboard.md` with flowtime code blocks
- Edit `data.json` to configure buckets + projectsRoot
- Edit `.obsidian/daily-notes.json` to set daily note folder
- Manually scaffold project folders with 3 files each

**The `Cmd+P` → "Onboard" command only handles old date format migration**, not full workspace setup.

**Improvement:** Add a multi-step onboarding wizard:

1. **Step 1: Workspace Layout** — Show the user the recommended vault structure and let them choose:
   - **Flat layout:** Projects at vault root (`/ProjectA`, `/ProjectB`, ...)
   - **Nested layout:** Projects in a folder (`/Projects/ProjectA`, `/Projects/ProjectB`, ...)
   - Set `projectsRoot` accordingly
   
2. **Step 2: Dashboard Templates** — Offer dashboard presets:
   - **Daily dashboard** (`Dashboard.md`): overdue + today + due this week
   - **Weekly/full dashboard** (`Dashboard Weekly.md`): + weekly view + budget + sessions
   - Scaffold both files with the selected code blocks already in place
   - Dashboards get created at vault root

3. **Step 3: Buckets** — Pick from presets or configure custom:
   - Preset: deep-work, admin, meetings (with reasonable limits)
   - Or let user define their own

4. **Step 4: Daily Notes** — Set folder (default `Daily/`), update `daily-notes.json`

5. **Step 5: First Project** — Optionally scaffold a first project with all 3 files

Also: Add `Cmd+P` → "Flowtime: Reset to Defaults" to clear all settings + `_taskCache`.

### Dashboard Templates — What a Solid Default Looks Like

The onboarding should scaffold these as real files, not just explain them:

**Dashboard.md (daily):**
````markdown
# Dashboard — Today

## 🔄 Carry Over
```flowtime-overdue
```

## 🎯 Today
```flowtime-today
```

## ⚠️ Due This Week
```flowtime-dueweek
```
````

**Dashboard Weekly.md (full):**
````markdown
# Dashboard — Weekly

## 🔄 Carry Over
```flowtime-overdue
```

## 🎯 Today
```flowtime-today
```

## ⚠️ Due This Week
```flowtime-dueweek
```

## 📊 This Week (by project)
```flowtime-weekly
```

## 📊 Budget Overview
```flowtime-buckets
```

## 📋 Session History
```flowtime-sessions
```
````

These should be created automatically during onboarding, not manually by the user.

### Workspace Layout — Must Be Clear in Skill + Onboarding

The skill.md and the onboarding wizard should both document the **canonical vault layout** prominently:

```
vault/
├── Dashboard.md              ← Daily overview (overdue + today + dueweek)
├── Dashboard Weekly.md       ← Weekly overview (+ weekly + budget + sessions)
├── Daily/                    ← Daily notes (YYYY-MM-DD.md)
├── Projects/                 ← All projects (if nested layout)
│   ├── ProjectA/
│   │   ├── ProjectA.md       ← Folder note (type: project)
│   │   ├── ProjectA Tasks.md ← Task management
│   │   └── ProjectA Wiki.md  ← Knowledge base
│   ├── ProjectB/
│   └── ...
├── flowtime/
│   └── sessions/             ← Session NDJSON files
├── Craft/                    ← Existing content (not Flowtime-managed)
├── Notion/                   ← Existing content (not Flowtime-managed)
└── .obsidian/                ← Core config
```

Key layout rules to document:
- Vault root should have **2-3 user-facing files** (dashboards) + `Daily/` + `Projects/`
- Everything else (Craft, Notion, .obsidian) is infrastructure
- `flowtime/sessions/` is auto-managed, not user-facing
- Projects go either at root or under `Projects/` — **pick one, stick to it**

---

## 2. `_taskCache` Bloat & Staleness

**Problem:** The `_taskCache` in `data.json` grew to **91K+ lines (1.5MB+)** from scanning all vault files. When the user deletes files or restructures the vault, the cache becomes stale but never gets cleaned up.

This causes:
- Massive `data.json` file (slow to save/load)
- Stale entries referencing deleted files → potential errors when plugin tries to read them
- No way to clear/rebuild cache from outside Obsidian
- When `projectsRoot` changes, old cache paths are invalid

**Improvement:**
- Store `_taskCache` in a **separate file** (`task-cache.json` or `.flowtime-cache.json`) so `data.json` stays lean
- Add **auto-eviction**: when plugin loads, validate cache entries against existing files, remove stale ones
- Add **CLI command** to force cache rebuild (helpful for agent-based vault management)
- Add **safety limit**: warn if cache exceeds 5000 entries or 1MB
- When `projectsRoot` changes, **clear the entire cache** and rebuild on next render

---

## 3. No CLI / External API for Plugin Config

**Problem:** Agents and scripts can't configure Flowtime without directly editing `data.json`. This is fragile:
- No validation when writing JSON
- No way to trigger re-index after changes
- No way to check if a bucket name is valid before writing
- Easy to corrupt the file

**Improvement:** Consider one of:
- **Obsidian CLI plugin commands:** Expose `flowtime:configure-buckets`, `flowtime:set-projects-root`, `flowtime:rebuild-cache` as Obsidian commands that can be triggered via `obsidian-cli`
- **Dataview-style query API:** Read tasks/projects/buckets via a queryable API
- At minimum: **validate `data.json` on load** and report errors gracefully instead of crashing

---

## 4. `projectsRoot` — Behavior & Discovery

**Problem:** Setting `projectsRoot: "Projects"` changes where the plugin looks for folder notes, but:
- The `Cmd+P` → "New Project" command creates folders at `projectsRoot` — good
- But the `_taskCache` still references old paths = stale
- The `#project/` tag prefix in tasks still works but may resolve to wrong folder
- No visual indicator in the UI showing which root is active
- If user moves projects into the root folder, cache doesn't update

**Improvement:**
- When `projectsRoot` changes: **show a notice** "Projects root changed — rebuild task cache? [Yes/No]"
- Add **projectsRoot** display in the plugin settings tab (currently it's just in raw JSON)
- When scanning for projects, **validate folder notes actually exist** in the current root

---

## 5. Session Directory Auto-Creation

**Problem:** When `flowtime/sessions/` is deleted (e.g., during a clean slate), the plugin doesn't auto-create the directory. Starting a timer would silently fail or error.

**Improvement:**
- On plugin load, call `app.vault.adapter.exists("flowtime/sessions")` and create if missing
- Or: make the session directory configurable in settings (so users can put it in `Daily/` or elsewhere)
- Log a warning if sessions can't be written

**Related:** The `flowtime/sessions/` directory location should respect `projectsRoot`. If `projectsRoot` is `"Projects"`, should sessions be at `flowtime/sessions/` or `Projects/flowtime/sessions/`? Currently hardcoded to vault root.

---

## 6. "New Project" Should Scaffold All 3 Files

**Problem:** `Cmd+P` → "Flowtime: New Project" creates only the folder note. The Tasks.md and Wiki.md must be created manually. New users don't know this convention exists.

**Improvement:** Add an option in the New Project dialog:
- ☐ Create Tasks.md (with `flowtime-project` block + starter tasks)
- ☐ Create Wiki.md (with template sections)
- Default: both checked

Also: The project template in `data.json` only defines the folder note. Add separate template fields for Tasks and Wiki docs.

---

## 7. Bucket Configuration — No Bulk Management

**Problem:**
- Only "Add Bucket" command exists (single bucket at a time)
- No "Edit Bucket" or "Delete Bucket" from command palette
- Bucket colors and limits are hard to tune without editing JSON directly
- No way to set bucket sort order from the UI

**Improvement:**
- Add a **Bucket Manager** view (settings tab or modal) with:
  - List all buckets with color, limit, sort order
  - Inline editing of name/color/limit
  - Drag to reorder
  - Delete with confirmation
- Or at minimum: add "Flowtime: Configure Buckets" command that opens a settings modal

---

## 8. Daily Notes Integration

**Problem:** Flowtime uses `dailyTemplate` in settings, but the actual daily notes folder is configured in `.obsidian/daily-notes.json` (core Obsidian setting). These can get out of sync.

**Example from onboarding:** The old `daily-notes.json` had `folder: "Base/Base/Daily"` which no longer existed after cleanup. Flowtime's `quickEntryTargetFile: "daily-note"` would try to create notes in a non-existent folder.

**Improvement:**
- On plugin load, check if `daily-notes.json` folder exists. If not, suggest fixing it or auto-create it.
- Add a setting in Flowtime settings: "Daily notes folder" that syncs with core daily-notes config
- When user changes dailyTemplate, offer to write the template to the daily notes template file

---

## 9. Skill.md Gaps (for Agent-Based Management)

**Problem:** The skill.md at `~/.config/opencode/skills/flowtime/SKILL.md` and the repo's `skill.md` assume the agent has access to `app.vault` APIs (inside Obsidian). When agents operate from the CLI, they need different instructions.

**Gaps:**
- No section on "Operating from Outside Obsidian" (direct file editing)
- No mention of how to safely clear `_taskCache`
- No `data.json` structure reference for manual editing
- No troubleshooting section for stale caches
- No guidance on what `.obsidian/` files to update (daily-notes.json, community-plugins.json)
- No mention that `.obsidian/plugins/flowtime/data.json` is the canonical settings file

---

## 10. Minor Issues

### 10.1 Empty `_taskCache` entries waste space
Many entries in `_taskCache` are empty arrays (`"path/to/file.md": []`). These accumulate for every file that doesn't contain tasks. Over 90% of the cache might be empty entries.

**Fix:** Only store entries for files that actually contain tasks. Or better, use a lazy-loading approach instead of pre-caching everything.

### 10.2 Task status parsing edge case
The skill's `parseTaskLine()` uses `status` field: `" "` for open, `"x"` for done. But in the actual `_taskCache`, completed tasks have `status: "x"` while open have `status: ""` (empty string). The "space" case (`" "`) doesn't appear in practice. This could confuse agents.

### 10.3 `@due:` syntax vs `@date` syntax
The test vault had tasks using both `@2026-06-24` and `@due:tomorrow`. The skill only documents `@date` syntax. The `@due:` prefix appears in the `_taskCache` but isn't documented.

### 10.4 `projectTemplate` creates noise tasks — don't scaffold fake tasks
**Problem:** The default `projectTemplate` in `data.json` includes placeholder tasks:
```
- [ ] Define scope 🔺 @{{DATE}}
- [ ] First milestone @{{DATE}}
- [ ] Daily check-in 🔁 every day @{{DATE}}
```
These are **fake tasks with no actual content** that immediately clutter Flowtime tables. Every new project generates 3 noisy rows. Users have to manually delete them.

**Fix:** Remove placeholder tasks from the default template entirely. If examples are wanted, use HTML comments or a separate `_examples.md` file. The template should only contain the `flowtime-project` code block and structure — no executable tasks.

### 10.5 `_taskCache` scans entire vault — should respect folder scope
**Problem:** `_taskCache` ignores `projectsRoot` and scans every markdown file in the entire vault. This means:
- Tasks from `Notion/`, `Craft/`, and other non-Flowtime folders appear in project views
- Cache is bloated with irrelevant entries (94K lines in our case)
- No way to tell the plugin "only scan these folders"

**Fix:** Make `_taskCache` respect `projectsRoot` — only scan files inside the projects root folder (or the entire vault if `projectsRoot` is empty). Better yet, add a `scanFolders` setting (array of glob patterns or folder paths) so users can explicitly say which folders Flowtime should track.

### 10.4 Session NDJSON format not validated
When sessions are written, there's no validation of the JSON structure. Corrupted session files could crash the plugin.

---

## Summary — Priority Order

| Priority | Issue | Impact |
|----------|-------|--------|
| 🔴 High | `_taskCache` bloat (91K lines) | Performance, file size, stale data |
| 🔴 High | No onboarding wizard | High barrier for new users |
| 🔴 High | Session dir not auto-created | Silent timer failures |
| 🟡 Medium | New Project doesn't scaffold all files | Missed adoption of 3-file pattern |
| 🟡 Medium | No bucket management UI | Hard to configure |
| 🟡 Medium | Daily notes config out of sync | Broken quick entry |
| 🟡 Medium | No external API/CLI | Can't automate from agents |
| 🟡 Medium | `projectTemplate` creates fake noise tasks | Cluttered tables, manual cleanup |
| 🟡 Medium | `_taskCache` ignores `projectsRoot` scope | Bleed from unrelated folders |
| 🟢 Low | Skill.md gaps | Agent confusion |
| 🟢 Low | Empty cache entries | Wasted space |
| 🟢 Low | `@due:` syntax undocumented | Confusion |
