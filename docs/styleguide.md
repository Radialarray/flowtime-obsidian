# Flowtime TypeScript Style Guide

## 1. Functional Style Preference

**Prefer pure functions over class methods** when no mutable state is needed. Use classes only when:

- State must be maintained across multiple operations (e.g., `TaskCache`, `StatusTimer`)
- The Obsidian API requires a class (`MarkdownRenderChild`, `Plugin`, `Modal`, `EditorSuggest`)
- Multiple instances with independent state are needed

```typescript
// ✅ Pure function — stateless, testable
export function parseTaskLine(line: string, file: TFile, lineIndex: number): ParsedTask | null { ... }

// ✅ Class — holds mutable cache state
export class TaskCache {
  private _cache: Map<string, CacheEntry> = new Map();
  ...
}

// ❌ Avoid class wrappers for pure utilities
class DateUtils { static parseDate(...) { ... } }  // Just export the function
```

**Avoid side effects in functions** that shouldn't have them. Functions named `get*`, `parse*`, `compute*` should not modify global state or perform I/O.

```typescript
// ✅ Pure — only reads its arguments
function priorityWeight(p: string | null): number { ... }

// ✅ Clearly impure — async + writes to vault
async function toggleCheck(vault: Vault, task: TaskRow): Promise<boolean> { ... }
```

## 2. Module Organization

**One concern per file.** Files should be named after their primary export:

| Pattern | Example |
|---------|---------|
| Pure function set | `task-parser.ts`, `date-parser.ts`, `budget-state.ts` |
| Single class | `project-engine.ts`, `session-store.ts`, `status-timer.ts` |
| Shared types | `types.ts` — all shared interfaces and type aliases |
| Renderer | `renderer.ts`, `weekplan-renderer.ts` |
| Entry point | `main.ts` — plugin class + commands |

**File size**: Target under 500 lines. Refactor when a file exceeds 1000 lines. The largest files (`renderer.ts`, `main.ts`) should be split into focused sub-modules.

**Import order** — group in this sequence, separated by blank lines:
1. External Obsidian imports (`import { Plugin } from "obsidian"`)
2. Obsidian type-only imports (`import type { TFile } from "obsidian"`)
3. Local module imports (`import { parseDate } from "./date-parser"`)
4. Local type-only imports (`import type { TaskRow } from "./types"`)

## 3. Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions | `camelCase` | `parseTaskLine`, `getFileTasks` |
| Classes | `PascalCase` | `TaskCache`, `FlowtimeRenderer` |
| Interfaces | `PascalCase` | `ParsedTask`, `FlowtimeSettings` |
| Type aliases | `PascalCase` | `RenderMode` |
| Constants | `UPPER_SNAKE_CASE` | `START_H`, `MAX_CACHE_ENTRIES` |
| Private members | `_prefix` | `_indexFile`, `_cache` |
| Boolean functions | `is`/`has` prefix | `isFileInScope`, `hasChildren` |
| Async functions | verb that implies I/O | `loadTasks`, `writeSession` |

## 4. Type Patterns

**Explicit return types** on all exported functions:

```typescript
export function parseDate(input: string): string | null { ... }
export function formatDuration(minutes: number): string { ... }
```

**Use unions over enums** for string constants:

```typescript
// ✅ String union — simpler, no import needed
type RenderMode = "today" | "overdue" | "weekly" | "soon";

// ❌ Enum — extra import, runtime overhead
enum RenderMode { Today = "today", ... }
```

**Type assertions**: Use `as` sparingly. Prefer type guards or interface extensions. Acceptable for:

- Obsidian API casts (`TAbstractFile` → `TFile` when you know it's a markdown file)
- JSON deserialization (`JSON.parse(data) as MyType`)
- Callback context where proper typing would require excessive ceremony

**Nullable values**: Use `| null` (not `undefined`) for intentionally absent values. Use `| undefined` only for optional parameters.

## 5. Cyclomatic Complexity

**Target: ≤ 10 per function.** Break down functions that grow beyond this. Signs a function is too complex:

- More than 3 levels of nesting
- Multiple independent `if/else if` chains serving different purposes
- `switch` with more than 5 cases where each case has logic

**Extract helper functions** when:
1. A code block has a clear, nameable purpose
2. It's used in more than one place
3. It operates on different variables than the outer function

```typescript
// ✅ Extracted — clear purpose, independently testable
function nextDay(from: Date, dayIndex: number): Date { ... }
function fmt(d: Date): string { ... }

export function parseDate(input: string): string | null {
  if (!input) return null;
  // ... uses nextDay and fmt
}
```

## 6. Avoiding Code Duplication

**DRY principle**: If the same logic appears in 3+ places, extract it.

**Common duplication patterns in this codebase**:
- Date formatting and parsing → already centralized in `date-parser.ts` and `task-utils.ts`
- `fmtDate` / `_fmtDate` → appears in both `renderer.ts` and `task-utils.ts`. Import from `task-utils.ts`.
- Task field extraction → already centralized in `filter-engine.ts` `getFieldValue()`
- Vault read/write patterns → already centralized in `task-utils.ts` (`toggleCheck`, `updateDate`, `saveTimeWithDuration`)

**When adding new functionality**: Check `task-utils.ts`, `date-parser.ts`, and `budget-state.ts` first. These are the shared utility modules.

## 7. Error Handling

**Async functions**: Return `void` or the result type, don't throw for expected failures:

```typescript
async function _appendTaskIfMissing(file: TFile, taskLine: string): Promise<boolean> {
  try {
    // ... vault I/O ...
    return true;
  } catch (e) {
    console.warn("Flowtime: Could not append task:", (e as Error).message);
    return false;
  }
}
```

**Catch blocks**: Always type the error as `Error`:

```typescript
} catch (e) {
  console.warn("...", (e as Error).message);
}
```

**User-facing errors**: Use the plugin's `notify()` function (not raw `Notice`) so quiet mode is respected.

## 8. Async Patterns

**Avoid `.then()` chains** — use `async/await`:

```typescript
// ✅
const result = await this.app.vault.read(file);

// ❌
this.app.vault.read(file).then(result => { ... });
```

**Fire-and-forget**: For non-critical async work that shouldn't block, use `void`:

```typescript
void this.routineEngine.generateAllDue();
```

## 9. Reacting to Obsidian API Limitations

**`this.app.vault.getAbstractFileByPath()`** returns `TAbstractFile`, but `.md` files are always `TFile`. Cast safely:

```typescript
const file = this.app.vault.getAbstractFileByPath(path);
if (file) {
  await this.app.vault.read(file as TFile);
}
```

**`containerEl.empty()`** clears DOM but not event listeners. Always call it at the start of `renderTable()`.

## 10. Commit Conventions

Follow Conventional Commits:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring without feature/behavior change
- `docs:` — documentation only
- `chore:` — build, dependencies, tooling
