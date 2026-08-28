# SPEC: Game Simulation Engine

Status: **draft 5 — ready for implementation**, 2026-08-28.
Game source verified against: `v0.7455` Lua dump.

Provenance legend used throughout:
- `[F]` **fact — empirically validated**: inspected save files, exported map
  PNGs, screenshots, or Lua source. Evidence cited inline.
- `[I]` iestyn said it — recalled from play experience, not re-verified.
  Reliable but not evidence. Promote to `[F]` when cheap to check.
- `[D]` decision — agreed design choice for this app.
- `[P]` proposal — my suggestion, not yet validated.
- `[O]` open — unresolved; implement the stated default and flag it.

`[D]` We match the game's **logical outcomes**, not its data structures or
control flow. Where this spec cites Lua, it is citing evidence of behaviour,
not prescribing an implementation.

**Suggested implementation order:** §11 step 0 (pre-verification) → §3 types →
§6 rules → §5 pathfinder → §4 pipeline → §11 oracles.

---

## 1. Scope

Pure TypeScript module, no UI imports, no I/O. Given a tower's initial state,
starting player stats, and an ordered list of **waypoints**, produce a
step-by-step timeline of tower and player state, or the first point at which
the route becomes invalid.

**Deliberate omissions.** `[I]` None appear in any current test save:

| Entity | Reason |
|---|---|
| `orb_force`, `orb_change`, `orb_warp` | not yet understood |
| `rapier` | not yet understood |
| `royal_boon1` | affects gem gain only, which we don't model |
| `royal_boon2` | not yet encountered in play |
| `stairs_up_ex_4`, `stairs_down_ex_4` | tower EX-4 not yet in the game |

Do not implement or research these. The tower parser must round-trip them
without loss; the sim must raise `UNSUPPORTED_ENTITY` rather than guess.

Also out of scope for v1: PNG parsing, route segment editing UI (see
DESIGN_ROUTE_EDITING.md).

---

## 2. Inputs and the route model

```ts
interface SimInput {
  tower: Tower            // parsed tower JSON, immutable
  gemsOwned: number       // total gems owned entering the tower; see §10.1
  route: Waypoint[]
}
type Waypoint = { z: number; x: number; y: number }   // absolute target cell
```

`[D]` **A route is a list of state-changing actions, not a list of moves.**
This mirrors the game exactly and radically shortens the history: passive
walking between actions is reconstructed by the pathfinder (§5) rather than
stored. Sim cost and memory fall proportionately.

`[F]` This is the game's own save format. `SaveManager:save` walks
`undo_history` and, per entry, writes the player's position *before* the action
and then the acted-upon entity's position — the "coordA → coordB" pair — as
`{floor, x, y}` triples, zlib-compressed behind a magic header. The list ends
with the player's live position at save time, offset by ±1 floor if they are
standing on stairs. `[F]` The file contains **no player state** — no power,
gold, or keys.

`[F]` **Stairs are never recorded.** `entitydef.stairs_up` has no `undo_store`,
so it creates no undo item and never becomes a waypoint. Floor changes are
therefore implicit, and our pathfinder must traverse stairs itself (§5).

`[F]` **Axis convention:** `x` east, `y` **downward**, `z` up. Proven by the
one-way wall predicates (§6).

`[F]` **Tower flags** are a bitfield in the level metadata
(`leveldata.lua:26-31`), tower-wide, not per-floor:

| Bit | Flag | Effect |
|---|---|---|
| 0 | `negative_keys` | Keysmasher bonus becomes `keys²` (§6) |
| 1 | `uncapped_elixirs` | removes the Elixir gain cap (§6) |
| 2 | — | an EX-4-only flag, deliberately unmodelled |

`[I]` `negative_keys` is used only by tower EX-3.

`[F]` Metadata also carries `crowns_needed`, `start_power`,
`start_floor/x/y`, and `grades` — the six score thresholds
`[C, B, A, S, ★, overscore]` that determine gem awards. Parse and retain them;
`grades` is the eventual route to computing `gemsOwned` (§10.1).

---

## 3. Core types

