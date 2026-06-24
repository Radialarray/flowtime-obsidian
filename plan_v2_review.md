# Plan v2 — Review: Issues & Gaps

> Generated from reading plan_v2.md, plan.md, main.js, renderer.js, quick-entry.js, settings.js, and all open beads.
> Decisions recorded during walkthrough on 2026-06-24.

---

## 1. Dependency Ordering Problems

### 1.1 Sessions before Buckets contradicts itself

**Decision: Flip it.** Buckets (B1–B4) first, then Sessions (S1–S4). S3 time-by-bucket analytics lands naturally after bucket assignment exists.

### 1.2 Daily budget cap (B4) underspecified

Does it track *scheduled* time or *actual* time?

**Decision: Scheduled time only.** Sum of `@<duration>` values on tasks date-assigned to today. Ships with Buckets epic, no Sessions dependency.

### 1.3 "Views Are Lenses" has hard dependencies not called out

V1 (filters), V3 (grouping), V5 (persist view config) all depend on finalized data model.

**Decision: Split Views into two:**
- **Views Light** (V4 + V6) — column visibility config + backward compat for existing `flowtime-*` code blocks. Ships earlier.
- **Views Full** (V1–V3 + V5) — waits until Buckets + Sessions data model is finalized.

---

## 2. Concrete Technical Gaps

### 2.1 No session storage format decision (S1)

**Decision: Sessions directory.** `flowtime/sessions/` directory. One file per day. Clean separation, survives uninstall, syncs via Obsidian Sync.

### 2.2 Session analytics (S3) is a placeholder

**Decision: Track per bucket, per session, per day, per week.** Not per task. Session record is `{ date, bucket, duration, startTime, endTime, task_text?, notes? }`. Task renames/moves/deletions are irrelevant.

**Completion tracking:** Track done task count per day. Last N completions queryable.

**Formal session storage schema:**

```
flowtime/sessions/2026-06-24.ndjson
flowtime/sessions/2026-06-25.ndjson
...
```

**Session record** (written on timer stop/expiry):
```json
{"type":"session","date":"2026-06-24","start_time":"2026-06-24T09:15:00Z","end_time":"2026-06-24T09:45:00Z","duration_minutes":30,"bucket":"deep-work","task_text":"Write API spec","notes":""}
```

**Completion record** (written on checkbox toggle to `[x]`):
```json
{"type":"completion","date":"2026-06-24","bucket":"deep-work","task_text":"Write API spec","completed_at":"2026-06-24T09:45:00Z"}
```

NDJSON format (append-only, one JSON object per line). Supports cross-device sync — conflicted copies merge line-by-line.

Derived metrics:
- Per bucket per day: sum `duration_minutes` across sessions
- Per week: sum across days, compare against weekly limit
- Last N completions: query `type: "completion"` by `completed_at`

### 2.3 Progress bars (P2) need more than "pure CSS"

**Decision: JS compute + CSS style.** JS computes ratio and sets inline width + state class. CSS handles visual rendering and color transitions. No library needed.

### 2.4 3-state thresholds (P1) are magic numbers

0–79% / 80–99% / 100%+ hardcoded.

**Decision: Keep hardcoded for now.** Document rationale in code and plan. Revisit if threshold fatigue arises.

### 2.5 No task-parser.js module

plan.md §2.1 specified `src/task-parser.js`. Never extracted. Parsing lives inline in `renderer.js` `loadTasks()`.

**Decision: Add to Quick Wins.** Extract task-parser.js alongside Q3 (status-timer extraction). Needed for Views filter/sort/group pipeline.

---

## 3. Architecture Risks

### 3.1 Tag collision for buckets (B2)

`#bucket/` prefix risked collision with user tags.

**Decision: Use `budget/` as default prefix.** Collision risk documented as known limitation. User-configurable in settings. Accept and document approach.

### 3.2 Vault scan performance

`renderer.js` reads every `.md` file and regexes every line per render. Scales poorly.

**Decision: Incremental parsing + persistent task cache.**
- In-memory `Map<filePath, TaskLine[]>` on plugin instance
- Written to a cache file in plugin data directory (survives restart)
- Invalidation: file save/modify → re-parse that file, Flowtime actions → re-parse affected file(s)
- On render → read from cache, no vault scan

### 3.3 Task line bloat

Old format hit ~140 chars with emojis and `#project/`, `#budget/` prefixes.

**Decision: New compact task syntax.** No backward compat with emoji syntax.

| Concept | Old (emoji) | New (@-prefix) |
|---------|-------------|----------------|
| Scheduled date | `⏳ 2026-06-24` | `@today`, `@next-monday`, `@2026-06-24` |
| Due date | `📅 2026-06-28` | `@due:tomorrow`, `@due:2026-06-28` |
| Recurrence | `🔁 every week` | `@every-week`, `@every-2-weeks` |
| Start time | `09:00—11:30` (time block) | `@9:15` (colon = time of day) |
| Duration | `⏳ 30m` | `@1.5h`, `@30m` (unit = time length) |
| Bucket | `#budget/deep-work` | `@bucket:deep-work` or `@b:deep-work` |
| Project | `#project/website` | `@project:my-app` or `@p:my-app` |
| Priority | `🔺⏫🔼🔽⏬` | Removed for now |

Parsing rule: `@<value>` where value contains colon without "due" = start time, ends in `h`/`m` = duration, starts with "every-" = recurrence, starts with "due:" = due date, starts with "bucket:" or "b:" = bucket, starts with "project:" or "p:" = project, otherwise = scheduled date.

**Quick entry UX:** Single text field as source of truth. Extra fields (date, bucket, project, duration, recurrence) are helpers — changing a helper writes the `@directive` into the text. Editing the text re-parses and updates helpers. Bidirectional.

