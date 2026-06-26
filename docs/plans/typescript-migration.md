# TypeScript Migration for Flowtime

Gradual migration from plain JS (CommonJS) to TypeScript across all 20 source modules (~12k LOC). No behavioral changes — types are compile-time only.

## Motivation

### 1. Catch bugs before they ship
Every function in this codebase has implicit contracts that are never enforced. The most common failure patterns:

- **`app` threading** — `app.vault`, `app.metadataCache`, `app.workspace` are passed as opaque blobs through constructors and method calls. A wrong method name or missing `await` is silent until runtime.
- **Task shape rot** — `ParsedTask`, `TaskRow`, `CacheEntry` are the same data flowing through `task-parser` → `cache` → `renderer`, but each step duplicates the shape contract via comments and hope. A field rename in `parseTaskLine` won't be caught in `getFileTasks` or `_renderListView`.
- **Null/undefined surfaces** — `priority`, `sprint`, `project`, `bucket`, `sortIndex`, `taskDate` — every one of these can be `null` or missing depending on code path. Callers inconsistently guard.
- **`JSON.parse` from cache** — `fromJSON()` loads arbitrary data from disk. Today it silently accepts any shape.

### 2. Safe refactoring of the 3k-line renderer
`renderer.js` (3,226 lines) bundles loading, filtering, sorting, grouping, table rendering, list rendering, drag-and-drop, timers, popovers, and budget views. Splitting it requires knowing every field that flows between these subsystems. Interfaces make that mechanical — the compiler tells you when a connection breaks.

### 3. Editor superpowers
- Go-to-definition across the codebase
- Rename symbol across files (not just grep+replace)
- Autocomplete for `FlowtimeSettings`, `ParsedTask`, `BucketDef`, `SprintDef`
- Inline type docs on hover

### 4. Future velocity
Every new feature becomes faster with compile-time checking + autocomplete. TypeScript pays back fastest in the modules with the most branching and null checks (`renderer`, `task-parser`, `renderer`, `main`).

## Migration Strategy

**No branch locks, no freeze.** Migration is incremental, additive, and lands in `main` as it completes module by module.

### Phase 0 — Scaffolding (~15 min)
- Install TypeScript + `@types/node`
- Create `tsconfig.json` — `strict: true`, target `es2018`, module `commonjs`
- Switch esbuild config: `entryPoints: ["src/main.ts"]`, add `tsconfig` loader
- Rename `src/main.js` → `src/main.ts`. Get it compiling (will be many errors at first — use `// @ts-nocheck` to defer)
- Add `"build:ts": "tsc --noEmit"` to package.json for type-check pass separate from bundle

### Phase 1 — Pure logic modules (~1 hr)
No Obsidian dependency, easiest to type first:

| Module | Lines | Key types to define |
|--------|-------|---------------------|
| `date-parser` | 159 | `parseDate(input: string): string \| null` |
| `filter-engine` | 163 | `FilterLeaf`, `FilterCompound`, `FilterOp`, `FilterField` |
| `budget-state` | 70 | `renderProgressBar(used: number, total: number, label: string): HTMLElement` |
| `task-parser` | 439 | `ParsedTask`, `Recurrence`, `RecurrenceType` — **the most important shared type** |
| `task-utils` | 350 | `DUR_OPTS`, helper function signatures, `getFileTasks`, `toggleCheck`, `updateDate` |
| `cache` | 259 | `CacheEntry`, `DateIndexEntry`, `TaskCache` class |

### Phase 2 — Data layer (~1.5 hr)

| Module | Lines | Key types |
|--------|-------|-----------|
| `settings` | 833 | `FlowtimeSettings`, `BucketDef`, `SprintDef`, `SavedView` |
| `session-store` | 208 | `SessionEntry` |
| `project-engine` | 194 | `ProjectResult`, `FrontmatterResult` |

### Phase 3 — IO layer (~2 hr)

| Module | Lines | Key types |
|--------|-------|-----------|
| `template-engine` | 279 | `DashboardType`, `CreateProjectResult` |
| `routine-engine` | 437 | `RoutineType`, `TrackingEntry` |
| `inbox-processor` | 936 | Inbox modal state |
| `quick-entry` | 380 | Quick entry modal state |
| `extract-note` | 179 | Extract handler state |
| `list-enhancer` | 175 | Enhancer state |

### Phase 4 — Presentation layer (~4 hr)

| Module | Lines | Key types |
|--------|-------|-----------|
| `renderer` | 3,226 | `TaskRow`, `ColumnDef`, `GroupConfig`, `FilterState`, `SortConfig`, `DragState`, `TimerState` |
| `weekplan-renderer` | 1,252 | `WeekplanDay`, `TimelineSlot` |
| `status-timer` | 147 | `TimerState` |
| `main` | 1,674 | All plugin-level types, command handlers, modal subtypes |
| `onboard` | 829 | Onboarding wizard types |

## Key Type Definitions

These should live in a shared `src/types.ts` (or inline in modules and exported from an index):

```typescript
// Core task shape (output of parseTaskLine → consumed by cache → rendered by renderer)
interface ParsedTask {
  file?: TFile;
  line: number;
  rawLine: string;
  time: string;
  taskDate: string;
  durationMinutes: number;
  rawText: string;
  cleanText: string;
  status: string;
  priority: string | null;
  bucket: string | null;
  projectTag: string | null;
  isSoon: boolean;
  indent: number;
  sprint: string | null;
  sortIndex: number | null;
}

// Settings — the most widely shared type
interface FlowtimeSettings {
  projectFrontmatterKey: string;
  projectFrontmatterValue: string;
  projectNameKey: string;
  fallbackToFolderName: boolean;
  tagPrefix: string;
  projectsRoot: string;
  quickEntryTargetFile: string;
  buckets: BucketDef[];
  bucketPrefix: string;
  dailyCap: number;
  defaultView: "table" | "list";
  dateFormat: string;
  statusBarTimer: boolean;
  contentWidthPreset: "s" | "m" | "l" | "xl";
  timerSound: boolean;
  noticeDuration: number;
  quietMode: boolean;
  dailyTemplate: string;
  weeklyTemplate: string;
  projectTemplate: string;
  inboxPath: string;
  inboxDefaultDuration: number;
  inboxDefaultBucket: string;
  inboxDefaultProject: string;
  todayNotePath: string;
  savedViews: Record<string, SavedView>;
  sprints: SprintDef[];
  routinesFolder: string;
  vacationMode: boolean;
  autoGenerateOnStartup: boolean;
  autoGenerateOnOpenDaily: boolean;
  workdays: number[];
  weekStartDay: number;
  hideCompletedRoutines: boolean;
}
```

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `obsidian` types may not cover all APIs we use | Extend with local `.d.ts` declarations as needed |
| Renderer (3,226 lines) is high churn — fighting TS while rewriting | Set `strict: false` per-file initially, tighten incrementally |
| Built `.js` output must be identical before/after | Compare bundle sizes + smoke test in vault |
| Team not familiar with TS | All types are mechanical — interfaces, not advanced generics |

## Success Criteria

1. `npm run build` produces working `dist/main.js`
2. `npx tsc --noEmit` passes with zero errors
3. Obsidian loads plugin with no console errors
4. All existing code block modes render identically before/after
