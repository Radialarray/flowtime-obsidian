# Flowtime Subtasks & Sprints — Plan

> Tree-based task hierarchy via markdown indentation, surfaced in the table view with collapse/expand, per-subtask dates and timers, plus future sprint support as a tag-based grouping layer.

---

## 1. Design Philosophy

### 1.1 Zero new syntax

Subtasks = existing markdown task lines, indented. No new directives. Every subtask is a full `parseTaskLine` object with its own date, duration, bucket, priority, project, timer.

```
- [ ] Parent task @2026-06-25 @2h @p:Website
  - [ ] Subtask A @2026-06-25 @1h
  - [ ] Subtask B @2026-06-26 @1h
    - [ ] Sub-subtask @2026-06-26 @30m
```

### 1.2 Subtasks are first-class tasks

Every field works on every level:

| Feature | Root | Child | Grandchild |
|---|---|---|---|
| Due date | ✅ | ✅ | ✅ |
| Duration | ✅ | ✅ | ✅ |
| Bucket | ✅ | ✅ | ✅ |
| Priority | ✅ | ✅ | ✅ |
| Project | ✅ | ✅ | ✅ |
| Timer | ✅ (cumulative) | ✅ (own) | ✅ (own) |
| @soon | ✅ | ✅ | ✅ |
| Recurrence | ✅ | ✅ | ✅ |

### 1.3 Tree is display-only

The parent-child relationship is computed at render time from indentation. Source files are not modified — no parent IDs, no JSON trees. Collapse/expand state is in-memory.

### 1.4 Sprints = tag + settings

Sprints reuse the bucket pattern: a setting-defined sprint registry + `@sprint:id` tag on tasks. No new code block types initially — sprints appear as a filter and a grouping column.

---

## 2. Parser Changes (`src/task-parser.js`)

### 2.1 Add `indent` to `parseTaskLine()` return

```js
indent: m[1].length, // spaces before the task marker
```

No breaking changes. All existing fields stay.

### 2.2 New export: `buildTaskTree(tasks)`

```js
/**
 * Build a parent-child tree from a flat list of parsed tasks.
 * Hierarchy is determined by indent level.
 * Returns array of root nodes, each with: { task, children: [], depth }
 */
function buildTaskTree(tasks) { ... }
```

Algorithm: stack-based traversal (O(n)). Each node knows its `depth`. A task at indent 0 is root; indent 2 is child of last indent 0; indent 4 is grandchild; etc.

### 2.3 New export: `flattenTree(tree, collapsedIds)`

Flatten back to a display list. Roots emit first, then recursively emit children only if parent is not collapsed. Each item gets `depth` for rendering indentation.

```
flattenTree(tree, { collpased: new Set(["task-3"]) })
→ [{ task: A, depth: 0 }, { task: B, depth: 1 }, { task: C, depth: 2 }]
// D (child of C) omitted because C is collapsed
```

Task identity = `file.path + ":" + line` (string key).

---

## 3. Renderer Changes (`src/renderer.js`)

### 3.1 `loadTasks()` — tree construction

After collecting parsed tasks per file, call `buildTaskTree()` for each file's tasks. Store `this.taskTree = { roots: [...], byFile: {...} }`.

Each flat task in `this.tasks` gets:

- `depth` — 0, 1, 2, …
- `children` — array of child tasks (for progress bar computation)
- `parent` — reference to parent task (or null)
- `id` — `file.path:line`

The flat array stays for sorting/filtering/grouping; the tree is used for collapse/expand.

### 3.2 `buildRows()` — tree-aware flattening

Replace flat iteration with `flattenTree()`. Grouping wraps the flatten: within each group section, apply tree flattening.

### 3.3 `_renderTaskRow()` — indent + collapse

**Task cell** (`td`):

- Left padding = `depth × 16px` + 2px base
- If `children.length > 0`:
  - Show ▶ (collapsed) or ▼ (expanded) button
  - Click toggles collapse state in a Set on the renderer
  - Calls `buildRows()` to re-render
- If collapsed: show cumulative duration in parent's timer cell
- If children exist: show mini progress bar (done/total checkboxes) below task text

**CSS**:

```css
.ft-task-indent-1 { padding-left: 18px; }
.ft-task-indent-2 { padding-left: 36px; }
.ft-task-indent-3 { padding-left: 54px; }
```

Toggle button:

```css
.ft-tree-toggle {
  cursor: pointer;
  user-select: none;
  margin-right: 4px;
  font-size: 10px;
  color: var(--text-muted);
}
.ft-tree-toggle:hover { color: var(--text-normal); }
```

### 3.4 Collapse state

Simple `Set<string>` on renderer:

```js
this._collapsed = new Set(); // set of "file:line" keys
```

Persisted across re-renders within the same session (no file write). Lost on Obsidian restart — acceptable for v1.

### 3.5 Tree expansion actions

New toolbar buttons:

- **Expand All** — clear collapsed set, re-render
- **Collapse All** — collapse all parents, re-render

### 3.6 Growth: column + sort behavior

