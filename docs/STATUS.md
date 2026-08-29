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

The highest-value analysis identified so far is **floor entry thresholds**: the
minimum power needed to enter and clear a region, given held items. Tower 2-5
*The Orderly Order* is built entirely around working out the order to tackle
floors in, and that computation is tedious by hand and trivial for a simulator.
The Adamantine Shield case is a good example — it lowers the threshold of a
`-N`/`+N` enemy pair from `> 2N` to `> 1.5N`, which is easy to miss manually.

## Canonical documents

| Doc | Holds |
|---|---|
| `GAME_MECHANICS.md` | Game rules: enemies, terrain, gates, held items, scoring, reachability |
| `SAVE_FORMAT.md` | Savegame container and payload, fully reverse-engineered |
| `DECISIONS.md` | Every settled decision, with rationale |
| `RESULTS.md` | Outcomes of savegame validation experiments |
| `TODO.md` | Outstanding actions |
| `DESIGN_ROUTE_EDITING.md` | Route segmentation and the power graph. A draft, deferred. |
| `NOTES_map_extraction_deferred.md` | Research record for the retired image pipeline. Not a spec. |
| `SPRITES.json` | 41 sprite hashes to entity names. Demoted; only SPEC-005 needs it. |
| `tools/luajit_buffer.py` | Working, verified codec for `.sav` files |

Each spec names which docs to load. Do not load them all.

## Read the source, do not run experiments

The developer has granted access to the game's source and assets **for use in
this tool only — not for redistribution**. A Love2D executable is a ZIP
container, so the Lua source and texture atlases unpack with standard tools.

This has been decisive. Every mechanics question put to the source has been
answered by it, including several the docs had **wrong**, not merely uncertain.
Reach for `../local/game/v0.7-455/*.lua` before designing an experiment.

Experiments retain one role the source cannot fill: confirming we are reading
the *right* code path. `TODO.md` §C is what survives that filter — four tests,
down from a page.

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

## Not started

The app itself. `tools/` and `src/` hold the pure modules — parser, savegame
codec, simulator — and there is no UI, no Vite setup and no route editor.

## Next

1. **Start the app.** `DESIGN_ROUTE_EDITING.md` is the deferred sketch to
   promote into a spec.
2. ~~SPEC-005 (map diff)~~ — **done**. All three oracles now run.
3. **Floor entry thresholds**, the analysis this tool exists for. Nothing
   blocks it now.

## Known blockers

None. The reverse-engineering phase is finished: every mechanic the simulator
needs is read, implemented and validated against real play.

One recorded limitation, blocking nothing today: save **writing** from
TypeScript is not byte-exact, because Node's zlib and Love2D's make different
choices (SPEC-006 §6). Reading is exact. Writing stays on the Python codec.
