---
name: flowtime
description: Complete reference for managing Flowtime plugin data in Obsidian. Routes to sub-skills based on operation — setup/onboarding, vault management (projects/buckets), or task management (daily business, sessions).
---

# Flowtime Skill — Router

Load this skill first, then load the appropriate sub-skill based on the user's intent.

## Route by Operation

| User wants to... | Load |
|------------------|------|
| Onboard, configure settings, understand vault structure, data model, plugin commands, vault API, agent rules | `setup.md` |
| Create/read/update/delete projects or buckets | `vault.md` |
| Manage tasks, dashboard, daily/weekly planning, code blocks, sessions, time tracking | `tasks.md` |

All sub-skills are in this same directory. Load them with `read` and follow their instructions.
