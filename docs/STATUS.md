# STATUS.md

Paste this at the start of a fresh conversation. App version **v0.7-455**.

---

## What this project is

**Orderlyorderer** — a static web app for planning, recording and sharing routes
through towers in *Towers of Scale*, a Love2D puzzle roguelike. The name is a
nod to tower 2-5 *The Orderly Order*, and to the fact that the tool is
fundamentally about reordering things. TypeScript + Vite + React, no backend,
with a pure simulation module. The app must reproduce the game's mechanics
exactly; the oracle is that an app-generated savegame replays in the real game
and reaches the predicted state.

## What the tool is for

Not solving routes — **making a human's search less laborious**. The player
builds and edits the route; the app supplies visualisation and editing
affordances, plus small, predictable automations.

The highest-value analysis is **floor entry thresholds** — the minimum power to
enter and clear a region, given held items. Tower 2-5 is built entirely around
that ordering; it is tedious by hand and easy to get wrong (the Adamantine
Shield drops a `-N`/`+N` pair from `> 2N` to `> 1.5N`). **SPEC-008's skippable
segments compute it as a side effect of editing**, not as a separate feature.

## Canonical documents

| Doc | Holds |
|---|---|
| `GAME_MECHANICS.md` | Game rules: enemies, terrain, gates, held items, scoring, reachability |
| `SAVE_FORMAT.md` | Savegame container and payload, fully reverse-engineered |
| `DECISIONS.md` | Every settled decision, with rationale |
| `RESULTS.md` | Outcomes of savegame validation experiments |
| `TODO.md` | Outstanding actions |
| `UI.md` | What the app currently does, in natural language. Mutable; 150-line budget (D31) |
| `DESIGN_ROUTE_EDITING.md` | Route editing: rationale and behaviour. Live; SPEC-008 holds the contract. |
| `NOTES_map_extraction_deferred.md` | Research record for the retired image pipeline. Not a spec. |
| `SPRITES.json` | 41 sprite hashes to entity names. Demoted; only SPEC-005 needs it. |
| `tools/luajit_buffer.py` | Working, verified codec for `.sav` files |

Each spec names which docs to load. Do not load them all.

## Read the source, do not run experiments

The developer has granted access to the game's source and assets **for use in
this tool only — not for redistribution**; a Love2D executable is a ZIP, so the
Lua and texture atlases unpack with standard tools. This has been decisive:
every mechanics question put to the source was answered by it, several of which
the docs had **wrong** rather than merely uncertain. Reach for
`../local/game/v0.7-455/*.lua` before designing an experiment. Experiments
retain the one role the source cannot fill — confirming we are reading the
*right* code path (`TODO.md` §C).

## Done

- **Savegame format fully decoded.** Container, count encoding, payload, the
  `2S+1` rule. A parse/emit round trip reproduces all four `.sav` files
  byte-for-byte.
- **Savegame writing works.** Nine test variants generated and loaded by the
  game. One is byte-identical to a hand-played save.
- **The loader validates by re-simulation.** Three insufficiency tests (power,
  gold, keys) were each refused, so a successful load is strong evidence our
  simulator agrees with the game's. See `RESULTS.md`.
- **SPEC-002 is implemented and committed.** `tools/maps/` parses all 16
  `res/maps/*` files into committed tower JSON; **82 tests pass**, including a
  byte-exact round trip on 16/16 source files. The emitted JSON is **one merged
  cell grid per floor** (SPEC-002 §5.2), which is what SPEC-004 consumes.
- **Nine mechanics questions settled from the Lua**, several of which corrected
  the docs. The load-bearing one: `negative_keys` rewrites the entire key
  system, not just the Keysmasher — a two-counter model cannot replay EX-3 at
  all. See `GAME_MECHANICS.md` §4.1, §5.3, §6.1.
- **SPEC-004 is implemented**, with every `[O]` closed and
  its step-0 expected values measured rather than predicted.

## Specs

