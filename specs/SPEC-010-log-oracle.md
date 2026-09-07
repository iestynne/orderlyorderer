# SPEC-010 — Log oracle: validating the simulator against the game's own log

Status: **draft 1**, 2026-09-06. Not started.
Depends on: SPEC-006 (the `.sav` codec), SPEC-004 (the simulator).

**Docs to load:** `SAVE_FORMAT.md` §2 (the container — this spec only ever
touches the top level of it). Not `GAME_MECHANICS.md`, not the UI specs.

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

---

## 1. Why

Towers of Scale writes `logs/log1.txt` unconditionally — no flag, no dev build.
It records **every floor transition and every item obtained or consumed**, in
order. That is a second oracle on the simulator, independent of the two in
SPEC-004 §11: those compare a final *number*, this compares the *ordering* that
produced it. A route reaching the right score by the wrong path passes both
existing oracles and fails this one.

`[F]` **It needs no hand-played run.** `save_manager:load` replays a savestate's
move list through the real engine, and the `entitydef` interact logs fire during
that replay — `g_sfx.lock` silences the audio, not the logger. So loading a save
emits that whole route's trace.

`[I]` **This is an occasional sanity check, not a build step.** It costs iestyn
a manual pass through the game, so the design goal is to make that pass as short
as possible and everything either side of it automatic.

## 2. The process

`[I]` iestyn's, 2026-09-06. Steps 2, 3 and 6 are scripted; 1, 4, 5 and 7 are his.

| # | Who | Step |
|---|---|---|
| 1 | iestyn | Back up the real saves folder, moving the files elsewhere |
| 2 | script | Generate the `TEST` corpus (§3). Always, not conditionally — it is seconds |
| 3 | script | Copy the corpus into the game's `savestates/`, renamed (§4) |
| 4 | iestyn | Run the game; in each tower, load its single save. **Main menu order** |
| 5 | iestyn | Exit the game |
| 6 | script | Parse `log1.txt` and compare against the simulator (§5, §6) |
| 7 | iestyn | Restore the original saves |

`[D]` **Steps 1 and 7 are scripted too, as `deploy` and `restore`.** They are
iestyn's decision to take, but a forgotten step 7 followed by a later step 3
would overwrite the backup with test data and lose the real saves permanently.
§4 makes that unrepresentable rather than merely documented.

## 3. The corpus

One route per tower, **pruned from the originals, not authored**. iestyn's own
files hold dozens of routes each and the cost of this exercise is UI navigation,
not replay; a single entry per tower means the load is: enter tower, `f5`,
confirm, back out.

`[D]` **The route is the record named `AUTOSAVE_HISCORE`.** It exists in all 14
towers that have saves, and `test/sim/oracles.test.ts` already asserts its score
reproduces the `score` file exactly, so the selection needs no search and no
judgement. It is also the richest route in each tower — a Dark Crown doubles the
score, so the hi-score run is the one that visits the most.

`[F]` **Pruning is a container operation.** The top level of a `.sav` is
`name -> value` (`SAVE_FORMAT.md` §2): read it, drop every key but
`AUTOSAVE_HISCORE`, rename that key to `TEST`, write it back. The blob is copied
**verbatim** — nothing is re-compressed — so **SPEC-006's write asymmetry
(`TODO.md` B1) does not apply**, and the output is byte-exact by construction.
Keep the record's value in whichever shape it already has (bare blob, or the
`time`/`data` table); the game's loader takes both.

`[D]` **Generated, not committed.** Output goes to `build/test-corpus/`, which is
gitignored, rebuilt on every deploy. It is derived data over
`data/saves/iestyn.2026.08.28/`, which is already in the repository.

## 4. The swap

`[F]` **The name on disk is not ours to choose.** `SaveManager.new` builds
`path = "savestates/"..tower_name..".sav"` from the map filename
(`save_manager.lua:26`), so the game opens `savestates/1-1.sav` exactly and will
never see a file named anything else. The repo-side name `1-1.TEST.sav` is for
telling the corpus apart from the originals; **the deploy step strips `.TEST`**.

