# Orderlyorderer

Unofficial route-planning tool for the puzzle game *Towers of Scale*
(Love2D, LuaJIT). TypeScript + Vite + React, no backend.

**Start with `docs/STATUS.md`.** Each spec names which docs to load — do not
load them all.

## Layout

The working directory is the parent of this repository. A session works in its
own sibling worktree, not in the repository itself — see Session protocol.
Relative paths in this file resolve inside that worktree.

```
../local/game/v0.7-455/   the game archive. Read-only. NEVER publishable.
../git/                   main checked out. Merge target only; never edit here.
../git-<WTTN>/            this session's worktree. All work happens here.
docs/    canonical. Mutable, current state only. Code is derived from these.
specs/   SPEC-NNN-slug.md. Frozen once tests exist against them.
tools/   standalone utilities
data/    captured game data: the save corpus, committed on purpose. Tower
         JSON is NOT here — it is derived, so it is built into `build/`
         (`tools/paths.ts`). Immutable; version-stamped by path.
src/ test/
```

## Session protocol

Each session works in its own worktree, so any number of CLI instances run in
parallel without stomping on each other, all reading the same `../local/`.

**1. Ask for the work-tree topic name.** Before anything else — before reading
docs, before any tool call that touches the repository:

> What is the work-tree topic name for this session?

Normalize the answer to lowercase kebab-case (`[a-z0-9-]`). That is `<WTTN>`.
**A name whose worktree already exists is a resume, not a new task** — step 4a.

**The name is the assignment, not a label.** Infer the task from it and do that
task: `TODO.md` §A is a shared list, and its "next, in order" is not this
session's instruction — the numbered item above yours probably belongs to
another session. **If the name does not make the task clear, ask before
starting** rather than picking. Two sessions once both took §A item 1, and git
merged the duplicate work cleanly by keeping one approach whole and silently
dropping the other. D43.

*Exception:* a read-only session — questions, explanation, no file changes —
says so and reads from `../git/` without writing. The moment an edit is
wanted, stop and ask.

**2. Create the worktree.** From `../git/`:

```sh
git worktree add -b session-<WTTN> ../git-<WTTN> main
cd ../git-<WTTN>
npm ci --prefer-offline   # node_modules/ is gitignored; ~2s from a warm cache
npm run build-atlas       # build/ is gitignored; typecheck fails without it
npm run parse-towers      # the tower JSON, also built rather than committed
```

If `../git-<WTTN>/` already exists, reuse it.

**Restart the dev server after every build.** `[F]` The atlas is imported
`?inline` (SPEC-007 §6.1), so Vite bakes it into the module graph when it
transforms the module — rebuilding `build/atlas.png` does not invalidate that,
and `npm run build` writes over it. A server left running afterwards draws with
a stale or missing sheet, which looks like the app rendering black. Kill it and
`npm run dev` again; do not debug the black screen. **Then ask iestyn to hard-
reload the tab** (Ctrl+Shift+R) and give him the URL: restarting the server does
nothing to what his browser already holds, and he is the only one who can.

**3. Work there, and only there.** Never edit a file under `../git/`.

**3a. Review before reporting.** The last stage of every task: walk every diff
hunting disagreement — doc against code, doc against doc, comment against the
lines under it — and `grep` each renamed or removed term across the tree. Two
such disagreements surfaced by luck in one session; none was caught by a test,
and none could have been. D45.

**4. Stop, and hand the branch over.** Green tests are necessary and are not
sufficient: **anything iestyn has to look at, he looks at before it lands.**
A green suite is never a working UI (D24a, D30), and `main` is what a fresh
session starts from, so untested work there is untested work every later
session builds on.

So when `npm test` and `npm run typecheck` pass, **report and wait.** Say what
is on the branch, what still needs an eye, and how to look at it —
`npm run dev` in the worktree, and the URL it prints. **Restart that server
first if anything has been built since it started** (step 2). Do not merge.

**4a. Suspend rather than run the context out.** A session is re-sent whole on
every turn, so a long one costs more per turn the further it goes, and a task
worth several rounds of review will outlive one context. Suspending is cheap —
but only if the state is in the repository first, because a fresh session gets
the branch, the docs and the code, and nothing else. Before stopping:

- **Kill your dev server.** A live Vite holds `node_modules` open — on Windows
  the rollup and esbuild binaries — and `npm ci` is the first thing the next
  session runs. Left up, it lets that `npm ci` delete 171 of 174 packages and
  then fail on the two it cannot unlink, which is a broken tree and no server.
- **Commit everything**, broken states included (Hard rules).
- **Write down what is still wrong**, in `docs/TODO.md` §A: a numbered section,
  one line each, marked as the branch's own and deleted when it merges. The
  commit log says what landed. It never says what is outstanding, and that is
  the half only this session holds.
