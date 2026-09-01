# SPEC: Game Simulation Engine

Status: **draft 7 — implemented**, 2026-08-31.
Game source verified against: `v0.7-455` Lua dump.

Draft 7 changes no behaviour. It rewrites §6 to **cite** `GAME_MECHANICS.md`
instead of restating it (D33), which removed 202 lines and the last of the
duplicated rules; and it corrects invariant 3, which had the pop-up chain
backwards. Load `GAME_MECHANICS.md` alongside this spec — it is no longer
optional, because the rules are only there now.

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

**Deliberate omissions.** `[F]` Counted over all 16 shipped tower **files**:
none of these appear, except orbs, which occur only in tower **3-1** (60
entities).

`[F]` **But "not in the file" is not "not in the game."** `level_scripts.lua`
injects `royal_boon1`, `royal_boon2` and `rapier` entities at load time, and
edits walls around them, in 13 of the 16 towers — see `GAME_MECHANICS.md` §9.1.
The injections are gated on account state, so:

- `UNSUPPORTED_ENTITY` is a 3-1-only concern **for an account without
  `royal_boon2`**. With it, a Rapier appears in every tower where the player
  holds a Dark Crown, and the walls around it move.
- `SimInput` will eventually need the account state — the two boon flags and the
  per-tower crown tier — as an input alongside `gemsOwned`. It is deliberately
  not added yet: nothing can be validated against it until someone has the boon.

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
one-way wall predicates (`GAME_MECHANICS.md` §3).

`[F]` **Tower flags** are a bitfield in the level metadata
(`leveldata.lua:26-31`), tower-wide, not per-floor:

| Bit | Flag | Effect |
|---|---|---|
| 0 | `negative_keys` | **rewrites the entire key system** — see below |
| 1 | `uncapped_elixirs` | removes the Elixir gain cap (`GAME_MECHANICS.md` §4) |
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
  submittedScore: number            // max of all crown submissions, §6 / GAME_MECHANICS §6.2
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

### 4.2 Pop-up walls — where the transitions sit in the pipeline

**The rule is `GAME_MECHANICS.md` §3, "The pop-up life cycle".** Do not
paraphrase it; D33. What belongs here is only *which phase* does what.

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
| One-way wall | yes, iff entered from an allowed side (`GAME_MECHANICS.md` §3) |
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

## 6. Cell rules — the app's encoding of them

**Every game rule this section used to state now lives in `GAME_MECHANICS.md`,
and is cited rather than repeated (D33).** What belongs here is only how the
simulator *encodes* a rule: which `Player` fields move, which `CellEdit`s are
emitted, which `ErrorCode` a refusal carries, and what `requirement` the entry
demanded. If you find a game rule written out below, that is a bug in this
document — fix it by deleting it and pointing at the paragraph that owns it.

`[F]` Rewritten 2026-08-31. Draft 6 restated ten rules from `GAME_MECHANICS.md`
§2-§5, and one of the paraphrases — the pop-up chain — was **backwards** for
long enough to be implemented against and reviewed. Two more, the Adamantine
Shield's signed floor, were duplicated inside this one section.

| What you are looking for | Where it lives |
|---|---|
| Combat, enemy tiers, gold | `GAME_MECHANICS.md` §2 |
| The held-item chain, in order, with guards | §5.3 |
| Terrain, walls, digging precedence, spikes, one-way walls | §3 |
| The pop-up life cycle | §3, and §4.2 above for the phases |
| Gates and pickups; `negative_keys` | §4, §4.1 |
| Held items, consumable and passive | §5.1, §5.2 |
| Crowns, and what each submits | §6.2 |
| Stairs | §3, §7 |

### `tier()`

`[D]` Implements the decade bands of `GAME_MECHANICS.md` §2. Implement by
repeated division or by string length — **never** `Math.log10`, which returns
2.9999… for 1000 on some inputs. `[F]` The Rapier's loop reaches 11 where the
gold loop caps at 10 (§5.3), so do not share one `tier()` between them; the
Rapier is out of scope in v1 but the helper is not.

### Enemies

`[D]` The sign is applied in exactly one place, so the rule documents itself
and can carry its own test:

```ts
// The ONLY place an enemy's value acquires a sign. GAME_MECHANICS.md §2.
function signedBase(ent: Cell): number {
  return ent.kind === 'enemy_neg' ? -ent.value : ent.value
}
```