When tasks are sorted/filtered, the tree structure is preserved within each group — children stay attached to their parent. Sort applies at the parent level first; children sort among themselves.

**Filter edge case**: if a parent is filtered out but a child matches, the child still appears (as a root-level task at depth 0 in the flat filter pass). This avoids losing subtasks.

---

## 4. Quick Entry Changes (`src/quick-entry.js`)

### 4.1 New field: "Parent task"

Dropdown listing recent tasks from the same file or project. When selected:

- Generated line gets `indentation = parent.indent + 2` spaces
- No date/duration inherited — subtask fields are independent

### 4.2 Task suggestion

When creating a subtask in the modal, suggest recently viewed parents. The modal shows a "Parent" field after the user picks a target file.

---

## 5. Timer Behavior

### 5.1 Independent per row

Each subtask row gets its own play/pause/reset timer, same as current flat tasks. Timer state keyed by `file:line`.

### 5.2 Collapsed parent timer

When a parent is collapsed:

- Timer display = sum of all running child timers (cumulative time tracked across all children)
- Pause/resume = pauses/resumes all children

---

## 6. Sprint Support (Phase 2)

### 6.1 Sprint schema (settings)

```js
sprints: [
  { id: "q2-launch", name: "Q2 Launch",
    start: "2026-04-01", end: "2026-06-30",
    goal: "Ship v2 to staging", color: "#2d9ce0" }
]
```

Stored alongside buckets in plugin settings.

### 6.2 Tag convention

```
- [ ] Task @sprint:q2-launch @2026-06-25
  - [ ] Subtask @sprint:q2-launch @2026-06-25 @1h
```

`@sprint:id` on any task or subtask.

### 6.3 Views

No new code block initially. Instead:

1. **Filter**: `@sprint:q2-launch` filters work in any existing view (today/overdue/weekly)
2. **Column**: "Sprint" column shows sprint badge on each row
3. **Group**: "Group by Sprint" option in toolbar dropdown
4. **Sort**: Sprints sort by end date (closest deadline first)

### 6.4 Sprint overview (Phase 3)

If sprints prove useful, add a dedicated `flowtime-sprints` code block:

- Card per sprint with: name, goal, dates, progress bars (done/total, estimated/actual hours)
- Collapsible task list within each sprint card
- Timeline bar showing sprint overlap

---

## 7. Implementation Sequence

### Phase 1: Core subtask support

| Step | File(s) | What |
|---|---|---|
| 1a | `task-parser.js` | Add `indent` to `parseTaskLine()`, export `buildTaskTree()`, `flattenTree()` |
| 1b | `renderer.js` | Build tree in `loadTasks()`, add `_collapsed` state |
| 1c | `renderer.js` | Tree-aware flattening in `buildRows()`, indent in `_renderTaskRow()` |
| 1d | `renderer.js` | Collapse/expand toggle chevron, progress bar on parents |
| 1e | `renderer.js` | Cumulative collapsed timer |
| 1f | `styles.css` | `.ft-tree-toggle`, `.ft-task-indent-{1,2,3}` |
| 1g | `quick-entry.js` | Parent task field |

### Phase 2: Sprint foundation

| Step | File(s) | What |
|---|---|---|
| 2a | `settings.js` | Sprint schema, default settings, settings tab UI |
| 2b | `task-parser.js` | Parse `@sprint:id` tag |
| 2c | `renderer.js` | Sprint column, sprint filter, sprint group |
| 2d | `styles.css` | Sprint badge styles |

### Phase 3: Sprint overview view

| Step | File(s) | What |
|---|---|---|
| 3a | `renderer.js` | `_renderSprintOverview()` — sprint cards with progress |
| 3b | `styles.css` | Sprint card layout, progress bars |
| 3c | `settings.js` | Code block registration |

---

## 8. Open Questions / Risks

| Risk | Mitigation |
|---|---|
| **Very deep nesting** (5+ levels) | Cap display depth at 4; deeper levels shown as flat children at depth 4 |
| **Performance: huge task trees** | Tree building is O(n), flattening is O(n + collapsed branches). No issue for typical vaults (<2000 tasks) |
| **Indentation ambiguity** 2 vs 4 spaces | Parser normalizes: `depth = floor(indent / 2)`. Mixed indentation in the same file may break tree. Document 2-space indent convention. |
| **Sort breaks tree** | Tree structure is preserved under grouping. When no grouping, parents keep their children adjacent. Sort only reorders root-level parents; children sort within parent. |
| **Filter splits parent from child** | Child without parent filter match appears at depth 0. Acceptable — user sees it as a standalone task. |

---

## 9. Future Ideas (Not in Scope)

- Drag-and-drop reordering of subtasks (writes indentation changes to source)
- Ad-hoc subtask creation: click "+" icon on parent row to add child inline
- Subtask progress bar in the task text (e.g. `[2/5]` auto-added to source)
- Kanban / board view with swimlanes for projects + subtask cards
- Auto-timer cascade: starting parent timer auto-starts first incomplete subtask timer
