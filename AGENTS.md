# CLAUDE.md

Project-level instructions for Claude Code, loaded at the start of every session in this folder. Four sections, four jobs: a compressed map of the workspace, the conventions Claude follows here, what Claude can already do here, and a log of what has been tried.

## Workspace map

work-tree-panel: a Claude Code mod (plugin of function hooks) that adds a "Files" side pane: the session's working-directory file tree with git repo, branch, ahead/behind, last commit and per-file change status. Folders expand on press; files and folders copy their relative path.

- `.claude-plugin/plugin.json` — manifest; `types` points at the state contract.
- `hooks/hooks.json` → `hooks/register.tsx` — the whole mod: git snapshot (`readGit`), refresh timer, `/files` command, the Pane render hook.
- `types/index.d.ts` — `$.state` contract (`root`, `expanded`, `git`). Bump an atom's `shape` tag when its value's fields change.
- `tests/pane.test.tsx` — `claude plugin test .`
- `tsconfig.json` — extends `.claude-plugin/types/tsconfig.json`, which the engine writes when it loads the mod (gitignored).
- `README.md` — user-facing docs; the plugin directory requires it. `LICENSE` is MIT (also `license` in plugin.json).

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

- `claude plugin validate .` — checks the manifest and hooks module as the engine will load them, plus plugin-directory submission checks.
- `claude plugin test .` — runs `tests/*.test.tsx`.
- Type check: `tsc -p .` once the engine has laid `.claude-plugin/types/` (it does on load); otherwise a scratch tsconfig per the header of the plugin-authoring skill's `claude-code.d.ts`. No global `tsc`: use `npx -p typescript@5.6.3 tsc` with `npm_config_cache=$TMPDIR/npm-cache` (the sandbox blocks `~/.npm`).
- Try it live: `claude --plugin-dir .` from this folder.
- Default autonomy: for a well-scoped task, plan it, build it, validate it, and report back. Do not check in mid-task on implementation details that do not change the request's scope.

## Lab notes: what not to do

- 2026-10-25: Don't pass `$` to a closure defined inside `register`; the validator refuses it. A helper that takes `$` must be a top-level function declaration (or a const bound to one).
- 2026-10-25: Bash in the sandbox can't write to `~/.claude/dev-mods/`, where a hot-reloading session copy of the mod lives. Edit those files with the Edit/Write tools, not sed or python.
- 2026-10-25: Don't assume `git status --porcelain` puts renames only in the first (X) column. An unstaged rename after `git add -N` is ` R new\0old`, so check both columns before skipping the original path. Check for unmerged codes (`U` in either column, `AA`, `DD`) before any "D wins" rule.
- 2026-10-25: Don't gate background work on `e.isInteractive` alone; the desktop app may attach a surface while not counting as interactive. Use `e.isInteractive || e.surface !== null`, and start polling from the command too.
- 2026-10-25: Don't type `\u` escapes for invisible characters (bidi overrides, U+FFFD) through the Edit/Write tools; they land in the file as the raw characters. Write those lines with a python script instead, and check with `LC_ALL=C grep -nP '[^\x00-\x7f]'`.
- 2026-10-25: Don't test the mod's git argument lists in zsh with `$VAR` expansion; zsh doesn't word-split, so git gets one bad argument. Use bash arrays.
- 2026-10-25: Security audit run; 4 findings before public plus 5 hardening; report at `active/security/audit-2026-10-25.md`.
