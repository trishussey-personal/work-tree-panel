# CLAUDE.md

Project-level instructions for Claude Code, loaded at the start of every session in this folder. Four sections, four jobs: a compressed map of the workspace, the conventions Claude follows here, what Claude can already do here, and a log of what has been tried.

## Workspace map

work-tree-panel: a Claude Code mod that adds a side panel showing the project's git worktrees and what is running in each.

Project is new. Develop for a while before adding preferences; encode friction you have actually hit, not friction you expect.

Fixed locations:
- `active/` — everything generated: scratch scripts, exports, intermediate output. Subfolders per task. Short-lived files go in `active/.tmp/`.
- `.env` — every key and credential. Referenced by variable name only.
- `.claude/` — project-local skills, agents, and settings.
- `AGENTS.md` — same content as this file, for non-Claude agents.

## Preferences & conventions

- Never write to the project root. Generated files, one-off scripts, and scratch output go in `active/` or a subfolder of it.
- Run commands yourself rather than handing them back to be pasted. The only exception is a command that needs credentials only the user holds.
- Never read, print, or echo the contents of `.env`. Refer to secrets by variable name. Never commit `.env`.
- Before installing a package you have not used in this project before, confirm it exists, is the intended package (not a near-miss name), and has a real history.
- After finishing any development pass, spawn a fresh QA reviewer with no project context (`tickety-boo:qa-reviewer`) before reporting done. Fix its blockers and should-fix items and re-run it; stop when only nits remain or after three rounds, and report anything still open.
- When you make a mistake, append one dated line to **Lab notes** below describing what not to try next time, written for a future instance of you.
- Whenever this file changes, `AGENTS.md` must match it. Keep `AGENTS.md` a plain copy, never a symlink: this project may be submitted, and the plugin directory validator skips and flags symlinks.

## Capabilities

- Nothing project-specific declared yet — add entries as tools and scripts are created.
- Default autonomy: for a well-scoped task, plan it, build it, validate it, and report back. Do not check in mid-task on implementation details that do not change the request's scope.

## Lab notes: what not to do

- 2026-10-25: (empty — first entry goes here)
