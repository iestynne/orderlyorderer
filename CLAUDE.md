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
data/    captured game data. Immutable; version-stamped by path.
src/ test/
```

## Session protocol

Each session works in its own worktree, so any number of CLI instances run in
parallel without stomping on each other, all reading the same `../local/`.

**1. Ask for the work-tree topic name.** Before anything else — before reading
docs, before any tool call that touches the repository:

> What is the work-tree topic name for this session?

Normalize the answer to lowercase kebab-case (`[a-z0-9-]`). That is `<WTTN>`.

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
```

If `../git-<WTTN>/` already exists, reuse it.

**3. Work there, and only there.** Never edit a file under `../git/`.

**4. Stop, and hand the branch over.** Green tests are necessary and are not
sufficient: **anything iestyn has to look at, he looks at before it lands.**
A green suite is never a working UI (D24a, D30), and `main` is what a fresh
session starts from, so untested work there is untested work every later
session builds on.

So when `npm test` and `npm run typecheck` pass, **report and wait.** Say what
is on the branch, what still needs an eye, and how to look at it —
`npm run dev` in the worktree, and the URL it prints. Do not merge.

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
- **Docs are canonical; code is derived.** A behaviour change updates the
  relevant doc in the same commit. Disagreement between them is a bug in both.
- **A game rule has exactly one home: `docs/GAME_MECHANICS.md`.** Specs cite it,
  never restate it — a paraphrase reads as independent confirmation and is not
  one. A spec may state the app's *encoding* of a rule, and cites the rule it
  encodes. D33.
- **Before naming a new type, check the word is free.** `grep` the docs for it.
  "Segment" already belonged to route editing when the UI grew a `Segment`;
  it is `ScrollUnit` now. A view concept and a simulation concept must never
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
  the rule is also stated where you will read it.

## Verification

Specs end with a Verification Contract naming exact expected values. Report the
contract's output — test summary, PASS/FAIL per named case, invariant results,
diff stat, and any file touched outside the declared scope. Not the code.
