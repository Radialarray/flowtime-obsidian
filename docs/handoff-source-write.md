# Handoff: Write checkbox changes to source file

## Current state

Aggregated task lines in `today-mobile.md` now include source file links:

```markdown
- [ ] Task text @30m @b:admin [📄 Daily.md:42](obsidian://open?file=Daily.md&line=42)
```

`formatTaskLine()` in `src/task-aggregator.ts` generates these links using `obsidian://open` URI with `encodeURIComponent(path)`.

## What should happen

Checkbox click in mobile view → reads the source path+line from the link → modifies the **source file** at that line → triggers re-aggregation → mobile view + all code block views sync.

## What's failing

The checkbox handler in `src/list-enhancer.ts` `_enhanceTaskLine()` tries to extract source path from the rendered `<a>` tag:

```ts
const linkEl = el.querySelector("a.external-link, a.internal-link");
const href = linkEl?.getAttribute("href") || "";
const srcMatch = href.match(/file=([^&]+).*?line=(\d+)/);
```

This returns `null` or the `getAbstractFileByPath` lookup fails. The modify never happens.

## Debug steps

1. Check what `linkEl?.getAttribute("href")` actually returns for an `obsidian://open` link in Obsidian's rendered DOM. Run in console:
   ```js
   document.querySelector(".task-list-item a")?.getAttribute("href")
   ```

2. Verify `app.vault.getAbstractFileByPath("Daily.md")` works (may need full path relative to vault root)

3. Consider: Obsidian might render `obsidian://` links differently (not as standard `<a>` tags), or might strip the URI. An alternative is to embed the source as an HTML data attribute:
   ```html
   <span data-ft-src="Daily.md" data-ft-line="42">📄</span>
   ```
   Then the handler reads `data-ft-src` and `data-ft-line` directly instead of parsing the link.

4. Or use Obsidian's `app.workspace.openLinkText` in reverse — pass a file reference instead of URI parsing.

## Files involved

- `src/list-enhancer.ts` — checkbox handler (~line 95-130)
- `src/task-aggregator.ts` — `formatTaskLine()` (~line 130-155)
- `src/main.ts` — `onHeadingDrop` callback (re-aggregation after source change)

## Goal

Check a box in `today-mobile.md` → source file (e.g., `Daily.md`) line toggles [ ]↔[x] → all views sync.
