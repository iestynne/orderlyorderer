# SPEC: Game Simulation Engine

Status: **draft 6 — ready for implementation**, 2026-08-28.
Game source verified against: `v0.7-455` Lua dump.

Draft 6 closes every `[O]` in draft 5 by reading the Lua rather than running
experiments, and corrects the rules that reading found wrong. The corrections
are load-bearing — see `GAME_MECHANICS.md` §4.1, §5.3 and §6.1, which this spec
now defers to for the *why*; what follows is the *what to build*.

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

**Deliberate omissions.** `[F]` Counted over all 16 shipped towers: none of
these appear at all, except orbs, which occur only in tower **3-1** (60
entities). So `UNSUPPORTED_ENTITY` is a 3-1-only concern.

| Entity | Reason |
|---|---|
| `orb_force`, `orb_change`, `orb_warp` | not yet understood |
| `rapier` | not yet understood |
| `royal_boon1` | `[F]` gem budget only; `GAME_MECHANICS.md` §9 |
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
type Waypoint = { z: number; x: number; y: number }   // absolute target cell, 1-based
```

`[D]` **Coordinate basis — the recommendation, settled.** Two rules, no third:

1. **Every coordinate a human or a file can see is 1-based**, matching D1, the
   game's Lua, and the save format. That covers `Waypoint`, `Player.{z,x,y}`,
   `tower.metadata.start_*`, everything in an error message, and everything you
   would check by eye against a save.
2. **`Addr` is an opaque 0-based index** and the *only* 0-based thing in the
   module. It is produced solely by `addr()` and consumed solely as an index
   into the state arrays.

```ts
const D = tower.floors.length
function addr(z: number, x: number, y: number): Addr {   // 1-based in
  assert(1 <= z && z <= D && 1 <= x && x <= 15 && 1 <= y && y <= 15)
  return ((z - 1) * 15 + (y - 1)) * 15 + (x - 1)
}
function coords(a: Addr): { z: number; x: number; y: number }   // 1-based out
```

`[D]` **Never do arithmetic on an `Addr`.** The neighbour to the east is
`addr(z, x+1, y)`, not `a + 1` — the latter wraps a row and then a floor with
no error, which is exactly the aliasing bug D1 exists to prevent. The bounds
assert inside `addr()` is what makes that unreachable, so it is not a debug-only
assert.

This resolves the tension directly: TypeScript arrays are 0-based and stay
0-based, but the 0-based region is one function wide and has one test. A
0-based *domain* would instead put a `-1` at every point where the module meets
a save file, a map file or a person, which is where the bugs would actually be.

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
| 0 | `negative_keys` | **rewrites the entire key system** — see below |
| 1 | `uncapped_elixirs` | removes the Elixir gain cap (§6) |
| 2 | — | an EX-4-only flag, deliberately unmodelled |

`[F]` `negative_keys` is used only by tower EX-3, `uncapped_elixirs` only by
EX-1, and bit 2 by nothing shipped. Counted over all 16 committed tower JSONs.

`[F]` **`negative_keys` is not a Keysmasher tweak — draft 5 had this wrong.**
Full derivation in `GAME_MECHANICS.md` §4.1; the rules the sim must implement:

| | normal | `negative_keys` |
|---|---|---|
| pick up `key` | `lightKeys += 1` | `lightKeys += 1` |
| pick up `dark_key` | `darkKeys += 1` | **`lightKeys -= 1`** |
| `door` needs / pays | `lightKeys > 0` / `-= 1` | same |
| `dark_door` needs / pays | `darkKeys > 0` / `-= 1` | **`lightKeys < 0`** / **`+= 1`** |
| Keysmasher bonus | `lightKeys * darkKeys` | **`lightKeys * lightKeys`** |

Under the flag `darkKeys` is permanently 0 and unused — which is the whole
reason the Keysmasher needs a squared special case. **`lightKeys` may be
negative**, so invariant 2 (§9) is conditional on the flag.

EX-3 is therefore the hardest replay target in the set: it is the only tower
that combines `negative_keys`, a Keysmasher and Battle Gates. Treat a clean
EX-3 replay as the acceptance bar, not a bonus.

`[F]` Metadata also carries `crowns_needed`, `start_power`,
`start_floor/x/y`, and `grades` — the six score thresholds
`[C, B, A, S, ★, overscore]` that determine gem awards. Parse and retain them;
`grades` is the route to computing `gemsOwned`, and the derivation is now fully
read (`GAME_MECHANICS.md` §6.1) rather than pending (§10.1).

### 2.1 Starting player state

`[F]` `game.lua:473-480`. `simulate()`'s first line, stated so it is not
guessed:

| Field | Initial value |
|---|---|
| `z, x, y` | `metadata.start_floor`, `start_x`, `start_y` |
| `power` | `metadata.start_power` |
| `gold`, `lightKeys`, `darkKeys`, `pickaxes`, `gemsSpent` | `0` |
| `held` | `null` |
| `pendingPopup` | `null` |
| `win` | `0` |
| `submittedScore` | `0` |

`[F]` The game's own `player` record is exactly `{held_item, keys, dark_keys,
pickaxes, win, gold, popup, orbs, power, floor, x, y, gems_spent, total_gems,
total_crowns}` plus a `stats` table. `total_gems` / `total_crowns` are account
meta-state, not run state; `orbs` is out of scope (§1); `stats` is display-only.
Everything else has a field above, which is the check that this list is
complete.

---

## 3. Core types

```ts
type Addr = number   // opaque 0-based index; build only with addr(), §2