| Spec | State |
|---|---|
| SPEC-002 map parser | **implemented**, tests green |
| SPEC-004 simulation | **implemented**, both primary oracles pass |
| SPEC-006 `.sav` codec | **implemented**, payload round trip exact 326/326 |
| SPEC-005 map diff | **implemented**, draft 2. Oracle 3 passes: 62 040 cells across all 14 towers, zero differences. |
| SPEC-007 tower scrubber | **implemented**, all three stages. Stages 1-2 green against the contract; stage 3 awaits an eye (D24a). |
| SPEC-008 route editing | **spec written**, draft 1. Three features, one machinery. Nothing implemented. |
| SPEC-003 headless Lua harness | stub, behind a decision gate. **Do not build:** its gate required manual verification to have become the bottleneck, and the replay sweep is now that oracle instead. |
| SPEC-001 overlay detector | **cancelled**, in `specs/obsolete/`. Overlays are declared in the level data, not inferred. |

## The simulator agrees with the game

The claim `STATUS.md` has been making since the start — "the oracle is that an
app-generated savegame replays in the real game and reaches the predicted
state" — is now measured in the other direction, which is cheaper and stronger:

- **326 / 326** save records across 14 towers replay with **zero errors**,
  ~470 000 simulated moves.
- **14 / 14** towers' hi-scores reproduce the game's own `score` file **exactly**.
- **62 040 / 62 040** tiles of final tower state match 16 real map exports —
  every one of the 14 towers that has a save — cell for cell, with **zero
  differences** (SPEC-005 oracle 3).

Plus four hand-played experiments (C1-C4) predicted independently by the sim.
Details in `RESULTS.md`. Every entity type in the game is exercised except orbs.

## The app exists

`SPEC-007` slice 1 is built, all three stages. **255 tests pass.**

- **Stage 1, `Cursor`** — `src/sim/cursor.ts`, pure, 122 lines. Every named
  value in the contract reproduced first time: 177 slider stops / 591 steps /
  161 cell edits for `1-3 / "C wip 4F"`, corpus maxima 1 773 stops and 1 849
  edits both in `2-5 / "F 211g 98.3M win H [A]"`. Invariants 1-4 pass over all
  326 records; oracle 1 seeks to all 195 000 stops with no stale tile.
- **Stage 2, assets** — `tools/atlas/build.ts` packs 65 sprites and the four
  bitmap fonts into one 883×176 atlas, 9 KB, gitignored in `build/`. Atlas
  counts confirmed: 160 tiles in 2-6, 32 in EX-2, 325 across all 16 towers.
- **Stage 3, the UI** — Vite, React, one canvas, two panels. Through **four
  rounds of review by eye**, the only judge it has (D24a), and an MVP by
  iestyn's assessment. Both performance faults fixed, four causes, confirmed by
  eye 2026-09-02 — `TODO.md` §A5, D38-D41.

**The D32 reimplementation test ran** and found a real bug — in the docs, not
the code (D33). Looking at the app then found nine more that no test could have
caught: D24a earns its keep.

## Next

1. **Build SPEC-008, route editing.** Specified, nothing implemented.
2. **Perf is deferred**, by decision: long-range slider drags are still slow,
   short-range is the common path and is fine. `TODO.md` §A5 holds what is
   known, including two defects that make the harness's own number wrong.
4. ~~Floor entry thresholds~~ — **reframed.** SPEC-008's skippable segments are
   a general-purpose threshold detector, so the analysis arrives as a
   consequence of the editing work; what is left is the *number*, a search over
   that predicate rather than a separate computation.

## Known blockers

None. The reverse-engineering phase is finished: every mechanic the simulator
needs is read, implemented and validated. Two limitations block nothing today:

- Save **writing** from TypeScript is not byte-exact, because Node's zlib and
  Love2D's make different choices (SPEC-006 §6). Reading is exact. Writing
  stays on the Python codec.
- The browser cannot use `node:zlib`, so the Vite build aliases it to
  `src/sav/zlib-browser.ts` (fflate, ~3 KB). Node keeps the real one, so the
  tests still exercise the code that ships to them.