### 3.4 Cross-device conflict (S4)

Concurrent timers on two devices could collide writing to the same day's session file.

**Decision: NDJSON append-only log.** Each session/completion appends a JSON line to the day's `.ndjson` file. No file rewrite. Conflicted copies merge line-by-line. Accepts rare conflicts as manual merge.

---

## 4. Missing Features

### 4.1 No migration path for existing tasks

B2 says "Every task MUST belong to a bucket." Current users have tasks without `@bucket:` or `@b:` directive.

**Decision: Prompt on first v2 load.** User picks or creates a default bucket. Unassigned tasks auto-tagged `@bucket:<default>`. One-time migration.

### 4.2 No uninstall handling

Bucket config in plugin `data.json` lost on uninstall. Session files in `flowtime/sessions/` survive.

**Decision: Accept for now.** No export feature. Plugin data treated as ephemeral.

### 4.3 No testing strategy

Current setup: `test.html` is dead DOM markup. `test.sh` runs `obsidian eval` integration tests (needs running Obsidian). No unit tests outside Obsidian.

**Decision: Two-tier test setup.**
- **Unit tests (Bun):** Pure-logic modules tested via `bun test` — fast, no Obsidian needed. Covers task-parser, date-parser, session-store, budget-state, cache, any module that doesn't reference `obsidian` require.
- **Integration tests (shell):** Keep `test.sh` with `obsidian eval` for things that touch Obsidian APIs — plugin load, commands, settings tab, renderer.

**Setup:**
- `bun` as dev dependency (already available globally: v1.3.14)
- Tests in `test/unit/<module>.test.js`
- Script: `bun test test/unit`
- Dead `test.html` removed or replaced with actual unit test entry

---

## 5. Specific Plan Document Issues

### 5.1 Q3 notes timer code never moved, omits task-parser.js

**Decision: Accept as done.** task-parser.js extraction added to Quick Wins alongside Q3.

### 5.2 Effort matrix — status timer mod labeled low/low but is an enabler

**Decision: Accept as done.** Matrix position moot since extraction happens anyway in Quick Wins.

### 5.3 Rec order contradicts effort matrix

**Decision: Resolved by flip.** Buckets first resolves the contradiction.

### 5.4 Implementation Notes too thin (5 bullets for 21 features)

**Decision: Accept as addressed.** Decisions from this review serve as the missing detail for each area.

### 5.5 No version target

**Decision: v0.3.0.** Breaking changes (new syntax, new data model) warrant a minor version bump.

---

## 6. Cross-Feature Integration Gaps

### 6.1 Timer completion → Session recording

No event system. Timer logic in main.js closure.

**Decision: Accept as addressed by Quick Wins.** Extracting status-timer.js creates a natural hook point for session recording.

### 6.2 Template engine + Buckets

Templates don't include bucket information.

**Decision: Default templates include a bucket-summary section.** Daily/weekly dashboard templates include bucket overview (e.g., `flowtime-buckets` code block). Ships with Buckets epic.

### 6.3 Daily cap (B4) + Running timer

How to warn when running timer breaches daily cap?

**Decision: Inline indicator.** Daily cap summary row in the table uses the 3-state color system — neutral, amber (approaching), red (breached). No separate notification.

### 6.4 Views + Bucket absence

View filter referencing a deleted bucket.

**Decision: Warning.** View shows a warning but still renders. Silent skip would hide data loss.

---

## 7. Edge Cases Not Handled

### 7.1 Bucket with 0 or negative weekly limit

**Decision: Prevent on CRUD.** Validate > 0 on create/edit.

### 7.2 Week rollover

**Decision: Natural reset.** Weekly limit resets. Old session data remains queryable but doesn't count toward current limit.

### 7.3 Timer race condition

**Decision: Accept for now.** Extremely unlikely. Can add mutex guard if reproduced.

### 7.4 10,000+ file vault

**Decision: Already covered by persistent task cache + incremental parsing (3.2).** Accept as done.

### 7.5 Mobile Obsidian — AudioContext beep broken on iOS

**Decision: Desktop-first.** Mobile works without sound. No fallback needed.

### 7.6 User deletes daily note containing session data

**Decision: Moot.** Sessions stored in `flowtime/sessions/` directory, not in daily notes. ✅

### 7.7 Plugin uninstall — bucket config lost

**Decision: Accepted in 4.2.** ✅

---

## 8. Performance & Accessibility

### 8.1 Performance budget

**Decision: No hard number.** Create a test vault at some point to benchmark render performance with realistic data volumes. Address issues if they arise.

### 8.2 Accessibility

**Decision: Add text labels to progress bars.** Overlay text like "14.2h / 20h" on each progress bar. Colors supplemented by text, not relied upon exclusively.

---

## 9. Priority Summary (Final)

| Priority | Item | Status |
|----------|------|--------|
| **P0** | Session storage format | ✅ `flowtime/sessions/` NDJSON |
| **P0** | Feature ordering (dependency graph) | ✅ Buckets → Sessions → Views Full |
| **P1** | B4 scope (scheduled vs actual) | ✅ Scheduled time only |
| **P1** | task-parser.js extraction | ✅ Added to Quick Wins |
| **P1** | Task line syntax redesign | ✅ New @-prefix syntax |
| **P1** | Persistent task cache + incremental parsing | ✅ |
| **P1** | Test setup (Bun unit + integration) | ✅ |
| **P1** | Migration path for existing tasks | ✅ Prompt on first v2 load |
| **P2** | Effort matrix contradiction | ✅ Flipped to Buckets first |
| **P2** | Text labels on progress bars | ✅ |
| **P2** | Performance test vault | ✅ Plan to create |