```ts
type Addr = number   // flattened: (z*15 + y)*15 + x

interface Player {
  z: number; x: number; y: number
  power: number; gold: number
  lightKeys: number; darkKeys: number; pickaxes: number
  gemsSpent: number                 // remaining = gemsOwned - gemsSpent
  held: HeldItem | null
  pendingPopup: Addr | null         // see §4.1
  killsOnFloor: Int32Array          // per-floor kill counts, for Battle Gates
  score: number
}

const enum CellState {
  Original   = 0,      // exactly as the tower JSON describes it
  Gone       = 1,      // entity removed / gate opened / wall destroyed
  Reinforced = 2,      // pop-up walls only: converted to a Reinforced Wall
}

interface CellEdit { addr: Addr; before: CellState; after: CellState }

interface Step {
  waypointIndex: number   // which route entry produced this move
  from: Addr; to: Addr
  edits: CellEdit[]
  player: Player          // state AFTER this move
  requirement: number     // power this move demanded; 0 if none. See §8.
}

interface Timeline {
  tower: Tower
  initial: Player
  steps: Step[]           // move granularity, expanded from route waypoints
  error?: SimError
}
```

`[D]` **Two parallel grids.**

- `tower.cells[z][y][x]` — the parsed tower JSON, **immutable**, holding the
  full readable record (kind, value, direction). This is the debuggable
  artifact: it is literally the file you can open and read.
- `state: Uint8Array` of length `15*15*D` — one `CellState` byte per cell.

Tile *parameters* — enemy power, gate cost, spike value, gold-bag amount — are
immutable for the whole run and are always read from `tower.cells`. The mutable
part of a cell is one small enum, and every rule reduces to setting it.

`[D]` A byte per cell, not a bit vector: three states are needed (pop-ups reach
`Reinforced` and can then be destroyed by a Hyper Pickaxe), and at 15×15×~25
floors the grid is ~5.6 KB — bit-packing saves nothing and costs readability.

`[D]` Player state is separate from cell state and is snapshotted whole per
step. `[F]` The game does the same: `Game:undo` restores a per-move player
record including `p_popup` (`game.lua:1397`).

`[D]` **Journal, not snapshots.** Each step records its cell edits plus the new
`Player`. Scrubbing from step *j* to *k* applies or undoes the edits between
them: O(|k−j|). Most steps make 0–2 edits, but one enemy kill can open several
Battle Gates at once (§6), so the edit list is **variable-length** — do not
assume a bound. `[I]` Orbs will widen it further when they arrive.

---

## 4. Resolving a waypoint

A waypoint means "get the player onto this cell". Resolution:

1. If the waypoint equals the player's current position, it is a **no-op**
   (this occurs routinely, since saves record the pre-action position and then
   the action target). Emit no steps.
2. Otherwise run the pathfinder (§5) from the current position to the waypoint.
   Failure → `NO_PATH`.
3. Execute **every** move of the returned path through the step pipeline below,
   emitting one `Step` each. Intermediate moves are passive by construction and
   produce no edits; the final move onto the waypoint is the action and is
   fully validated.

`[D]` The timeline is therefore at **move** granularity while the route is at
**waypoint** granularity. `Step.waypointIndex` maps back, so the UI can scrub
by move and edit by waypoint.

### 4.1 The step pipeline

Strict order. Phases 1–2 are pure predicates; nothing mutates until phase 3.

1. **Topology.** `to` is in bounds, on the same floor as `from`, and
   orthogonally adjacent to it.
2. **Entry test.** Evaluate the entry rule (§6) for the cell at `to` against
   the current player. Yields a `Cost` or a `StepError`. Nothing is consumed.
3. **Pay cost.** Decrement keys / gems / gold / pickaxes; consume the held item
   if the rule says so.
4. **Enter effect.** Apply the on-entry effect (§6): power change, pickup,
   score, cell edits — including any Battle Gates this kill opens, and
   `killsOnFloor` increment.
5. **Power cap.** `[F]` `power = min(power, MAX_POWER)`,
   `MAX_POWER = 999_999_999_999` (`game.lua:42, 1545`). Once per move, after
   effects, before the position commits.
