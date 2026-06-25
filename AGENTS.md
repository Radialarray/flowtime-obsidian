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
