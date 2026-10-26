# work-tree-panel

A Claude Code mod that adds a **Files** pane beside the chat. It shows the file tree of the folder Claude is working in, together with that folder's git status, so you can see what Claude is changing as it goes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install work-tree-panel --marketplace trishussey-personal/work-tree-panel
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). From a shell instead:

```
claude plugin install work-tree-panel --marketplace trishussey-personal/work-tree-panel
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `trishussey-personal/work-tree-panel`, then Add plugin.

The repository is private: installing needs read access on GitHub and a git credential for github.com already on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## What it shows

- **The repo header:** the repository name, the current branch, how many commits it is ahead of or behind its upstream, the last commit, and the number of changed files (or "Working tree clean"). Outside a git repository it says so.
- **The file tree:** folders first, with `.git` and `.DS_Store` hidden. A changed file carries its git status letter (`M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked). A folder with changes inside it shows a dot. Deleted files stay in the tree, struck through, until the deletion is committed.

## Using it

- The pane opens on its own when your terminal is wide enough (about 144 columns). Otherwise type `/files`.
- **Expand or collapse a folder** by pressing its row: Enter while the pane has focus, or a click.
- **Copy a path** by pressing a file row. The path is copied relative to the working folder, for example `src/app.ts`. Folders have their own `copy` button. **copy full path** copies the absolute path of the working folder.
- **Refresh** with `r`, or the refresh button. The pane also refreshes every five seconds and shortly after each of Claude's tool calls.

Copying uses your system's clipboard tool, or the OSC 52 escape code over SSH, which needs a terminal that supports it.

## Limits

- Symlinked folders show as files and can't be expanded.
- Very large expanded trees are cut off at about 2,000 rows, with a note asking you to collapse a folder.
- Which folders are expanded is remembered for the session, not across sessions.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