interface Player {
  z: number; x: number; y: number   // 1-based
  power: number; gold: number
  lightKeys: number; darkKeys: number; pickaxes: number
  gemsSpent: number                 // remaining = gemsOwned - gemsSpent
  held: HeldItem | null
  pendingPopup: Addr | null         // see §4.2
  win: 0 | 1 | 2                    // 0 none, 1 Crown, 2 Dark Crown
  submittedScore: number            // max of all crown submissions, §6
}

const enum CellState {
  Original   = 0,      // exactly as the tower JSON describes it
  Gone       = 1,      // entity removed / gate opened / wall destroyed
  Reinforced = 2,      // pop-up walls only: converted to a Reinforced Wall
}

interface CellEdit { addr: Addr; before: CellState; after: CellState }

interface Step {
  waypointIndex: number   // which route entry produced this move
  from: Addr; to: Addr    // to = the cell ENTERED, never the stairs arrival cell
  edits: CellEdit[]
  killedOn: number | null // floor an enemy died on this step, else null
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

- `tower.floors[z].cells[y][x]` — the parsed tower JSON, **immutable**, holding
  the full readable record (kind, value, direction) in **one merged grid**.
  This is the debuggable artifact: it is literally the file you can open and
  read. `[D]` SPEC-002 emits this shape as of the merged-grid revision — draft
  5 of this spec described a grid that did not exist, and the fix was to move
  the merge into the parser rather than to open-code it here. The merge is
  licensed by §11 step 0, which proves no cell carries two things at once.
- `state: Uint8Array` of length `15*15*D` — one `CellState` byte per cell,
  indexed by `Addr`.

Tile *parameters* — enemy power, gate cost, spike value, gold-bag amount — are
immutable for the whole run and are always read from the tower grid. The mutable
part of a cell is one small enum, and every rule reduces to setting it.

`[D]` A byte per cell, not a bit vector: three states are needed (pop-ups reach
`Reinforced` and can then be destroyed by a Hyper Pickaxe), and at 15×15 with
the largest tower's **75** floors the grid is ~17 KB — bit-packing saves nothing
and costs readability. (Draft 5 said 25 floors / 5.6 KB, which was 3× low: 2-6
has 75.)

`[D]` **Plain `number` throughout; no BigInt.** `[F]` The largest entity in the
game is a 999G `enemy_neg` in tower 1-2 — 999 000 000 000 — against
`MAX_POWER` 999 999 999 999. Even a Dark Crown's `power*2` (~2e12) is far inside
float64's exact-integer range of 2^53. Stated once so nobody reaches for BigInt.

`[D]` Player state is separate from cell state and is snapshotted whole per
step. `[F]` The game does the same: `Game:undo` restores a per-move player
record including `p_popup` (`game.lua:1397`).

`[D]` **`Player` holds scalars only.** Draft 5 put a `killsOnFloor: Int32Array`
inside it, which every per-step snapshot would have aliased — invariant 9 exists
to catch exactly that, so the type should not create it in the first place. The
game's own player record has no such field either (§2.1); it is our device for
Battle Gates, so it belongs with the other run state:

- `Step.killedOn` records the floor of a kill, or `null`. One number, trivially
  reversible, journalled alongside `edits`.
- `Cursor` maintains `kills: Int32Array` the same way it maintains `cells`,
  incrementing on seek-forward and decrementing on seek-back.

A `Player` snapshot is then a flat record of numbers and one string, and
copying it is a spread. No deep-copy rule to remember and no way to violate it.

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

`[D]` **`Step.to` is the cell entered, never the stairs arrival cell.** Phase 1
checks `from`/`to` adjacency and that check must stay literally true; the
post-teleport position lives in `Step.player.{z,x,y}`, where the rest of the
after-state already is. So on a stairs move `to` names the staircase and
`player` names the floor above or below, and nothing is ambiguous.

`[D]` **An *action* waypoint may never be a staircase — assert it.**
`[F]` `entitydef.stairs_up` has no `undo_store`, so stairs never enter the undo
history *as an action*. Measured over the corpus: **0** of the 244 staircase-
naming waypoints sit at an action index. An action waypoint on a staircase would
mean the save format is not what we think.

`[F]` **A *position* waypoint routinely is a staircase, and draft 6 was wrong to
assert otherwise.** A recorded pair is (player position before the action, the
acted-upon cell), and after taking stairs the player is standing on the paired
staircase. It happens **244 times** in the corpus. The blanket assertion failed
on the first run against real data.

`[D]` **Consequence for the pathfinder: a staircase target must be reached by
*landing* on it, never by stepping onto it.** Entering a staircase teleports the
player straight off it, so a direct step leaves the waypoint unsatisfied and the
route oscillating across the floor boundary. §5.3 states the rule; it is the one
place where "the target cell is exempt from traversability" is not enough on its
own.

Note the asymmetry is not an inconsistency: a `Step` is a move we generated and
may legitimately step onto stairs; an *action* waypoint is a state change the
game recorded, and stairs change no state.

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
   `Step.killedOn`.
5. **Power cap.** `[F]` `power = min(power, MAX_POWER)`,
   `MAX_POWER = 999_999_999_999` (`game.lua:42, 1545`). Once per move, after
   effects, before the position commits. `[F]` `modify_player_power` itself
   never clamps — this is the only clamp, and there is **no lower one**.
6. **Position.** Set position to `to`. If the entered cell is Stairs Up/Down,
   set position to `(z±1, x, y)`.