6. **Position.** Set position to `to`. If the entered cell is Stairs Up/Down,
   set position to `(z±1, x, y)`.
7. **Pop-up commit** (§4.2).
8. **Assert** `1 <= power <= MAX_POWER`.

### 4.2 Pop-up walls — two transitions, not one

`[F]` `entitydef.lua:921-951`, `game.lua:1560-1569`. The cell genuinely becomes
empty while occupied; the black square in an exported map PNG is the real
state, not a rendering artifact.

**On entry** (phase 4), if the player does **not** hold a Levitation Feather:

- if `pendingPopup != null`, commit it now: that cell → `Reinforced`;
- the entered cell → `Gone`;
- `pendingPopup = addr(entered cell)`.

With a Feather held none of this happens: the cell is untouched, no pending is
set, and `[F]` the Feather is not consumed.

**On commit** (phase 7), *not* guarded by the Feather: if `pendingPopup` is set
and differs from the player's current address, that cell → `Reinforced` and
`pendingPopup` clears.

Phase 7 runs after the stairs teleport, so taking stairs off a pop-up commits
it (the game compares floor as well as x/y). Stepping from one pop-up directly
onto another commits the first inside phase 4, which is why a single-slot
register suffices. `pendingPopup` is player state, journaled with the rest, so
undo and scrubbing handle it for free.

---

## 5. The pathfinder

`[D]` Reachability validation is **mandatory**, not an optimisation. Without
it the sim would accept routes that bypass locked gates, and every guarantee in
this document would be void.

`[F]` The game does the same thing — `game.lua:1108`, *"determine move
legality with motherfucking flood fill/bfs lul"* — a BFS with parent pointers,
called from `Game:step(dx, dy)` whenever the target is not adjacent.

### 5.1 Contract

```ts
function pathfind(cells: Uint8Array, tower: Tower, player: Player,
                  target: Waypoint): Addr[] | null
```

Returns the sequence of cells to move through, ending with `target`, or `null`
if no passive route exists.

`[D]` **Pathfinding is passive.** It never changes tower state and never spends
a resource: it will not open a Light Gate, pick up an item, or fight anything.
Every such interaction is a recorded waypoint of its own.

`[F]` **The target cell is exempt from traversability.** The game's
`check_neighbour` opens with `if xx == target_x and yy == target_y then return
true` — the destination is accepted unconditionally. This is what makes the
passive/explicit split work: the pathfinder needs no knowledge of keys or
gates, because the only cell where a state change happens is the one it does
not inspect. The final move's legality is decided by §4.1.

### 5.2 Traversability

A non-target cell is traversable iff entering it would cause **no cell edit and
no player-state change**:

| Cell | Traversable |
|---|---|
| Empty / floor | yes |
| Weak / Reinforced / Iron wall | no |
| One-way wall | yes, iff entered from an allowed side (§6) |
| Pop-Up Wall | only while holding a Levitation Feather |
| Spikes | only while holding a Levitation Feather |
| Stairs Up / Down | yes — see §5.3 |
| Anything else (enemies, gates, items, crowns) | no |

`[F]` The pop-up/spikes exception is exactly the set of entities the game marks
`feather_pathfind = true` — verified to be `{popup, spikes}` and nothing else.

`[F]` Items block pathfinding, correctly: picking one up is a state change and
is therefore its own recorded waypoint.

`[D]` **No exit restriction on one-way walls.** The game applies one only when
its `pathfind_oneways` setting is off; with the setting on, entry direction is
the sole constraint — which also matches the actual move rules, where
`can_interact` gates entry only. We implement the permissive, rule-accurate
behaviour unconditionally. `[D]` Our pathfinder is deterministic and has no
settings.

### 5.3 Stairs and cross-floor routing

`[D]` Our pathfinder crosses floors; the game's does not. Entering a stairs
cell at `(z,x,y)` relocates the player to `(z±1,x,y)`, so the BFS edge from a
neighbour of the stairs leads directly to that arrival node, at cost 1. The
arrival cell must itself be traversable for the edge to be usable.

