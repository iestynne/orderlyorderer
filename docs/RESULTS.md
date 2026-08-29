# RESULTS.md

Outcomes of savegame validation experiments. App version v0.7-455 unless noted.

| Test | Tower | Tests | Expected | Observed | Date |
|---|---|---|---|---|---|
| `INVALID-TEST` | 1-5 | Non-adjacent transition from a legal start tile | unknown | **"Load failed."** — clean refusal | 2026-08-26 |
| `INSUFFICIENT-POWER` | 1-5 | Attacking an undefeatable enemy | Load failed | **"Load failed."** | 2026-08-26 |
| `INSUFFICIENT-GOLD` | 2-1 | Gold Gate with an empty purse | Load failed | **"Load failed."** | 2026-08-26 |
| `INSUFFICIENT-LIGHT-KEYS` | 2-3 | Light Gate with no keys held | Load failed | **"Load failed."** | 2026-08-26 |
| `POP-UP-FORMAT` | 1-3 | Pop-Up Wall recorded as the step OFF the tile | Load succeeds | **Loaded, valid final state** | 2026-08-26 |
| `POPUP-TO-KEY` | 1-3 | Hypothesis A: pop-up exit encoded | loads | Loads, but undo/redo differs from play — **encoding rejected** | 2026-08-26 |
| `POPUP-TO-KEY-B` | 1-3 | Hypothesis B: pop-up ENTRY encoded | loads, undo/redo matches play | **Byte-identical to the hand-played save** | 2026-08-26 |
| `VORPAL-BLADE` | 1-5 | Held item defeats an otherwise unbeatable enemy | loads | **Loads fine** (originally mis-labelled SUFFICIENT-POWER) | 2026-08-26 |
| `SUFFICIENT-POWER` | 1-5 | Two Slimes beaten by raw power, no held item | loads | **Loads; undo/redo as expected** | 2026-08-28 |
| `KEYSMASHER-2L-3D-TEST` | 2-3 | Keysmasher bonus is added to the base, not instead of it | +11 | **+11** | 2026-08-28 |
| `KEYSMASHER-NEG-KEYS-TEST` | EX-3 | `negative_keys` Keysmasher bonus is `keys²` | +24 | **+24** | 2026-08-28 |
| `HYPER-PICKAXE-WEAK-TEST` | 2-3 | Weak Wall spends the ordinary Pickaxe first | ordinary spent | **ordinary spent, Hyper retained** | 2026-08-28 |
| `SUFFICIENT-GOLD` | 2-1 | positive control | loads | **Loads fine** | 2026-08-26 |
| `SUFFICIENT-LIGHT-KEYS` | 2-3 | positive control | loads | **Loads fine** (reachability caveat resolved) | 2026-08-26 |

## The simulator agrees with the game — 2026-08-28

The two primary oracles of SPEC-004 §11, run against iestyn's own save corpus
(14 towers, `data/saves/iestyn.2026.08.28/`):

| Oracle | Result |
|---|---|
| **1. Zero-error replay sweep** | **326 / 326 records replay with no error**, over 14 towers and ~470 000 simulated moves |
| **2. Hi-score** | **14 / 14 towers reproduce the `score` file exactly**, to the digit |

Oracle 2 is the strong one. It compounds every power-changing rule in the game
over a complete run and compares one number against the game's own record; a
single wrong rule anywhere moves it. The sim also derives, unprompted, that the
eleven numbered towers were Dark Crown runs (score = `power × 2`) and the three
EX towers plain Crown runs (score = `power`) — matching iestyn's recollection
without being told.

Coverage is broad rather than incidental: the sweep exercises every entity type
in the game except orbs, including 1 392 Reinforced-wall digs, 1 848 Battle
Gate entries, 8 416 pop-ups, 7 135 Gem Gates and all four one-way directions.

### Hand-played experiments, C1-C4

Each played in the real game, then predicted independently by the simulator from
map data alone.