`[F]` **Only `savestates/` moves.** Not the whole save directory, and **not via a
fresh `t.identity`**: a new save directory means empty `score`, `crown` and
`unlocks`, and `Game.new` calls `get_total_gems` and `get_total_crowns` at stage
start (`game.lua:479-480`), which read all three (`util.lua:61-96`). Both would
come back 0, every gem door would be unopenable, and the replay would die on
`found illegal move` before proving anything. The empty `unlocks` would also drop
the boon flags, so `level_scripts` would stop injecting Rapiers.

`[D]` **`deploy` refuses when a backup already exists.** That state means a
previous `restore` never ran, and proceeding would overwrite the only copy of the
real saves. It is the one irreversible failure in this process, so it is refused
rather than warned about.

`[D]` **`deploy` also refuses when the target `savestates/` holds a `.sav` the
corpus does not name.** A stray tower file would be left in place and loaded at
step 4, producing a trace with no prediction to compare it against.

## 5. The parser

`[F]` **The log is delimited, so the parser does not have to be clever.**

| Line | Source | Meaning |
|---|---|---|
| `loading savestate: TEST` | `save_manager.lua:586` | opens a route's trace |
| `switching the gamestate` | `:670` | closes it — replay succeeded |
| `found illegal move, returning...` | `:657` | appears **instead of** the terminator: the game rejected the route |
| `checking for the level script for tag <tag>` | `game.lua:524` | names the tower |
| `moved to floor N` | `entitydef.lua:30,46,65,94` | floor transition |
| `<item> obtained` / `<item> consumed` | `entitydef.lua`, 22 further lines | the item events |

`[F]` **The tag line is emitted twice per load** — once when iestyn enters the
tower, again when `SaveManager:load` builds a fresh `GsGame` for the replay.
**Segment on the savestate line, not the tag line**, and take the tower from the
nearest preceding tag line.

`[F]` **One log holds the whole session.** Rotation happens at *launch*
(`logger.lua:10-13`), not per load, so all 14 traces land in one `log1.txt`.

## 6. What is compared

For each of the 14 towers the simulator replays the same route and emits the same
two event kinds in order. The comparison is on that sequence.

**Out of scope, and why**

| Not compared | Why |
|---|---|
| Position, per move | The log records floors, not cells. The replay oracle (SPEC-004 §11) already covers movement |
| Power, per step | Not logged at all |
| The in-run stats screen's 24 counters | Drawn, never written to a file. `TODO.md` §G holds it as the unbuilt second oracle |

`[O]` Which item events the simulator can already emit in this form. Some are
`entitydef` side effects it models without naming, so the mapping is part of
building this and is not settled here.

## 7. Verification Contract

```
Run: npm test && npm run typecheck
Report: PASS/FAIL per named case; the tower count at each stage; any file
        touched outside tools/logcheck/, test/logcheck/, build/test-corpus/
```

| Case | Expected |
|---|---|
| 1. Towers with an `AUTOSAVE_HISCORE` record in `data/saves/iestyn.2026.08.28/` | **14** |
| 2. Files written by `prune` | **14**, named `<tag>.TEST.sav` |
| 3. Records in each pruned file | exactly **1**, named `TEST` |
| 4. Its blob vs `AUTOSAVE_HISCORE`'s blob in the source file | **byte-identical** |
| 5. Re-reading a pruned file with the SPEC-006 codec | parses; route equals the source record's route |
| 6. `deploy` with a backup directory already present | **refuses**, non-zero exit, nothing written |
| 7. `deploy` with an unnamed `.sav` in the target | **refuses**, non-zero exit, nothing written |
| 8. `restore` after `deploy` | save directory byte-identical to before `deploy`; backup directory gone |
| 9. Parsing a recorded fixture log | **14** segments; each has a tower, and a terminator or an illegal-move line |
| 10. Comparison on that fixture | **14/14 match** |
| 11. Diagnostic (D18): swap two adjacent item events in the fixture log | that tower **fails**, the other **13 pass** |

**Invariants**

1. **`restore` is total.** After it the game's save directory is byte-identical
   to its state before `deploy` — checked over the whole directory, not only
   `savestates/`. Anything less means this process can lose iestyn's data.
2. **A missing corpus is a skip, not a failure.** `data/saves/` is iestyn's and
   may not be present; cases 1-5 skip together and say so, as `haveSaves` does.
3. **Nothing from `../local/game/` enters the repository.** The case 9 fixture is
   generated output read from under `build/`, never a file copied out of the game
   archive.