   `[D]` **Phase 6 is non-recursive. Exactly one teleport per move, and the
   arrival cell is never run through phases 1–5.** Draft 5 said the opposite —
   that a failed assertion here should make phase 6 recurse into phase 2 — and
   that would spin: `[F]` **478 of the game's 581 staircases land on the paired
   opposite staircase**, so recursion would bounce `z` between two floors
   forever. Say it as a rule and give it a named test (§11), because it is the
   kind of thing a later tidy-up reintroduces.

   `[F]` The assumption underneath is sound, and it is now measured rather than
   assumed: across all 581 stairs in all 16 towers, **0 land on a wall and 0
   land on any non-stairs entity**. 478 land on the paired staircase and 103 on
   empty floor — the latter are one-way stairs, and tower **2-6 has no
   `stairs_down` at all**: 75 floors, strictly one-way upward. So the arrival
   cell is always enterable terrain, and §10 open item 3 is closed `[F]`.
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

`[F]` **The goal test must fire on the arrival node too, not only on the cell
stepped into.** A target reached by landing off a staircase is never entered
directly, so testing only the stepped-into cell reports `NO_PATH` for every such
waypoint. This was the first bug the corpus found: **61 of 326** records failed
on it, all with `NO_PATH` at a floor change.

`[F]` **A staircase target is the mirror image, and must be reached *only* by
landing.** Stepping onto a staircase teleports the player off it, so a direct
step cannot leave them standing there. Suppress the stepped-into goal test when
the target is a staircase. Not an edge case: **244** position waypoints in the
corpus name a staircase (§4).

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

`[F]` Entry requires `power > ent.value` (strict), unless a Vorpal Blade is
held, which always succeeds (`_enemy_can_interact`, `entitydef.lua:109`).

`[F]` **`ent.value` is always stored positive; the sign lives in the entity
type.** So a −25 enemy also requires `power > 25`, even though beating it costs
power. Draft 5 wrote `base = enemy.power // signed`, which the tower JSON never
provides. Route it through one helper so the rule documents itself and has its
own test:

```ts
// The ONLY place an enemy's value acquires a sign.
function signedBase(ent: Cell): number {
  return ent.kind === 'enemy_neg' ? -ent.value : ent.value
}
```

`[F]` The held-item branches are a single `elseif` chain in the game's enemy
`interact`, which formally confirms mutual exclusivity and makes ordering
between them unreachable.

```
base = signedBase(ent)
if   held == VorpalBlade:                     delta = 0;             consume
elif held == BlackRod  && kind == enemy:      delta = base * 2;      consume
elif held == WhiteRod  && kind == enemy_neg:  delta = -base;         consume
elif held == AdamantineShield:                delta = floor(base/2)
elif held == Keysmasher:                      delta = base + keysmasherBonus()
else:                                         delta = base
power += delta

goldGain = tier(ent.value)
if   held == GoldDagger:     goldGain += 2
elif held == GoldenClaymore: goldGain *= 2      // elseif: they cannot combine
gold += goldGain

cell -> Gone;  step.killedOn = z
// then: every Battle Gate on this floor re-evaluates (below)
```

`[F]` **The rod guards test the entity type, not the sign of `base`.**
Equivalent in practice, but it is what makes a rod on the wrong enemy sign fall
through to the bare `else` — taking the ordinary delta and **staying held**.
Draft 5 flagged that as plausible-but-unvalidated; it is now read, so it needs
a named test rather than an experiment.

`[F]` **Black Rod / White Rod are `dark_rod` / `light_rod`** in `entitydef.lua`.
Keep both names in view: the entity vocabulary uses one and the compendium the
other, and confusing them inverts the sign rule.

`[F]` The Adamantine Shield applies **signed floor**, not round-toward-zero:
+5 → +2, +25 → +12, **−25 → −13**. Confirmed twice — measured in-game on tower
2-2 floors 8 and 9, and read as `modify_player_power(math.floor(base/2))`.

`[F]` **Keysmasher — settled, no longer `[O]`.**
`keysmasherBonus() = negative_keys ? lightKeys² : lightKeys * darkKeys`, and
the Lua adds it **to** the enemy's signed base:
`modify_player_power(base_change + bonus)` (`entitydef.lua:178-186`). The HUD's
`get_held_value` displays only the bonus, which is why it reads as bonus-only
in play. Keys are not consumed.

On a **negative** enemy this offsets the loss and can invert it: `−5` with a
bonus of `+11` is a net `+6`. `[I]` iestyn reports exactly this in play, which
is independent confirmation of the additive reading.

`[F]` **Adamantine Shield** is `math.floor(base/2)` — signed floor, not
round-toward-zero and not round-up: +5 → +2, +25 → +12, **−25 → −13**.
Confirmed twice: measured in game on tower 2-2 floors 8 and 9, and read as
`modify_player_power(math.floor(base_change/2))`.

`[I]` Vorpal Blade is consumed on the next attack of any kind, not only on
attacks the player would otherwise lose. `[F]` Its branch never calls
`modify_player_power` at all, so the delta is genuinely absent rather than
zero — the distinction matters only for the power-change animation, but it is
why `requirement` for a Vorpal kill is 0, not `ent.value`.
`[F]` The Shield halves the power *change* but never the power *required* to
win: `can_interact` is evaluated before any held item is consulted.

### Battle Gates

`[F]` `entitydef.battle_gate`. A gate carries a countdown `value`. Every enemy
defeated **on the same floor** decrements every Battle Gate on that floor; any
gate reaching 0 opens. A Master Key also opens one directly (`can_interact` is
`held_item == "master_key"`); otherwise it simply blocks.

`[D]` Cell state stays uniform — an open gate is `Gone` in the mask like
everything else, so tile queries need no special case. Only the kill step does
the arithmetic, using `kills[z]` against each gate's initial value, and emits
one `CellEdit` per gate that opens.

`[F]` The game does this destructively — it decrements every still-closed gate
on the floor and opens the ones hitting exactly 0 — while we compare a running
count against the immutable initial value. The two agree because an opened gate
stops being decremented (`if type == "battle_gate"` excludes it), so values
never pass below 0, and because a Master-Key opening also removes the gate.
Worth stating: it is the one place where "immutable parameters, mutable enum"
diverges structurally from the game and still has to match it exactly.

### Gates

All become `Gone` when opened. `[I]`

| Cell | Cost | Master Key |
|---|---|---|
| Light Gate (`door`) | 1 Light Key (`lightKeys > 0`) | substitutes, consumed |
| Dark Gate (`dark_door`) | 1 Dark Key — but see `negative_keys`, §2 | substitutes, consumed |
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

`[F]` Wall grid values, confirmed against the movement code's own precedence
(`game.lua:1421-1509` tests `3`, then `2`, then `1`, in that order):

| Value | Cell | Entry |
|---|---|---|
| 0 | empty floor | free |
| 1 | Weak Wall | 1 Pickaxe if `pickaxes > 0`, **else** Hyper Pickaxe (consumed) → Gone |
| 2 | Reinforced Wall | Hyper Pickaxe only (consumed) → Gone |
| 3 | Iron Wall | never — `BLOCKED_IRON` |
| — | Pop-Up Wall (entity) | always enterable; §4.2 |
| — | One-Way Wall (entity) | below |

`[F]` **The ordinary Pickaxe is always spent first.** The Hyper Pickaxe branch
on a Weak Wall is an `elseif` reached only when `pickaxes == 0`, so a player
holding both loses the ordinary one. Getting this backwards silently over-counts
Hyper Pickaxes, which are far scarcer.

`[F]` **The Hyper Pickaxe is single-use** — `held_item = nil` on both branches.
This closes an open question in `GAME_MECHANICS.md`.

`[F]` A converted pop-up becomes value **2**, so an ex-pop-up needs a Hyper
Pickaxe, not a Pickaxe (`entitydef.lua:938`, `game.lua:1569`).

`[F]` Getting 2 and 3 the wrong way round would be quiet and widespread — the
shipped distribution is 6 473 Weak / 23 468 Reinforced / 5 634 Iron — so §11
carries a named case for each of the three.

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
| Light Key (`key`) | `lightKeys += 1` | Gone |
| Dark Key (`dark_key`) | `darkKeys += 1`, or `lightKeys -= 1` under `negative_keys` | Gone |
| Pickaxe | `pickaxes += 1` | Gone |
| Gold Bag (`money`) | `gold += value` | Gone |
| Elixir | below | Gone |
| Held Item | previous held item **destroyed** `[F]`, new one held | Gone |
| Crown | `win = 1`; `submittedScore = max(submittedScore, power)` | **persists** `[I]` |
| Dark Crown | `win = 2`; `submittedScore = max(submittedScore, min(power*2, MAX_POWER))` | **persists** `[I]` |
| Spike (`spikes`) | below | **persists** `[I]` |
| Stairs Up / Down | teleport (§4.1 phase 6) | unchanged |
| Empty / floor | none | unchanged |

`[F]` **Keys and Pickaxes increment by 1. The tile's `value` is ignored** —
`game.player.keys = game.player.keys + 1`, with no reference to `ent.value`
(`entitydef.lua:527, 552, 665`). Draft 5 said "increment counter by `value`",
which would be wrong on any tile whose value is not 1. `money` is the only
pickup that reads `value`.

`[F]` **Pickup is mandatory**, not merely conventional: every held-item entity's
`can_interact` is a bare `return true` and its `interact` overwrites `held_item`
unconditionally. There is no branch that can decline, so a tile holding an item
is impassable-without-cost while carrying a passive. This was the highest-
priority open mechanics question and it is now closed by reading.

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

`[F]` **`max`, and the question draft 5 asked badly.** `Scores:submit` writes
`score_data[level]` only when `score >` the stored value, and `crown_data[level]`
only when `crown_tier >` the stored tier — two independent maxima, and both are
*across all runs ever*, held in the player's `score` and `crown` files.

Since one run can submit twice (take the Crown, rewind, take the Dark Crown),
the sim needs a per-run answer too, and it should be **`max` within the run**,
for the same reason the game uses `max` across runs: a later, worse submission
must not erase a better one. Hence `submittedScore = max(...)` above. The
hi-score oracle cannot tell the two apart — it only reads the final value — so
this is settled by matching the game's structure, not by a test.

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
  | 'NEED_LIGHT_KEY' | 'NEED_DARK_KEY' | 'NEED_GEMS' | 'NEED_GOLD'
  | 'NEED_PICKAXE' | 'NEED_HYPER_PICKAXE'
  | 'ENEMY_TOO_STRONG' | 'SPIKE_TOO_STRONG'
  | 'UNSUPPORTED_ENTITY'
```

`[D]` `NEED_PICKAXE` is the Weak Wall with no Pickaxe **and** no Hyper Pickaxe;
`NEED_HYPER_PICKAXE` is the Reinforced Wall with no Hyper Pickaxe. Distinct
codes because the remedies are entirely different — Pickaxes are common pickups,
Hyper Pickaxes are scarce held items — and a UI that says "find a pickaxe" for
a Reinforced Wall is actively misleading.

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
  readonly kills: Int32Array         // per-floor kill counts, for Battle Gates
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
  `kills[z]` is already one of these.
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
2. `gold, pickaxes >= 0` and `0 <= gemsSpent <= gemsOwned`. **Keys are
   conditional:** without `negative_keys`, `lightKeys >= 0 && darkKeys >= 0`;
   with it, `darkKeys == 0` and `lightKeys` is unconstrained in sign. `[F]`
   Asserting keys non-negative unconditionally would fail on EX-3 by design,
   not by bug — see §2.
3. Every `CellEdit` is a legal transition. `[D]` A two-line function, not a
   table: `Original → Gone` for everything, plus `Original → Reinforced` and
   `Reinforced → Gone` for pop-ups only. `[I]` The pop-up chain is real and was
   load-bearing in a best Orderly Order run.
4. `to` is orthogonally adjacent to `from` and on the same floor. The player's
   position after the step equals `to`, **except** on a stairs entry, where it
   is `(z±1, to.x, to.y)` — exactly one teleport, never two.
5. `pendingPopup` is null, or refers to a `Gone` cell the player stands on.
6. Battle Gate consistency: a gate is `Gone` iff `kills[z] >= initialValue`, or
   it was opened by a Master Key.
7. Intermediate (non-final) steps of a waypoint's path produce **zero** cell
   edits and change no player field but position. This is the pathfinder's
   passivity, stated as an assertion.
7a. No **action** `Waypoint` names a `stairs_up` or `stairs_down` cell (§4).
   Position waypoints do, 244 times in the corpus, and that is correct.
   Diagnostic: an action hit would mean the 2S+1 pairing is not what
   `SAVE_FORMAT.md` §3 says.
8. **Journal fidelity:** for any `k`, `Cursor.seekTo(k)` yields cells identical
   to a fresh `simulate` truncated at `k`. This is what makes the cheap journal
   trustworthy in place of per-step snapshots.
9. **Determinism:** simulating the same input twice yields identical timelines
   — including identical paths, which is why §5.4 fixes the expansion order.
   Its real yield is catching a state object mutated in place and aliased
   across steps.

---

## 10. Open items

Draft 5 had four. All four are closed; one new one takes their place.

1. **Gems — closed `[F]`, and deliberately still an input.** The derivation is
   fully read (`GAME_MECHANICS.md` §6.1): gems per tower are the grade index
   from `util.calculate_grade(metadata.grades, score)`, summed over towers, plus
   `total_crowns` if the `royal_boon1` unlock is set. `gemsOwned` nevertheless
   **stays a required `SimInput` field surfaced as a UI input**, because the
   player wants to ask "does this route work once I hit 400 gems?" — a
   hypothetical the derived value cannot express. Computing it from the `score`
   and `crown` files is a convenience that prefills the box, not a replacement.
   `[D]` For the replay sweep (§11 oracle 1), pass `Infinity`.
2. **Keysmasher total vs bonus — closed `[F]`.** It is `base + bonus`; §6.
3. **Stairs arrival cell — closed `[F]`.** Always enterable terrain, measured
   over all 581 stairs. Phase 6 is explicitly non-recursive; §4.1.
4. **Wall-and-entity on one cell — closed `[F]`.** Zero, over all 16 towers.
   It stays in §11 as step 0, now a regression test rather than a gate.
5. `[O]` **Reading `.sav` files from TypeScript.** The only codec is
   `tools/luajit_buffer.py`, so `npm test` currently cannot run oracles 1 and 2
   at all — the primary regression net is unreachable from the test runner. See
   §11 for the three options and the recommendation.
6. Orbs, Rapier, royal boons, EX-4 stairs: deliberately unmodelled (§1). `[F]`
   The cost of that is now measured, not guessed: `rapier`, `royal_boon1`,
   `royal_boon2` and `stairs_up/down_ex_4` occur in **zero** shipped maps, and
   orbs only in **3-1** (60 entities). So `UNSUPPORTED_ENTITY` is a 3-1-only
   concern and the replay sweep covers 15 towers of 16 unaffected.

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

**Step 0 — pre-verification. Already run; keep it as a regression test.**
Against the original map data files and their JSON conversion, assert that **no
cell in any tower carries both a wall and an entity**. `[F]` The game keeps them
as separate layers, so the merged grid of §3 is only safe if this holds — and it
does. Measured over all 16 towers / 325 floors, with these as the expected
values:

| Assertion | Expected |
|---|---|
| Cells carrying both a wall and an entity | **0** |
| Cells carrying two entities | **0** |
| Floors that are not exactly 15×15 | **0** (so the `Addr` stride of 15 is sound) |
| Stairs landing on a wall or a non-stairs entity | **0** of 581 |
| Stairs landing on the paired opposite staircase | **478** of 581 |
| Stairs landing on empty floor (one-way) | **103** of 581 |
| Towers with `negative_keys` | **1** — EX-3 only |
| Towers with `uncapped_elixirs` | **1** — EX-1 only |
| Towers with the EX-4 flag (bit 2) | **0** |
| Towers containing Battle Gates | **4** — 2-4, 2-5, 2-6, EX-3 |
| `rapier` / `royal_boon1` / `royal_boon2` / `stairs_*_ex_4` entities | **0** |
| Orb entities | **60**, all in tower 3-1 |
| Wall values: Weak / Reinforced / Iron | **6473 / 23468 / 5634** |
| Largest entity value in the game | **999 000 000 000** (`enemy_neg`, tower 1-2) |
| `stairs_down` entities in tower 2-6 | **0** — 75 floors, one-way upward |

Report towers and cells checked, and any violation with coordinates. A failure
here is a changed game version, not a code bug — check the tower `content_hash`
set first.

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
| Keysmasher, 2 light + 3 dark keys, enemy +5 | delta **+11** |
| Keysmasher, 2 light + 3 dark keys, enemy −5 | delta **+1** (bonus outweighs the loss) |
| Keysmasher, `negative_keys`, 3 light keys, enemy +5 | delta **+14** |
| Keysmasher, `negative_keys`, −3 light keys, enemy +5 | delta **+14** (squared, so sign-blind) |
| Keysmasher, 2 light + 0 dark keys, enemy +5 | delta **+5**, bonus 0 |
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
| Gold Dagger vs enemy **+5** | gold **+3** (tier 1, `1+2`) |
| Golden Claymore vs enemy **+5** | gold **+2** (tier 1, `1×2`) |
| Black Rod (`dark_rod`) vs enemy +25, power 26 | power **76**, held **null** |
| Black Rod vs enemy **−25**, power 26 | power **1**, held **Black Rod** — falls through, not consumed |
| White Rod (`light_rod`) vs enemy −25, power 26 | power **51**, held **null** |
| White Rod vs enemy **+25**, power 26 | power **51**, held **White Rod** — falls through, not consumed |
| Spike 40, power 10, Feather | legal, power **10**, held **Feather** |
| Spike 40, power 10, no Feather | `SPIKE_TOO_STRONG` |
| Spike re-entered | damage applied again, cell still Spike |
| Step **onto** pop-up | cell → **Gone**, `pendingPopup` set |
| Step **off** pop-up | that cell → **Reinforced**, pending null |
| Pop-up A → adjacent pop-up B | A → **Reinforced**, B → **Gone**, pending = B |
| Stairs off a pop-up | cell → **Reinforced** (floor differs) |
| Step onto pop-up with Feather | cell **unchanged**, pending **null** |
| Reinforced (ex-pop-up) + Hyper Pickaxe | **Gone**, held **null** |
| Wall value 1, 2 Pickaxes, no Hyper | **Gone**, pickaxes **1** |
| Wall value 1, 0 Pickaxes, Hyper held | **Gone**, held **null** |
| Wall value 1, **2 Pickaxes and Hyper held** | **Gone**, pickaxes **1**, held **still Hyper** |
| Wall value 1, 0 Pickaxes, no Hyper | `NEED_PICKAXE` |
| Wall value 2, 5 Pickaxes, no Hyper | `NEED_HYPER_PICKAXE` |
| Wall value 3, Hyper held | `BLOCKED_IRON`, held **unchanged** |
| Light Key tile with `value` 7 | lightKeys **+1**, not +7 |
| Pickaxe tile with `value` 7 | pickaxes **+1**, not +7 |
| Gold Bag tile with `value` 7 | gold **+7** |
| `negative_keys`: pick up Dark Key at lightKeys 0 | lightKeys **−1**, darkKeys **0** |
| `negative_keys`: Dark Gate at lightKeys −1 | opens, lightKeys **0** |
| `negative_keys`: Dark Gate at lightKeys 0 | `NEED_DARK_KEY` |
| `negative_keys`: Light Gate at lightKeys −1 | `NEED_LIGHT_KEY` |
| Held item tile entered while holding a Feather | Feather **destroyed**, new item held |
| Stairs Up onto the paired Stairs Down | one teleport; `Step.to` = the stairs cell, player `z+1`, **no second teleport** |
| Stairs Up onto empty floor (one-way) | one teleport; player on empty cell |
| Enemy −25, power 25 | `ENEMY_TOO_STRONG` — strict, and positive-valued |
| Enemy −25, power 26, no item | power **1** |
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

**Prerequisite for oracles 1 and 2: reading `.sav` from TypeScript**

`[O]` Both primary oracles need to read save files, and the only codec is
`tools/luajit_buffer.py` — Python. As written, `npm test` cannot run the primary
regression net at all. Three options:

| Option | Cost | Consequence |
|---|---|---|
| **Port the codec to TypeScript** | one focused spec; the format is fully documented in `SAVE_FORMAT.md` and the Python version is a verified reference to differential-test against | `npm test` self-contained; no Python in the test path |
| Shell out to Python from the test | small | adds a Python runtime to `npm test`, and a second language to every CI story |
| Pre-convert saves to committed JSON waypoint fixtures | small | oracles run on a clean clone, but the fixtures drift from the saves and hide codec bugs |

`[P]` **Recommend the port.** It is the only option that leaves the sim's
primary oracle runnable by the ordinary test command, the format is small and
already reverse-engineered, and the Python codec becomes the differential test
rather than a dependency. It should be its own spec, not smuggled into this one.

`[D]` **The save corpus is committed, at `data/saves/<owner>.<date>/`.** It is
iestyn's own play data, not the developer's level design, so it carries none of
the permission question that gates `data/towers/` (TODO §D). Committing it makes
both oracles run on a clean clone, which is worth more than the ~830 KB.

`[D]` The tests still **skip rather than fail** when the directory is absent, and
honour `TOS_SAVE_DIR` for a corpus held elsewhere — otherwise a missing corpus
would show green while testing nothing.

`[F]` The score data lives in two extension-less files in the game's save
folder, named **`score`** and **`crown`** — singular. `scores.lua` is the game's
source and holds no data.

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
2. **Hi-score oracle.** `[F]` The `score` file is plain alternating
   lines of tower name and best score. `[I]` iestyn's hi-scores are all Dark
   Crown runs, so for each `AUTOSAVE_HISCORE` save, assert
   `finalScore == score-file value`, i.e. final power `== value / 2`.
   Supporting evidence: all fourteen recorded scores are even, and the largest
   (EX-1, 1.66e10) is far below `MAX_POWER`, so none are clamped and the
   halving is exact. This is a genuine end-state check requiring **no PNG
   work**.
3. **Final map golden** — this is SPEC-005's job. `[D]` The
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