`[F]` **This makes our sim stricter than the game's own loader**, which sets
`player.floor = moves[i][1]` directly, with no stairs traversal and no
cross-floor reachability check whatsoever (`save_manager.lua`, replay loop).
A genuine save always has a real stairs route, since the player walked it — so
a `NO_PATH` failure across floors means either a bug in our stairs model or a
save that was never legitimately reachable. **Triage before "fixing" the sim to
accept it.**

`[F]` The loader also special-cases one-way walls: if a waypoint's cell holds a
barrier it places the player there directly, skipping validation entirely. That
is what `ignore_illegal_on_save` buys — a waypoint can be a cell the player was
merely standing on, and the loader's chosen approach may not match the
original. `[D]` We do not copy this: we path to such cells legitimately, and
report failure if we cannot.

### 5.4 Implementation

`[D]` **BFS with a FIFO queue — not a priority queue.** Every move costs 1,
stairs included, so breadth-first order already yields shortest paths.

- Scratch: one `Int32Array[15*15*D]` of step counts, wiped per call. `[D]` A
  generation counter was considered and rejected as unnecessary complexity: at
  waypoint granularity there are a few hundred pathfind calls per run, not tens
  of thousands.
- Early-exit the moment the target is reached.
- Parent pointers for path reconstruction.
- `[D]` **Fixed neighbour expansion order** (up, right, down, left, then
  stairs) so the chosen path is reproducible — the determinism invariant (§9)
  depends on it.

`[P]` If profiling later shows this dominates, cache by invalidating on any
cell edit or change of held item. Do not build it speculatively.

---

## 6. Cell rules

`tier(p)` = decimal digit count of `|p|`, capped at 10. `[F]` The game computes
it as a `while val >= 10 and tier < 10` division loop. `[D]` Implement by
repeated division or string length — **never** `Math.log10`, which returns
2.9999… for 1000 on some inputs.

### Enemies

Entry requires `power > |enemy.power|` (strict), unless a Vorpal Blade is held,
which always succeeds. `[I]`

`[F]` The held-item branches are a single `elseif` chain in the game's enemy
`interact`, which formally confirms mutual exclusivity and makes ordering
between them unreachable.

```
base = enemy.power                                  // signed; negative for enemy_neg
if held == VorpalBlade:              delta = 0;                    consume
elif held == BlackRod && base > 0:   delta = base * 2;             consume
elif held == WhiteRod && base < 0:   delta = -base;                consume
elif held == AdamantineShield:       delta = Math.floor(base / 2)
elif held == Keysmasher:             delta = base + keysmasherBonus()
else:                                delta = base
power += delta

goldGain = tier(|enemy.power|)
if held == GoldDagger:      goldGain += 2
if held == GoldenClaymore:  goldGain *= 2
gold += goldGain

cell -> Gone;  killsOnFloor[z] += 1
// then: every Battle Gate on this floor re-evaluates (below)
```

`[F]` The Adamantine Shield applies **signed floor**, not round-toward-zero:
+5 → +2, +25 → +12, **−25 → −13**. Confirmed twice — measured in-game on tower
2-2 floors 8 and 9, and read as `modify_player_power(math.floor(base/2))`.

`[F]` **Keysmasher:** `keysmasherBonus() = negative_keys ? lightKeys²
: lightKeys * darkKeys`. The Lua adds this **to** the enemy's base value.
`[O]` The HUD's `get_held_value` displays only the bonus, which is likely why
it reads as bonus-only in play. **Testable:** with 2 Light and 3 Dark Keys,
kill a 5-power enemy — power should rise by **11**, not 6. Settle before
relying on any power numbers downstream.

`[I]` Vorpal Blade is consumed on the next attack of any kind, not only on
attacks the player would otherwise lose. `[I]` The Shield halves the power
*change* but never the power *required* to win.

### Battle Gates

`[F]` `entitydef.battle_gate`. A gate carries a countdown `value`. Every enemy
defeated **on the same floor** decrements every Battle Gate on that floor; any
gate reaching 0 opens. A Master Key also opens one directly (`can_interact` is
`held_item == "master_key"`); otherwise it simply blocks.

