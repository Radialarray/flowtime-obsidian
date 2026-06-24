# Flowtime Plugin

Custom Obsidian plugin for editing task time slots with an inline countdown timer.

## Development workflow

1. Edit files in this repo
2. Copy to vault: `cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/flowtime/`
3. Commit: `git add -A && git commit -m "type: description"`
4. User reloads Obsidian to apply changes

## Architecture

- `main.js` — plugin entry point, renders editable table with timer per row
- `styles.css` — all styling (table, dropdown, timer, toolbar)
- `manifest.json` — plugin metadata

## Key patterns

- Notify user to reload Obsidian after changes
- Table re-renders via `buildRows(tbody)` — empties and rebuilds
- Timer state is in-memory (not persisted across Obsidian sessions)
- Dropdown appended to body for proper z-index layering
