# STATUS.md

Paste this at the start of a fresh conversation. App version **v0.7-455**.

---

## What this project is

**Orderlyorderer** — a static web app for planning, recording and sharing routes
through towers in *Towers of Scale*, a Love2D puzzle roguelike, named for tower
2-5 *The Orderly Order* and for the tool being about reordering things.
TypeScript + Vite + React, no backend, with a pure simulation module. It must
reproduce the game's mechanics exactly; the oracle is that an app-generated
savegame replays in the real game and reaches the predicted state.

## What the tool is for

Not solving routes — **making a human's search less laborious**. The player
builds and edits the route; the app supplies visualisation, affordances and
small, predictable automations.

The highest-value analysis is **floor entry thresholds** — the minimum power to
enter and clear a region, given held items. Tower 2-5 is built entirely around
that ordering; it is tedious by hand and easy to get wrong (the Adamantine
Shield drops a `-N`/`+N` pair from `> 2N` to `> 1.5N`). **SPEC-008's skippable
segments are the predicate**, built and working; the *number* is a search over
it, and is the analysis still to come.

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
| `SPRITES.json` | 41 sprite hashes to entity names. Only SPEC-005 needs it. |
| `tools/luajit_buffer.py` | Working, verified codec for `.sav` files |

Each spec names which docs to load. Do not load them all.

## Read the source, do not run experiments

The developer has granted access to the game's source and assets **for use in
this tool only — not for redistribution**; a Love2D executable is a ZIP. This
has been decisive: every mechanics question put to the source was answered by
it, several of which the docs had **wrong** rather than merely uncertain. Reach
for `../local/game/v0.7-455/*.lua` before designing an experiment; experiments
retain only the role the source cannot fill, confirming we read the *right* code
path (`TODO.md` §C).

## Done

- **Savegame format fully decoded**, and writing works: a parse/emit round trip
  reproduces all four `.sav` files byte-for-byte, and nine generated variants
  loaded in the game, one byte-identical to a hand-played save. The loader also
  validates by re-simulation — three insufficiency tests (power, gold, keys)
  were each refused, so a load is evidence the simulators agree.
- **SPEC-002 is implemented.** `tools/maps/` parses all 16 `res/maps/*` files
  into committed tower JSON, byte-exact round trip on 16/16, as **one merged
  cell grid per floor** (§5.2) — which is what SPEC-004 consumes.
- **Nine mechanics questions settled from the Lua**, several of which corrected
  the docs. The load-bearing one: `negative_keys` rewrites the entire key
  system, not just the Keysmasher — a two-counter model cannot replay EX-3 at
  all. See `GAME_MECHANICS.md` §4.1, §5.3, §6.1.
- **SPEC-004 is implemented**, with every `[O]` closed and its step-0 expected
  values measured rather than predicted.
- **SPEC-008 is implemented**, the whole of it: the `.ord` document, the
  forward pass with skips and forks, the nine editing operations, export, the
  working store and the editing UI. Nine invariants and four oracles pass;
  oracle 2 reproduces all **326** payloads byte for byte.

## Specs

| Spec | State |
|---|---|
| SPEC-002 map parser | **implemented**, tests green |
| SPEC-004 simulation | **implemented**, both primary oracles pass |
| SPEC-006 `.sav` codec | **implemented**, payload round trip exact 326/326 |
| SPEC-005 map diff | **implemented**, draft 2. Oracle 3 passes: 62 040 cells across all 14 towers, zero differences. |
| SPEC-007 tower scrubber | **implemented**, all three stages. Stages 1-2 green against the contract; stage 3 awaits an eye (D24a). |
| SPEC-008 route editing | **implemented**, draft 2. Three features, one machinery. Oracles 1-4 pass; the UI awaits an eye (D24a). |
| SPEC-009 visual harness | **draft 2**, built except its goldens. Ten scenarios; taking the shots needs the Chromium only iestyn can install (`npm run shots:install`). |
| SPEC-003 headless Lua harness | stub. **Do not build:** its gate required manual verification to have become the bottleneck, and the replay sweep is that oracle instead. |
| SPEC-001 overlay detector | **cancelled**, in `specs/obsolete/`. Overlays are declared in the level data, not inferred. |

## The simulator agrees with the game

The claim above — "an app-generated savegame replays in the real game and
reaches the predicted state" — is measured the other way round, which is
cheaper and stronger:

- **326 / 326** save records across 14 towers replay with **zero errors**, over
  ~470 000 simulated moves, and **14 / 14** hi-scores reproduce the game's own
  `score` file **exactly**.
- **62 040 / 62 040** tiles of final tower state match 16 real map exports, cell
  for cell, with **zero differences** (SPEC-005 oracle 3).

Plus four hand-played experiments (C1-C4) predicted independently by the sim
(`RESULTS.md`). Every entity type in the game is exercised except orbs.

## The app exists

`SPEC-007` and `SPEC-008` are built. **320 tests pass.**

- **Stage 1, `Cursor`** — `src/sim/cursor.ts`, pure, 122 lines. Every named
  value in the contract reproduced first time, corpus maxima 1 773 stops and
  1 849 cell edits both in `2-5 / "F 211g 98.3M win H [A]"`. Invariants 1-4 and
  oracle 1 pass over all 326 records, seeking all 195 000 stops.
- **Stage 2, assets** — `tools/atlas/build.ts` packs 67 sprites and the four
  bitmap fonts into one 883×64 atlas, 8 KB, gitignored in `build/`. Two are
  cells cut out of the game's marker sheet: the no-entry sign and the
  exclamation.
- **Stage 3, the UI** — Vite, React, one canvas, two panels. Through **four
  rounds of review by eye** (D24a), an MVP by iestyn's assessment. Both perf
  faults are fixed — four causes, D38-D41 — and **confirmed by eye 2026-09-02**
  (`TODO.md` §A5).
- **Route editing** is the **Action List** — a window of the route centred on
  the current action, naming each by what it did rather than where — plus the
  hover preview, the two badges, the game's no-entry sign for a refusal, and
  green/red once a route breaks. Not yet looked at. Segment editing is built
  and off while adding and removing actions is learned.

**The D32 reimplementation test ran** and found a real bug — in the docs, not
the code (D33). Looking at the app then found nine more: D24a earns its keep.

## Next

1. **Look at the editing UI.** D24a has never been used on it, and the **Action
   List** is what it has to judge. `docs/UI.md` §7 names what is open.
2. **Floor entry thresholds — the *number*.** Skippable segments are the
   predicate and they work; what is left is a search over it.
3. **The two open pieces of editing UX** — `TODO.md` §A6.
4. **Perf is deferred**, by decision (`TODO.md` §A5): long-range slider drags
   are still slow, short-range is fine, and no baseline until the harness's own
   two defects are fixed.

## Known blockers

None; the reverse-engineering phase is finished. Two limitations block nothing:

- **Gem gates never refuse, on purpose** (D46). A route carries a sentinel
  meaning "enough for every gate", because planning a route that becomes viable
  at a future gem total is a thing the player wants to do. The game will decline
  to load such a save until then, so the export notice names the gem cost and a
  route whose cost was changed here is named for it. Every other rule is checked
  exactly.
- Save **writing** from TypeScript is not byte-exact: Node's zlib and Love2D's
  make different choices (SPEC-006 §6). The payload underneath is exact both
  ways; only the compressed stream differs. The browser cannot use `node:zlib`
  at all, so the Vite build aliases it to `src/sav/zlib-browser.ts` (fflate,
  ~3 KB) while Node keeps the real one, and the tests exercise what ships.