`[D]` Cell state stays uniform — an open gate is `Gone` in the mask like
everything else, so tile queries need no special case. Only the kill step does
the arithmetic, using `killsOnFloor[z]` against each gate's initial value, and
emits one `CellEdit` per gate that opens.

### Gates

All become `Gone` when opened. `[I]`

| Cell | Cost | Master Key |
|---|---|---|
| Light Gate (`door`) | 1 Light Key | substitutes, consumed |
| Dark Gate (`dark_door`) | 1 Dark Key | substitutes, consumed |
| Gold Gate (`money_door`) | `value` Gold | substitutes, consumed |
| Half Gate (`gate`) | `power = ceil(power / 2)` | substitutes, consumed, power unchanged |
| Battle Gate | see above | `[F]` opens it, consumed |
| Gem Gate (`gem_door`) | `value` gems (`gemsSpent += value`) | **does not apply** `[I]` |

`[I]` Master Key consumption is **non-optional**: it is spent even when the
player has the ordinary key to spare. True of every item except Orbs.

`[F]` Gems are tracked as **spent**, not remaining (`player.gems_spent`) —
necessarily, since a save must load correctly after the player earns more gems
elsewhere, and gems are never lost.

`[I]` Gem Gates cluster on dedicated floors but also appear mid-route
(2-1 f10; 1-6 f21 and f17).

### Walls

| Cell | Entry |
|---|---|
| Weak Wall | 1 Pickaxe, or Hyper Pickaxe (consumed) → Gone |
| Reinforced Wall | Hyper Pickaxe only (consumed) → Gone |
| Iron Wall | never |
| Pop-Up Wall | always enterable; §4.2 |
| One-Way Wall | below |

`[F]` **One-way walls** (`entitydef.lua:954-1000`). The direction letter names
the **blocked side**:

| Cell | Enterable when | blocked from |
|---|---|---|
| `barrier_u` | `player.y >= ent.y` | above |
| `barrier_d` | `player.y <= ent.y` | below |
| `barrier_l` | `player.x >= ent.x` | the west |
| `barrier_r` | `player.x <= ent.x` | the east |

`[F]` Three of four approaches are always allowed; the cell is not consumed
(`interact` returns `true` and changes nothing) and there is no exit
restriction — `can_interact` gates entry only.

### Items and terrain

| Cell | Effect on entry | Cell after |
|---|---|---|
| Light Key / Dark Key / Gold / Pickaxe | increment counter by `value` | Gone |
| Gold Bag (`money`) | `gold += value` | Gone |
| Elixir | below | Gone |
| Held Item | previous held item **destroyed** `[I]`, new one held | Gone |
| Crown | `score = max(score, power)` | **persists** `[I]` |
| Dark Crown | `score = max(score, min(power*2, MAX_POWER))` | **persists** `[I]` |
| Spike (`spikes`) | below | **persists** `[I]` |
| Stairs Up / Down | teleport (§4.1 phase 6) | unchanged |
| Empty / floor | none | unchanged |

`[F]` **Elixir:** the gain is capped independently of the global power cap —
`power += min(power, 1_000_000_000)`, unless the tower's `uncapped_elixirs`
flag is set, in which case `power += power`. At 3e9 power a normal Elixir
yields 4e9, not 6e9.

`[I]` **Spike:** with a Feather held, entry is always legal, no damage, Feather
not consumed — the power check is skipped entirely. Without it, entry requires
`power > value`, then `power -= value`. Spikes persist and can be re-triggered.

`[F]` **Crowns** set a win flag and submit a score: Crown submits `power`
(win = 1), Dark Crown `min(power*2, MAX_POWER)` (win = 2)
(`entitydef.lua:855-901`). `[I]` Neither ends the run — the player may rewind,
change things, and reach the other — so both cells persist.

`[P]` Track prospective score every step (`power` and `min(power*2,
MAX_POWER)`) so the UI can show anticipated Crown / Dark Crown value without
mental arithmetic. Only Crown entry commits it to `score`.

