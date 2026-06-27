# Flowtime Plugin

Obsidian plugin for daily task planning, timeboxing, and project-aware task management with inline timers.

## Development workflow

1. Edit files in `src/`
2. Build: `npm run build`
3. Copy to vault: `cp dist/main.js dist/manifest.json dist/styles.css /path/to/vault/.obsidian/plugins/flowtime/`
4. Commit: `git add -A && git commit -m "type: description"`
5. User reloads Obsidian to apply changes

## Release

```bash
npm run release   # Builds + assembles full package in dist/
cp -r dist/ /path/to/vault/.obsidian/plugins/flowtime/
```

`dist/` contains: `main.js`, `manifest.json`, `styles.css`, `README.md`, `skills/flowtime/`

**Tag naming:** Tags must NOT have a `v` prefix. Use `1.7.0`, not `v1.7.0`. This applies to both local tags and GitHub releases.

## Architecture

| Path | Purpose |
|------|---------|
| `src/main.js` | Plugin entry point |
| `src/renderer.js` | Table rendering, code blocks |
| `src/settings.js` | Settings tab |
| `src/task-parser.js` | Task line parsing |
| `src/onboard.js` | Onboarding wizard |
| `src/inbox-processor.js` | Inbox capture + processing |
| `src/session-store.js` | Session persistence |
| `src/routine-engine.js` | Recurring task generation |
| `src/*.js` | Other modules |
| `src/styles.css` | All styling |
| `skills/flowtime/` | Agent skills for this project |

## Key patterns

- Notify user to reload Obsidian after changes
- Table re-renders via `buildRows(tbody)` — empties and rebuilds
- Timer state is in-memory (not persisted across Obsidian sessions)
- Agent skills in `skills/flowtime/` — load via `read`
- In any GitHub-facing text (releases, PRs, issues, comments), wrap `@username` patterns in backticks to prevent auto-linking. E.g. write `` `@p:` `` instead of `@p:` — otherwise GitHub creates spurious user mentions.

## Pre-release checklist — Obsidian plugin review compliance

Run before tagging a release. These rules come from Obsidian's automated plugin review (v1.7.0 failed 38 errors + 100+ warnings).

### ERRORS — block the release

| Rule | Fix |
|------|-----|
| `obsidianmd/no-static-styles-assignments` | Never `el.style.xxx = "yyy"`. Use CSS classes (`el.addClass("ft-xxx")`) for static values, `el.setCssProps()` or `el.setCssStyles()` for dynamic values. Define utility classes in `styles.css`. |
| Settings headings | Never `containerEl.createEl("h2"/"h3", { text })` in settings. Use `new Setting(containerEl).setName(text).setHeading()`. |

### WARNINGS — strong recommendations

| Rule | Fix |
|------|-----|
| `obsidianmd/use-active-document` | Never bare `document.xxx`. Use `this.containerEl?.ownerDocument ?? document` or a `_doc` getter. For `body` operations, use `activeDocument.body`. |
| `window.setTimeout` prefix | Never bare `setTimeout()`/`clearTimeout()`/`setInterval()`/`clearInterval()`/`requestAnimationFrame()`. Always prefix with `window.` |
| `vault.configDir` | Never hardcode `.obsidian`. Use `this.app.vault.configDir`. |
| `FileManager.trashFile()` | Never `vault.delete()`. Use `app.fileManager.trashFile()` to respect user preference. |
| Default hotkeys | Never provide `hotkeys` in `addCommand()`. Let user assign them. |
| `TaskCache` deprecation | Use `createTaskCache()` factory, not `new TaskCache()`. |
| `display` deprecation | Use `getSettingDefinitions()` instead of `display()` (settings tab). |
| CSS `!important` | Increase selector specificity instead. Use CSS custom properties (`var(--ft-col-width)`) for overridable dynamic widths. |
| Regex escapes | No `\[` inside `[...]` (character class). No `\-` at start/end of `[...]`. No `\'`/`\"` in normal strings. Use `\uNNNN` not `\xNN` for Unicode. |
| `any` types / unsafe casts | Prefer `instanceof TFile` checks over `as TFile` casts. Avoid `as any`. |
| Floating promises | `void` operator on intentional fire-and-forget. Prefer `await`. |
| `activeEditor` not `editor` | For popout windows. (Note: we use `document` → `activeDocument` pattern above.) |
| Unused variables | Prefix with `_` or remove. |
| Surrogate pairs | Use `u` flag on regex when matching Unicode. |

### Style patterns we use

```typescript
// ✅ CSS class for static styles
el.addClass("ft-w-full");  // instead of el.style.width = "100%"

// ✅ setCssProps for dynamic single property
el.setCssProps({ "border-left": `3px solid ${color}` });

// ✅ setCssStyles for dynamic multiple properties
el.setCssStyles({ left: `${x}px`, top: `${y}px`, display: "block" });

// ✅ Active document getter (add to classes extending MarkdownRenderChild or Plugin)
private get _doc(): Document {
  return this.containerEl?.ownerDocument ?? document;
}

// ✅ RenderProgressBar context element
renderProgressBar(used, total, label, contextEl);  // uses contextEl.ownerDocument
```

### CSS utility classes (in styles.css)

```
.ft-w-full, .ft-w-60, .ft-w-100          — widths
.ft-min-h-50, .ft-min-h-80               — min-heights
.ft-min-w-100, .ft-min-w-180, .ft-min-w-200, .ft-min-w-250 — min-widths
.ft-mr-6, .ft-ml-12, .ft-mt-6, .ft-mt-8, .ft-my-12, .ft-mt-12 — margins
.ft-p-2                                   — padding
.ft-op-05, .ft-op-07, .ft-op-0           — opacity
.ft-bg-error                              — background
.ft-pl-8                                  — padding-left
```

### Column widths (table layout)

```css
.flowtime-table th { width: var(--ft-col-width, auto); }
```
Set `--ft-col-width` via `th.setCssProps({ "--ft-col-width": width })`. This lets media queries override without `!important`.