| # | Test | Observed in game | Simulator |
|---|---|---|---|
| C1 | `1-5.SUFFICIENT-POWER.sav` | Loads; undo/redo as expected | replays clean |
| C2 | Keysmasher, 2 Light + 3 Dark keys, vs a 5-power enemy | **+11** | **+11** (step 149, power 45 → 56) |
| C3 | EX-3 `negative_keys`, Keysmasher, 7 keys, vs a −25 enemy | **+24** | **+24** (step 4195, −25 + 7² = 49) |
| C4 | Weak Wall holding both a Pickaxe and a Hyper Pickaxe | ordinary Pickaxe spent | ordinary Pickaxe spent, Hyper retained |

C2 confirms the Keysmasher bonus is **added to** the enemy's base rather than
replacing it — the HUD shows only the bonus, which is why it reads otherwise in
play. C3 is the first exercise of the `negative_keys` key system anywhere in the
corpus, and validates the squared bonus.

**C4 was settled twice, independently.** iestyn's recollection from The Orderly
Order was that the Hyper Pickaxe is spent first. The Lua says otherwise
(`game.lua:1460`: the Hyper branch is an `elseif` on `pickaxes == 0`), and so
does the corpus: flipping the precedence in the simulator drops the replay sweep
from 326/326 to **324/326**, both failures being `NEED_HYPER_PICKAXE` at a
Reinforced wall in tower 2-3 that the player demonstrably reached with the Hyper
Pickaxe still in hand. The hand-played test then agreed. Worth recording as a
method: **a large corpus of real routes is itself a discriminating oracle** — a
wrong rule that any recorded run depends on will break that run.

## Every tile confirmed against the game — 2026-08-28

SPEC-004's oracle 3, the fiercest check in the project. The hi-score oracle
compares one number per tower; this compares **every tile**.

Two final-state map exports, each replayed in the simulator and compared cell
for cell:

| Tower | Route | Steps | Cells compared | Differences |
|---|---|---|---|---|
| 2-5 The Orderly Order, 32 floors | `F 211g 98.0M win H[A]` | 6 327 | **7 199** | **0** |
| 1-6 Adventurer's Exam, 25 floors | `747M C2 win` | 10 632 | **5 423** | **0** |

**12 622 cells, zero disagreements.** Masked: 1 cell in 2-5 (the player, whose
marker composites over whatever is beneath it) and 202 in 1-6 (the player plus
five tutorial textboxes).

Run two ways, both passing:

1. **Partition check.** Group the image's cells by what the sim says each should
   be, and assert every group is byte-identical. 47 distinct kinds in 2-5, 40 in
   1-6, each with exactly one rendering.
2. **Two tower JSONs, structurally diffed** — the shape SPEC-004 §11 asked for.
   The simulator emits a final-state tower JSON; the PNG extractor emits one
   independently; they are compared cell for cell. **The extractor consults the
   simulator for nothing**, which is what makes agreement evidence rather than
   tautology.

`[F]` The only band collision in either tower is `empty == wall:0`: a cell the
route emptied renders identically to floor that was always empty. A confirmation
of the model, not a defect.

`[F]` Two findings from building it, both recorded in SPEC-005 §5.2:

- **The dictionary anchor cannot be a majority vote.** A route consumes *most*
  keys, pickaxes and low-tier enemies, so for those kinds the majority band is
  the empty one and every survivor reads as changed. The exact anchor uses the
  three-outcome rule instead.
- **Textbox coordinates carry the panel translation** of `(+4, +8)`. Without it,
  1-6 reports spurious inconsistencies in the cell row below each tutorial box.

## A TypeScript-written save loads in the game — 2026-08-28

`1-5.TS-ROUNDTRIPPED.sav` — all 36 records of `1-5.sav` parsed and re-emitted
through the TypeScript codec, 26 511 bytes against the original 26 456 —
**loads normally**.

