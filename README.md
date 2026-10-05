# Sticky Board

A small pane in [Claude Code](https://claude.com/claude-code) that keeps the state of the project you're in where you can see it:

- **the current phase**, in one line
- **AI**: what Claude still has to do
- **You**: what only you can do
- **Bugs**: known defects

Claude keeps the board up to date itself. You read it at a glance and click an item to tick it off.

```
 shop                                   ×
 phase 2: public beta

 AI 3   You 1   Bugs 2
 ──────────────────────────────────────
 ! rotate leaked webhook secret
 · wire retries into uploader  api
 · paginate the orders page
 ✓ fix login redirect
```

## Install

Needs Claude Code 2.1.287 or newer. The board is a Claude Code mod (function hooks), which is an early-access API.

1. Clone the repo anywhere:

   ```sh
   git clone https://github.com/Magazem/sticky-board ~/sticky-board
   ```

2. Point Claude Code at it in `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/sticky-board"
     }
   }
   ```

   Use an absolute path (`C:/Users/you/sticky-board` on Windows). To list several folders, separate them with `:`, or with `;` on Windows.

3. Restart Claude Code.

To try it for one session without installing: `claude --plugin-dir ~/sticky-board`.

## Use

- The pane opens by itself when the terminal is wide enough (144 columns, or 110 once you've opened it yourself). **`/sticky`** shows or hides it at any width.
- **Click an item** to tick it off. Click it again to undo.
- With the pane focused, **`1` `2` `3`** switch lists and **`x`** closes it.
- Closing it is remembered across sessions. While it's hidden, the counts stay under the prompt: `▤ AI 3 · You 1`.

## How Claude uses it

- Claude gets a `board` tool to add items, tick them off, set the phase and read the board. It only writes the board file, so it never asks for permission.
- At the start of a session, and after you've changed the board yourself, Claude gets a short summary of the board along with your message. It knows the phase and what's open without being asked. Nothing is added while the board is empty.
- When Claude puts something on your list, you get a toast.

You can just talk to it: *"put that on the board"*, *"what's left for me?"*, *"we're in beta now, update the phase"*, *"review this branch and file what you find"*.

## One board per project

Each git repository gets one board. Subfolders and worktrees share it. Outside git, each folder gets its own board.

## Data

Every board lives in one plain JSON file, `~/.sticky/notes.json`. Set `STICKY_HOME` to keep it somewhere else. The file is an array of notes:

```json
{
  "id": "4f1c…",
  "project": "/users/you/shop",
  "project_name": "shop",
  "lane": "todo",
  "title": "wire retries into uploader",
  "priority": 2,
  "area": "api",
  "status": "open",
  "created_at": "2026-10-05T08:04:49.464Z",
  "updated_at": "2026-10-05T08:04:49.464Z"
}
```

- `lane`: `scope` (the phase), `todo` (AI), `human` (you) or `bug`
- `priority`: 1 to 3, where 1 means it blocks work
- `project`: the repository's path. On Windows it's lowercase with backslashes.

Scripts can write the file too, and the pane picks up changes within two seconds.

## Uninstall

Remove the `CLAUDE_CODE_PLUGIN_DIRS` entry and delete the folder. Your boards stay in `~/.sticky` until you delete that too.

## Development

```sh
claude plugin validate .
claude plugin test .
```

Once Claude Code has loaded the mod, it writes the API types into `.claude-plugin/types/` and a `tsconfig.json` next to them, so `tsc -p .` type-checks the module.

## License

MIT
