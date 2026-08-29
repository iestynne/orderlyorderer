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
- **Less code is better.** Refactor toward smaller as part of the task, not as
  follow-up work. D11.
- The simulation engine is a **pure module with no UI imports**. D7.
- Coordinates are `(x, y)`, 1-based, origin top-left; floors 1-based from the
  bottom. Convert at parser boundaries only. D1.
- A change to a canonical doc requires a **diagnostic** test — one whose outcome
  would differ if the change were wrong. D18.
- Anything from a chat that you'd be annoyed to lose goes into docs/
  in the same session it's learned.

## Verification

Specs end with a Verification Contract naming exact expected values. Report the
contract's output — test summary, PASS/FAIL per named case, invariant results,
diff stat, and any file touched outside the declared scope. Not the code.