Node's deflate does not reproduce Love2D's byte-for-byte (82 of 326 records
match), but the payload underneath is identical in all 326, and `inflate`
accepts any valid `deflate` stream. So **exporting a route to the game works**,
which is the app's primary purpose.

What is lost is byte-comparison against an original as a verification
technique — the one that settled D17 and the pop-up encoding. The replacement,
per SPEC-006 §6, is: the emitted payload must match byte-for-byte, and the file
must load.

## Obtaining royal_boon2 would not invalidate existing routes — 2026-08-28

The `level_scripts.lua` finding (`GAME_MECHANICS.md` §9.1) raised a real worry:
the 2-1 script **raises ten Weak Walls to Reinforced**, which would break any
route that had dug through them.

Simulated rather than feared. Replaying the whole corpus with `royal_boon2`
hypothetically unlocked and the real per-tower crown tiers:

| | |
|---|---|
| as the account actually is | **326 / 326 clean** |
| with `royal_boon2` unlocked | **326 / 326 clean** |

And the reason is structural, not luck: across the 11 towers with Rapier
scripts, **no route ever enters any of the 59 cells a script edits**. The vaults
are sealed regions containing nothing until the boon opens them, so no route
ever had a reason to go there. The design is safe by construction.

`[F]` Confirmed alongside: the `crown` file's per-tower tier agrees with the win
state our simulator derives from each hi-score route — 14/14, two entirely
independent sources.

## Established by reading the loader, not by experiment

**One-way walls are never validated on load, so the one-way pathing setting is
editor-only.** `save_manager.lua:629-654`: before replaying a move, the loader
scans the target cell for a `barrier_*` entity; if it finds one it sets
`success = true` and places the player there directly, skipping `Game:step`
entirely. The `pathfind_oneways` setting is not consulted anywhere in the replay
path.

This retires what was previously the highest-priority remaining experiment
("load `1-5_ONE-WAY-ENCODING-2.sav` with the checkbox OFF"). The setting does
**not** need to travel with a shared route.

**The loader sets `player.floor` directly and never traverses stairs.** Same
loop, line 619. So it performs no cross-floor reachability check at all, which
makes our simulator strictly stricter than the game's own loader — triage a
cross-floor `NO_PATH` before assuming it is our bug (SPEC-004 §5.3).

## Established

**The loader validates by re-simulation, not geometry.** All three
`INSUFFICIENT-*` tests were refused, each for a different resource — power, gold
and keys. A geometric check could not distinguish them, so the loader must be
replaying the route and checking affordability at each step.

**Therefore a successful load is strong evidence our simulator agrees with the
game.** This is the project's strongest oracle and it is now confirmed rather
than assumed.

**A load being accepted does not confirm the encoding is canonical.** Both
pop-up encodings loaded and reached a correct final state; only one matches what
the game itself writes. The game tolerates more than one encoding of a route, so
acceptance proves legality, not equivalence.

**Diffing against a hand-played save is the test that settles encoding
questions.** `POPUP-TO-KEY-B` reproduced the game's own triples exactly. This is
the first artifact we have generated that is byte-identical to one the game
wrote, and it is the pattern to reuse for every future encoding question.

## Why these matter

`INVALID-TEST` established that the game validates on load rather than trusting
the file. The three `INSUFFICIENT-*` tests establish **how deep** that validation
goes. If the loader re-simulates and checks affordability, a successful load is
near-proof that our simulator agrees with the game, and the savegame round-trip
becomes the project's strongest oracle. If it only checks geometry, the backstop
is much weaker and we must carry that validation ourselves.

`POP-UP-FORMAT` is different in kind: it is not a validation probe but a test of
an unverified assumption in `SAVE_FORMAT.md` 5 — that a Pop-Up Wall's recorded
pair is the move *off* the tile, the one case where the pair's `from` is the
tile that changed rather than its `to`.