- **Rationale belongs in the code**, as `[I]`/`[F]` comments beside what it
  explains. That survives a session boundary on its own; a chat log does not.
  **Rationale is not history.** A comment is a one-line summary of a chunk, for
  skimming, or a non-obvious fact about the lines under it — never the story
  of the bug that led there. The commit holds the story; the comment holds the
  conclusion. `[I]` "Used to do X, now does Y" is the pattern to delete.

Resuming is step 1 with the same `<WTTN>`. The worktree already exists so step 2
reuses it, and the session starts from that §A section rather than from the
branch's diff. Run `npm ci`, `npm run build-atlas` and `npm run parse-towers`
anyway — `node_modules/` and `build/` are gitignored — and start a dev server
of your own; the port the last session reported is not yours.

`[F]` If that `npm ci` fails `EPERM` or `EBUSY` on a `.node` or an `.exe`, a
previous session left its server running. **Ask iestyn to kill it** rather than
fighting the file; the agent cannot. Renaming the locked binary and re-running
does work — Windows permits rename on a mapped file where it refuses unlink —
but it has to be repeated per file and leaves a zombie server behind.

**5. Merge back only when iestyn says so.** Conflicts are resolved in the
worktree; `main` only ever fast-forwards.

```sh
git merge main            # in the worktree: take what other sessions landed.
                          # Resolve here, then re-run test + typecheck.
cd ../git && git merge --ff-only session-<WTTN>
```

A rejected `--ff-only` means another session landed first: back to the
worktree, `git merge main` again, retest, retry until it fast-forwards.
`../git/` must have a clean working tree for this step; if it does not, stop
and ask.

**6. Report** the branch name, the worktree path, and what landed on `main`.

## Hard rules

- **Never copy anything from `../local/game/` into this repository**, and never
  stage it. Towers of Scale is not open source; its source and assets are
  permitted for use in this tool only, never for redistribution.
  See `docs/DECISIONS.md` D14b.
- The game archive is a **build-time input**, not a runtime dependency. Parse it
  once, commit the derived tower JSON, and depend on that. D14e.
- **Code is authoritative; a doc is the map into it.** Once a thing is built,
  the code is its description. A doc says what a reader needs to find the code
  and read it right — the shape, and references — and never re-explains lines
  the code says better. Two exceptions: **how a thing looks** (not readable
  from its code; keep descriptions and example images), and **the game's
  rules** (`GAME_MECHANICS.md` is the map into *the game's* code, which is
  authoritative for them). A doc the code contradicts is wrong, and is fixed in
  the commit that made it wrong. D45.
- **A game rule has exactly one home: `docs/GAME_MECHANICS.md`.** Specs cite it,
  never restate it — a paraphrase reads as independent confirmation and is not
  one. A spec may state the app's *encoding* of a rule, and cites the rule it
  encodes. D33.
- **Before naming a new type, check the word is free.** `grep` the docs for it.
  "Segment" already belonged to route editing when the UI grew a `Segment`;
  it is `WorkingSet` now. A view concept and a simulation concept must never
  share a word. D34.
- **Less code is better.** Refactor toward smaller as part of the task, not as
  follow-up work. D11.
- The simulation engine is a **pure module with no UI imports**. D7.
- Coordinates are `(x, y)`, 1-based, origin top-left; floors 1-based from the
  bottom. Convert at parser boundaries only. D1.
- A change to a canonical doc requires a **diagnostic** test — one whose outcome
  would differ if the change were wrong. D18.
- Anything from a chat that you'd be annoyed to lose goes into docs/
  in the same session it's learned.
- **Commit at each checkpoint, not at the end.** A commit is a bisect point,
  not a publication — commit broken states too, and fold the session's commits
  at the tail once it all tests. A bug with a commit boundary around it shows
  you *why* in one diff; the same bug buried in an hour of uncommitted work
  does not.
- **Never reach outside localhost.** No fetching, browsing or downloading from
  the network during a task. `.claude/settings.json` denies it; this is here so
  the rule is also stated where you will read it. Two commands in this repository
  reach the network — `npm run shots:install` (SPEC-009 §2) and `npm run deploy`
  (D48) — and **only iestyn runs either**. A session may take deploy as far as
  `npm run deploy -- --no-push`, which builds and does not push.
- **Never edit `LAUNCH_ARGS` in `tools/shots/browser.ts`.** It is the harness
  browser's confinement to localhost, and SPEC-009 §5 case 1 pins it against a
  literal so an edit is a red test rather than a quiet one. If a scenario seems
  to need a flag changed, that is a question for iestyn, not a change to make.

## Verification

Specs end with a Verification Contract naming exact expected values. Report the
contract's output — test summary, PASS/FAIL per named case, invariant results,
diff stat, and any file touched outside the declared scope. Not the code.