`[D]` Emissions on a kill: the cell → `Gone`, `step.killedOn = z`, and every
Battle Gate on that floor re-evaluates (below).

`[D]` `requirement = ent.value`. It is the **entry threshold**, so no held item
changes it — the Shield halves the power *change* and never the power
*required*, because `can_interact` runs before any item is consulted. `[F]` A
Vorpal kill's `requirement` is `ent.value` like any other, but its power delta
is *absent* rather than zero: its branch never calls `modify_player_power`
(§5.3).

`[D]` The item chain is a `switch` in `resolveEntry`, written in §5.3's order
even though that order is unreachable — the game's is an `elseif` chain, so
mutual exclusivity is structural. Keeping the order makes the two read alike.

### Battle Gates

`[D]` **Cell state stays uniform.** An open gate is `Gone` in the mask like
everything else, so tile queries need no special case. Only the kill step does
the arithmetic, emitting one `CellEdit` per gate that opens.

`[D]` **We count up where the game counts down.** `GAME_MECHANICS.md` §4 has
the game decrementing every still-closed gate on the floor; we compare a
running `kills[z]` against each gate's immutable initial value. The two agree
because an opened gate stops being decremented, so values never pass below 0,
and because a Master-Key opening also removes the gate.

This is the one place where "immutable parameters, mutable enum" (§3) diverges
*structurally* from the game and still has to match it exactly, which is why
invariant 6 asserts the equivalence rather than trusting it.

### Gates, walls, items and terrain

`[D]` Every payable cell is `Original → Gone` when paid. The pop-up chain is
the sole exception; it is invariant 3, and the rule behind it is
`GAME_MECHANICS.md` §3.

`[D]` `requirement` is `ent.value` for an enemy and for a Spike — the two cells
that gate on power — and 0 for everything else. It records what the move
*demanded*, never what it cost, because it is the input to the power-graph
margin track (§8).

`[D]` Refusals carry the `ErrorCode` naming the resource that fell short (§7).
`NEED_PICKAXE` and `NEED_HYPER_PICKAXE` stay distinct because the wall values
that produce them are distinct, and telling a player they need a Pickaxe on a
Reinforced Wall is actively misleading.

`[D]` Gems are tracked as `gemsSpent`, counted up, never as a remaining balance
counted down. `GAME_MECHANICS.md` §4 has the game's reason; §10 has ours for
taking `gemsOwned` as an input.

`[D]` **Crowns persist and set `win`**, and `submittedScore` is a `max`
**within the run**. `GAME_MECHANICS.md` §6.2 gives the game's across-run
maxima; the within-run max is ours, for the same reason the game's exists — one
run can submit twice, taking the Crown, rewinding, and taking the Dark Crown,
and a later worse submission must not erase a better one. `[F]` The hi-score
oracle cannot distinguish the two policies, since it reads only the final
value, so this is settled by matching the game's structure rather than by test.

`[P]` Track prospective score every step — `power`, and `min(power*2,
MAX_POWER)` — so the UI can show the anticipated Crown and Dark Crown values
without mental arithmetic. Only Crown entry commits it.

`[F]` **§11 carries a named case per wall value.** Getting 2 and 3 the wrong
way round would be quiet and widespread: the shipped distribution is
6 473 Weak / 23 468 Reinforced / 5 634 Iron.

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
   table. The rule is **`GAME_MECHANICS.md` §3, "The pop-up life cycle"** —
   read it there; this spec states only the `CellState` encoding of it:
   `Original → Gone` for everything, plus `Gone → Reinforced` and
   `Reinforced → Gone` for pop-ups only. `[I]` The pop-up chain is real and was
   load-bearing in a best Orderly Order run.
   `[F]` **Corrected 2026-08-31 (D33).** Draft 6 paraphrased the game rule here
   and got it backwards. `GAME_MECHANICS.md` had it right the whole time, and
   so did §4.2 of this spec — the wrong copy was the third one. Found by the
   D32 double build of `Cursor`; the chains the corpus actually contains are
   counted in SPEC-007 §8.
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
2. **Keysmasher total vs bonus — closed `[F]`.** It is `base + bonus`; `GAME_MECHANICS.md` §5.2.
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