---

## 7. Errors

`[D]` Errors are reported **per step**, with the waypoint index attached.
Failures routinely land mid-segment — most often insufficient power for an
attack — and reachability is checked at every step, identically, everywhere.
Segments (DESIGN_ROUTE_EDITING.md) are a UI convenience and carry no validation
semantics.

```ts
interface SimError {
  waypointIndex: number
  stepIndex: number | null   // null when the failure is NO_PATH
  code: ErrorCode
  at: Waypoint
  have?: number
  need?: number
}
type ErrorCode =
  | 'NO_PATH' | 'OFF_MAP' | 'NOT_ADJACENT'
  | 'BLOCKED_IRON' | 'BLOCKED_ONE_WAY' | 'BLOCKED_BATTLE_GATE'
  | 'NEED_LIGHT_KEY' | 'NEED_DARK_KEY' | 'NEED_GEMS' | 'NEED_GOLD' | 'NEED_PICKAXE'
  | 'ENEMY_TOO_STRONG' | 'SPIKE_TOO_STRONG'
  | 'UNSUPPORTED_ENTITY'
```

`[D]` Simulation stops at the first failure. State afterwards is undefined, so
"collect all errors" is not offered; the UI points at the first break and the
user repairs forward.

`[D]` Validation is **always on**. There is no fast path that skips it for
edits that only add resources; the performance answer is to make full
re-simulation fast enough for the hard cases.

---

## 8. Timeline API

```ts
function simulate(input: SimInput): Timeline
class Cursor {
  constructor(t: Timeline)
  readonly index: number
  seekTo(k: number): void            // applies/undoes edits, O(|k - index|)
  readonly cells: Uint8Array
  readonly player: Player
}
```

**Retain each step's requirement.** Phase 2 computes what the move demanded
(power to beat the enemy, power to survive the spike) and would otherwise
discard it. `Step.requirement` is the input to the power-graph margin track
(DESIGN_ROUTE_EDITING.md §4): drawn as a floor the power curve must stay above,
it turns "how much power can I give up before this route fails" into a visual
question.

`[P]` Derived metrics split in two:
- **Running scalars** — enemies remaining, total enemy power remaining, keys —
  are O(1) to maintain and may live in the step record if profiling wants them.
  `killsOnFloor` is already one of these.
- **Derived queries** — reachable gold, which enemies are now passable, with or
  without Dagger/Claymore — are graph searches computed on demand from the
  cursor. Keep them out of the step record.

---

## 9. Invariants

Assert in debug builds; test as properties (§11).

1. `1 <= power <= MAX_POWER` at every step. The lower bound is **emergent, not
   clamped**: enemy entry requires `power > |e|`, so post-combat power ≥ 1 even
   under the Shield's floor (`power − ceil(|e|/2) ≥ |e|+1 − ceil(|e|/2) ≥ 1`);
   Half Gate ceils; Spike requires `power > value`. `[F]` The upper bound *is*
   clamped (`game.lua:1545`).
2. `gold, lightKeys, darkKeys, pickaxes >= 0` and `0 <= gemsSpent <= gemsOwned`.
3. Every `CellEdit` is a legal transition. `[D]` A two-line function, not a
   table: `Original → Gone` for everything, plus `Original → Reinforced` and
   `Reinforced → Gone` for pop-ups only. `[I]` The pop-up chain is real and was
   load-bearing in a best Orderly Order run.
4. Each step moves the player to an orthogonally adjacent cell, or a stairs
   teleport (same `x,y`, `z ± 1`).
5. `pendingPopup` is null, or refers to a `Gone` cell the player stands on.
6. Battle Gate consistency: a gate is `Gone` iff `killsOnFloor[z] >=
   initialValue`, or it was opened by a Master Key.
7. Intermediate (non-final) steps of a waypoint's path produce **zero** cell
   edits and change no player field but position. This is the pathfinder's
   passivity, stated as an assertion.
8. **Journal fidelity:** for any `k`, `Cursor.seekTo(k)` yields cells identical
   to a fresh `simulate` truncated at `k`. This is what makes the cheap journal
   trustworthy in place of per-step snapshots.
