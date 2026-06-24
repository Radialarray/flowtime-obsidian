# Flowtime Plugin v0.3.0 — Improvement Roadmap

> Target: v0.3.0 — breaking changes (new syntax, new data model).
> Derived from gap analysis against current implementation (v0.2.0).
> All sprints 1–6 closed. This document charts the next horizon.
> Decisions from plan_v2_review.md integrated.

---

## Current State (v0.2.0)

Everything from the original plan is implemented:
- 5 code block views (today / overdue / dueweek / weekly / project)
- Project detection engine (frontmatter + folder fallback + tag)
- Quick entry modal with natural date parsing
- Per-row inline timer + status bar timer (sync'd)
- Recurrence, priority, checkbox toggle
- Templates (daily/weekly/project) with settings overrides
- Onboard migration script

---

## Architectural Decisions

### Feature Delivery Order

```
Buckets (B1–B4) ──► Sessions (S1–S4) ──► Views Light (V4+V6) ──► Views Full (V1–V3+V5)
```

Each phase depends on the previous. Buckets first because Sessions analytics need bucket data.

### New Task Line Syntax (breaking change)

No backward compat with v0.2.0 emoji syntax. New `@`-prefix format:

| Concept | Old (emoji) | New (@-prefix) |
|---------|-------------|----------------|
| Scheduled date | `⏳ 2026-06-24` | `@today`, `@next-monday`, `@2026-06-24` |
| Due date | `📅 2026-06-28` | `@due:tomorrow`, `@due:2026-06-28` |
| Recurrence | `🔁 every week` | `@every-week`, `@every-2-weeks` |
| Start time | `09:00—11:30` (time block) | `@9:15` (colon = time of day) |
| Duration | `⏳ 30m` | `@1.5h`, `@30m` (unit = time length) |
| Bucket | `#budget/deep-work` | `@bucket:deep-work` or `@b:deep-work` |
| Project | `#project/website` | `@project:my-app` or `@p:my-app` |
| Priority | `🔺⏫🔼🔽⏬` | Removed |

Parsing rule: `@<value>` where:
- Contains colon (no "due") → start time (e.g. `@9:15`)
- Ends in `h` or `m` → duration (e.g. `@1.5h`, `@30m`)
- Starts with "every-" → recurrence (e.g. `@every-week`)
- Starts with "due:" → due date (e.g. `@due:tomorrow`)
- Starts with "bucket:" or "b:" → bucket (e.g. `@bucket:deep-work`)
- Starts with "project:" or "p:" → project (e.g. `@p:website`)
- Otherwise → scheduled date (e.g. `@today`, `@2026-06-24`)

**3-state color system**: Normal (0–79%) neutral, Warning (80–99%) amber, Over (100%+) red. Hardcoded thresholds, documented rationale.

**Progress bars**: JS computes ratio + state class, CSS renders. Text overlay "14.2h / 20h" for accessibility.

---

## ⚡ Quick Win Polish (small effort, high UX signal)

| # | Gap | Target | Status |
|---|-----|--------|--------|
| **Q1** | Empty states lack CTAs | Add "Add a task" / "Create bucket" buttons | Open |
| **Q2** | No reset-to-default buttons on template settings | Add small reset link next to each textarea | Open |
| **Q3** | Status timer code still in main.js | Extract into `src/status-timer.js` as a class. Wires into plugin onload. | Open |
| **Q4** | Duration not written to task line on quick-add | Write `@<duration>` to task line | Open |
| **Q5** | No `/add-task` slash command | Add Obsidian editor suggester for `/add-task` | Open |
| **Q6** | No task-parser.js module (plan.md §2.1) | Extract from renderer.js into `src/task-parser.js`. Needed for Views pipeline. | Open |

---

## 🪣 Buckets System — Time Budget Categories

Buckets are time-constrained categories (e.g., "Deep Work — 20hrs/week", "Admin — 5hrs/week").
Every task MUST belong to a bucket. Projects remain orthogonal (logical groupings).

**Default bucket prefix**: `budget/` (configurable in settings).

**Data storage**: Bucket definitions in plugin `data.json`. Tasks store bucket via `@bucket:<name>` or `@b:<name>`.

**Migrating old tasks**: On first v2 load, prompt user to pick or create a default bucket. Tasks without `@bucket:` directive auto-tagged.

| # | Feature | Description |
|---|---------|-------------|
| **B1** | **Bucket CRUD** | Create/edit/delete buckets via settings tab or modal. Each bucket has: name, emoji/color, weekly limit (hours, > 0), sort order. Validate > 0 on create/edit. |
| **B2** | **Bucket assignment** | Quick entry + table column to assign/change bucket per task. Saves as `@bucket:<name>`. Bidirectional quick entry: text field is source of truth, helper fields write `@directives` into text. |
| **B3** | **Weekly limit tracking** | Track total time scheduled per bucket this week (sum of `@<duration>` on tasks for this week). Show remaining budget in bucket column. Exceeding limit warns via 3-state color. Week rollover resets naturally. |
| **B4** | **Daily budget cap** | Default 12h/day cap on total scheduled time. Inline indicator in today view — uses 3-state color system on the daily cap summary row. |

### Bucket Default Templates

Daily and weekly dashboard templates include a bucket-summary section (e.g., `flowtime-buckets` code block).

---

## 📊 Progress Bars + 3-State Color System

| # | Feature | Description |
|---|---------|-------------|
| **P1** | **3-state color scheme** | Normal (0–79%) → neutral, Warning (80–99%) → amber, Over (100%+) → red. Hardcoded thresholds, documented. |
| **P2** | **Progress bar component** | Visual bar showing used/remaining for any budget (bucket weekly limit, daily cap). JS compute + CSS render. Text overlay "14.2h / 20h" for accessibility. |
| **P3** | **Timer budget bar** | Timer display shows progress bar toward duration, colored by state |
| **P4** | **Budget bar in bucket overview** | New view or section showing all buckets with their progress bars |

---

## 💾 Session Persistence & Analytics

Currently the timer is 100% ephemeral — sessions vanish on Obsidian restart.

**Storage format**: `flowtime/sessions/<date>.ndjson` (append-only NDJSON). One JSON object per line. Survives uninstall, syncs via Obsidian Sync.

**Cross-device**: NDJSON append avoids file rewrite conflicts. Conflicted copies merge line-by-line.

**Tracking scope**: Per bucket, per session, per day, per week. Not per task — task renames/moves are irrelevant.

| # | Feature | Description |
|---|---------|-------------|
| **S1** | **Session storage** | Write session record on timer stop/expiry: `{"type":"session","date":"...","start_time":"...","end_time":"...","duration_minutes":N,"bucket":"...","task_text":"...","notes":""}` |
| **S2** | **Completion tracking** | Write completion record on checkbox toggle to `[x]`: `{"type":"completion","date":"...","bucket":"...","task_text":"...","completed_at":"..."}` |
| **S3** | **Session history view** | New code block or modal to browse past sessions with date/bucket filters |
| **S4** | **Time analytics** | Derived metrics: time-by-bucket (per day, per week), daily streaks, weekly totals vs limits. Last N completions queryable. |
| **S5** | **Cross-device visibility** | Sessions stored in vault = sync via Obsidian Sync. No extra infra needed |

---

## 🔍 "Views Are Lenses" Pattern

**Split into two phases:**

### Views Light (ships sooner)

| # | Feature | Description |
|---|---------|-------------|
| **V4** | **Configurable columns** | Choose which fields/columns are visible per view |
| **V6** | **Backward compat** | Existing `flowtime-*` code blocks map to built-in default views |

### Views Full (after Buckets + Sessions data model finalized)

| # | Feature | Description |
|---|---------|-------------|
| **V1** | **Custom filter system** | Recursive AND/OR filter tree on any field (date, bucket, project, status) |
| **V2** | **Multi-column sort** | Sort by multiple columns with priority |
| **V3** | **Grouping** | Two-level grouping (e.g., group by bucket, sub-group by status) |
| **V5** | **Persist views** | Save named view configurations, re-use across notes |

If a view filter references a deleted bucket, show a warning but render the view.

---

## Architecture Changes

### Module Structure (updated)

```
main.js               — Plugin entry, registration, settings tab
src/
  project-engine.js   — Folder traversal, frontmatter parsing, project resolution
  task-parser.js      — Parse task lines, extract @directives (NEW — extracted from renderer)
  date-parser.js      — Natural language → YYYY-MM-DD
  quick-entry.js      — Modal for task capture, bidirectional @directive editing
  status-timer.js     — Status bar timer, single-instance, pause/resume (EXTRACTED from main)
  session-store.js    — NDJSON read/write/query for sessions + completions (NEW)
  budget-state.js     — 3-state computation, weekly limit math, daily cap check (NEW)
  cache.js            — Persistent task cache, incremental invalidation (NEW)
  renderer.js         — Table rendering, row building, progress bars
  template-engine.js  — Load, render, insert templates
  settings.js         — Settings defaults + tab (extended for buckets, session config)
  onboard.js          — Migration prompt on first v2 load
styles.css            — All styles
manifest.json         — v0.3.0
```

### Persistent Task Cache

- In-memory `Map<filePath, TaskLine[]>` on plugin instance
- Written to cache file in plugin data directory (survives restart)
- Invalidation: file save/modify → re-parse that file, Flowtime actions (quick entry, timer complete, task toggle) → re-parse affected file(s)
- On render → read from cache, no vault scan

### Two-Tier Testing

| Tier | Tool | Scope | Speed |
|------|------|-------|-------|
| Unit | `bun test` | Pure-logic modules: task-parser, date-parser, session-store, budget-state, cache | ~0.2s |
| Integration | `obsidian eval` (test.sh) | Plugin load, commands, settings, renderer, Obsidian API paths | Needs Obsidian running |

---

## Implementation Order

### Phase 0: Quick Wins
Q1–Q6. Knock out in one session. Includes extraction of status-timer.js + task-parser.js.

### Phase 1: Buckets + Budget Bars
B1–B4, P1–P4. New syntax ships here. Includes bucket CRUD, assignment, weekly/daily limit tracking, progress bars, default template updates.

### Phase 2: Session Persistence
S1–S5. NDJSON storage, timer → session hook, completion tracking, history view, analytics.

### Phase 3: Views Light
V4, V6. Column visibility, backward compat.

### Phase 4: Views Full
V1–V3, V5. Filters, multi-sort, grouping, persist views.

---

## Implementation Notes

- **Buckets use @-prefix syntax**: `@bucket:deep-work` — consistent with other task directives
- **Bucket prefix**: `budget/` default (configurable). Documented as reserved namespace.
- **Sessions stored as NDJSON in `flowtime/sessions/`**: survives plugin removal, syncs via Obsidian Sync
- **Progress bars**: JS compute + CSS render. Text labels for accessibility.
- **Existing views become presets**: each `flowtime-*` code block maps to a built-in lens config
- **No backward compat with v0.2.0 emoji syntax**: v0.3.0 uses new `@`-prefix format only
- **Migration**: Prompt on first v2 load to assign default bucket to unassigned tasks
- **Plugin data is ephemeral**: bucket config in `data.json`, lost on uninstall. Session files persist.
- **Desktop-first**: mobile is best-effort without sound (AudioContext beep unreliable on iOS)
- **Performance**: test vault to benchmark render speed at realistic volumes. Address issues if they arise.

## Effort vs. Impact Matrix

```
                  High Impact
                      │
    Session Persist   │   Buckets + Budget Bars
          ●           │        ●
                      │
                      │
 ──────── Low Effort ─┼──────── High Effort ──────
                      │
   Empty State CTAs ● │   "Views Are Lenses"
   Reset-to-default ● │        ●
   Status timer mod ● │
   Write duration  ●  │
   Slash command   ●  │
   task-parser.js  ●  │
                      │
                  Low Impact
```
