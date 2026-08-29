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
| `SUFFICIENT-POWER` | 1-5 | Two Slimes beaten by raw power, no held item | loads | _not yet run_ | |
| `SUFFICIENT-GOLD` | 2-1 | positive control | loads | **Loads fine** | 2026-08-26 |
| `SUFFICIENT-LIGHT-KEYS` | 2-3 | positive control | loads | **Loads fine** (reachability caveat resolved) | 2026-08-26 |

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
