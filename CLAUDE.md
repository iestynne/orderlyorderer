# Orderlyorderer

Unofficial route-planning tool for the puzzle game *Towers of Scale*
(Love2D, LuaJIT). TypeScript + Vite + React, no backend.

**Start with `docs/STATUS.md`.** Each spec names which docs to load — do not
load them all.

## Layout

The working directory is the parent of this repository.

```
../local/game/v0.7-455/   the game archive. Readable. NEVER publishable.
docs/    canonical. Mutable, current state only. Code is derived from these.
specs/   SPEC-NNN-slug.md. Frozen once tests exist against them.
tools/   standalone utilities
data/    captured game data. Immutable; version-stamped by path.
src/ test/
```

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