9. **Determinism:** simulating the same input twice yields identical timelines
   — including identical paths, which is why §5.4 fixes the expansion order.
   Its real yield is catching a state object mutated in place and aliased
   across steps.

---

## 10. Open items

1. `[O]` **Gems.** The save records `gemsSpent`; total owned derives from best
   score per tower against the metadata `grades` thresholds. Until the scores
   table is modelled, `gemsOwned` is a required `SimInput` field surfaced as a
   UI input.
2. `[O]` **Keysmasher total vs bonus** — §6. Resolve empirically first.
3. `[O]` **Stairs arrival cell.** Assumed always enterable terrain; the sim
   asserts this rather than re-running the arrival cell through the entry
   rules. If the assertion fires, phase 6 must recurse into phase 2.
4. `[O]` Does any cell in any tower carry both a wall and an entity? §11 step 0.
5. Orbs, Rapier, royal boons, EX-4 stairs: deliberately unmodelled (§1).

**Implementation aid** `[F]`: the `undo_store` / `undo_perform` pairs in
`entitydef.lua` are an exhaustive enumeration of the game's per-move mutable
state. Only `popup` and `enemy` store anything beyond the entity itself —
`popup` the floor, `enemy` the floor's Battle Gates. Every other entity returns
`{}`, which is positive evidence that "`Original → Gone`" is complete for all
of them. Re-run this check against any future game version.

---

## 11. Verification Contract

```
Run: npm test
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; diff stat; any file touched outside src/sim/
```

**Step 0 — pre-verification, before writing any sim logic.** Against the
original map data files and their JSON conversion, assert that **no cell in any
tower carries both a wall and an entity**. `[I]` iestyn is ~99.999% confident
from play; `[F]` the game keeps them as separate layers, so the merged grid of
§3 is only safe if this holds. Report towers and cells checked, and any
violation with coordinates. If it fails, stop and revisit §3.

**Named cases with exact expected values**

| Case | Expected |
|---|---|
| `tier(1)`, `tier(9)` | 1, 1 |
| `tier(10)`, `tier(99)` | 2, 2 |
| `tier(100)`, `tier(1000)` | 3, 4 |
| `tier(1e12)` | 10 (cap) |
| Shield, enemy +5 | delta **+2** |
| Shield, enemy +25 | delta **+12** |
| Shield, enemy −25 | delta **−13** |
| No shield, enemy +25 | delta **+25** |
| Keysmasher, 2 light + 3 dark keys, enemy +5 | delta **+11** (§6 `[O]`) |
| Keysmasher, `negative_keys`, 3 light keys, enemy +5 | delta **+14** |
| Elixir at power 3e9 | power **4e9** |
| Elixir at power 3e9, `uncapped_elixirs` | power **6e9** |
| Power cap | never exceeds **999999999999** |
| Half Gate, power 7 | power **4** |
| Half Gate, power 7, Master Key | power **7**, held **null** |
| Light Gate, 3 Light Keys + Master Key | lightKeys **3**, held **null** |
| Light Gate, 3 Light Keys, no Master Key | lightKeys **2** |
| Gem Gate cost 5, Master Key held, 0 gems | `NEED_GEMS`, held **unchanged** |
| Battle Gate value 3, after 3 kills on that floor | **Gone** |
| Battle Gate value 3, after 2 kills | `BLOCKED_BATTLE_GATE` |
| Battle Gate value 3, 3 kills on a *different* floor | still blocked |
| Battle Gate, Master Key held | **Gone**, held **null** |
| One kill opening two Battle Gates | step records **2** gate edits |
| Vorpal vs enemy +50, power 10 | power **10**, gold **+2**, held **null** |
| Gold Dagger vs enemy +25 | gold **+4** |
| Golden Claymore vs enemy +25 | gold **+4** |
| Black Rod vs enemy +25 | power **+50**, held **null** |
| White Rod vs enemy −25, power 26 | power **51**, held **null** |
| Spike 40, power 10, Feather | legal, power **10**, held **Feather** |
| Spike 40, power 10, no Feather | `SPIKE_TOO_STRONG` |
| Spike re-entered | damage applied again, cell still Spike |
| Step **onto** pop-up | cell → **Gone**, `pendingPopup` set |
| Step **off** pop-up | that cell → **Reinforced**, pending null |
| Pop-up A → adjacent pop-up B | A → **Reinforced**, B → **Gone**, pending = B |
| Stairs off a pop-up | cell → **Reinforced** (floor differs) |
| Step onto pop-up with Feather | cell **unchanged**, pending **null** |
| Reinforced (ex-pop-up) + Hyper Pickaxe | **Gone**, held **null** |
| Crown entry, power 900 | score **900**, cell still Crown |
| Dark Crown entry, power 900 | score **1800**, cell still Dark Crown |
| `barrier_u` entered from above | `BLOCKED_ONE_WAY` |
| `barrier_u` from below / left / right | legal, cell unchanged |
| `barrier_l` from the west | blocked |
| Pathfind across a Light Gate with 5 Light Keys | **`NO_PATH`** (passivity) |
| Pathfind across a spike, no Feather | **`NO_PATH`** |
| Pathfind across a spike, Feather held | route found, power unchanged |
| Pathfind across two floors via stairs | route found, floors traversed |
| Route touching an Orb or Rapier | `UNSUPPORTED_ENTITY` |

