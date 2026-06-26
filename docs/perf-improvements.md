# Performance Improvements — v1.4.0

## Drag-Drop Handler Optimization

The list view drag-drop handler was causing Chrome `[Violation]` warnings during interactive reordering. Three categories of fixes:

### 1. Eliminated debug logging
Removed `console.log("FT DRAG START", JSON.stringify(...))` on every drag start. JSON.stringify on task objects was expensive and occurred on mousedown.

### 2. Row-to-task lookup: O(n²) → O(1)
The original `findTaskByRow()` ran TWO linear scans per frame:
```typescript
// Before: O(n) per call, called multiple times per drag
findIndex(t => t.file?.path === path && t.line === line)  // scan 1
find(t => t.file?.path === path && t.line === line)       // scan 2
```
Replaced with a `Map<HTMLDivElement, number>` pre-built on drag start. Mouseup uses `rowToIndex.get(row)` for O(1) lookup.

### 3. Layout thrashing fix — batched DOM reads before writes
The original `requestAnimationFrame` callback interleaved reads (layout-forcing) with writes:
```typescript
// Before: read → write → read → write (layout thrash)
querySelectorAll(".ft-list-row")       // READ
forEach(el => el.style.borderTop = "") // WRITE
elementFromPoint(x, y)                // READ
getBoundingClientRect()               // READ (forces layout)
classList.add(...)                    // WRITE
```
Now all DOM reads (`elementFromPoint`, `closest`, `getBoundingClientRect`) happen before any writes (`classList.add`, `classList.remove`).

### 4. CSS classes instead of inline styles
Clearing drag indicators previously reset inline `style.borderTop` and `style.borderBottom` on ALL rows every frame. Now only CSS class toggles are used — no inline style manipulation in the drag loop.

### 5. Single querySelectorAll instead of two
`clearIndicators()` merged two separate DOM queries into one combined selector.

## TaskIndex — Vault Scan Reduction

The `TaskIndex` class replaces repeated full vault scans in renderer.ts and weekplan-renderer.ts:

- **Before**: Every render called `app.vault.getMarkdownFiles()` — O(n) scan of ALL markdown files
- **After**: Single initial scan via `scanAll()`, then incremental updates via `vault.on('modify'/'delete'/'create')` events

The renderer's `loadTasks()` has a fast path for today/overdue/dueweek/weekly modes using `taskIndex.getTasks({ date })` — no file enumeration needed. `_computeDailyTotal()` uses `taskIndex.getDailyDurationTotal()`.

Disk persistence to `.obsidian/plugins/flowtime/task-index.json` enables fast reload on next startup.