**Oracles, cheapest first**

1. **Zero-error replay sweep.** Replay every save in every `.sav` (they are
   packed folders of multiple named saves) from first waypoint to last; assert
   no error. This is the primary regression net and it is far stronger than it
   sounds: every waypoint must be both *reachable* — exercising traversability,
   Feather rules, one-way directions and stairs — and *legal* — exercising
   every gate, wall, enemy and item rule. Errors compound forward, so a single
   mis-modelled rule usually kills an entire replay rather than hiding.
   `[F]` Remember our sim is stricter than the game's loader (§5.3): triage a
   cross-floor `NO_PATH` before assuming it is our bug.
2. **Hi-score oracle.** `[F]` The game's `score` file is plain alternating
   lines of tower name and best score. `[I]` iestyn's hi-scores are all Dark
   Crown runs, so for each `AUTOSAVE_HISCORE` save, assert
   `finalScore == score-file value`, i.e. final power `== value / 2`.
   Supporting evidence: all fourteen recorded scores are even, and the largest
   (EX-1, 1.66e10) is far below `MAX_POWER`, so none are clamped and the
   halving is exact. This is a genuine end-state check requiring **no PNG
   work**.
3. **Final map golden** (once the PNG-extraction spec exists). `[D]` The
   extractor emits the **same JSON schema as the tower initial-state files**,
   fully populated, so one structural differ serves initial state, sim output
   and extractor output. Bonus test: extract a PNG of a tower's *starting*
   state and assert it round-trips to the initial JSON exactly — two very
   different code paths reaching one value.
   `[F]` The exported PNG composites the player sprite **over** the cell it
   occupies (stairs and spike pixels survive around the sprite's edges; a
   win-state export hid the Crown). The differ must mask the player's final
   position and the extractor schema needs an `unknown` marker.
   `[F]` A player standing on a pop-up renders as pure black, which is that
   cell's true state (§4.2) — indistinguishable from occlusion in the image, so
   the mask covers it either way.
4. **Property tests** over fuzzed legal walks: invariants 1–7 of §9.
5. **Journal test:** for ~20 sampled `k` per save, assert `Cursor.seekTo(k)`
   matches a fresh truncated simulation, and that seeking away and back
   reproduces state at `k` exactly (invariant 8).
6. **Determinism test:** one test, not a suite (invariant 9).

**Deliberately rejected tests.** A final-position check is near-tautological —
the last waypoint is applied as a move target, so we reach it by construction;
it validates only the parser's stairs-offset quirk and belongs in the parser's
tests. Prefix consistency across saves from the same run is the determinism
test in disguise: if the sim is a pure fold over the waypoint list, replaying
save B's first *k* waypoints is literally the same input as save A's.
