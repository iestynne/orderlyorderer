# GAME_MECHANICS.md

Towers of Scale rules, as needed by the simulator. Canonical. Code is derived
from this document.

**Source:** the game's developer via the player, plus the in-game compendium,
app version **v0.7-455**. Items marked **UNVERIFIED** are inferred and must be
confirmed before the simulator depends on them.

---

## 1. Core model

A tower is a stack of floors, each a 15×15 grid. Floors are indexed **1-based
from the bottom**. Cells are `(x, y)`, 1-based, origin top-left.

The player occupies one cell and moves orthogonally. Everything is
**deterministic**: no RNG, no order-dependent floating-point. All arithmetic is
**integer**.

### Player state

| Field | Notes |
|---|---|
| `power` | Primary stat. Can rise and fall. |
| `gold` | Spent on Gold Gates. |
| `lightKeys`, `darkKeys` | Unbounded stock. |
| `heldItem` | **At most one.** See §5. |
| `gems` | Meta-progression, see §6. Not earned during a run. |
| position | `(floor, x, y)` |

**No field may ever go negative.** Power, gold and both key counts are floored
at zero by the rules, not by clamping — the game refuses any move whose outcome
would take one below zero. This is a hard invariant, not a guard: if the
simulator ever needs to clamp, it has already diverged.

### Movement

A move is a single orthogonal step. Entering a cell resolves whatever occupies
it: pick up an item, fight an enemy, pay a gate. A move is **illegal** if the
player cannot afford its outcome — insufficient power, gold or keys — and the
game refuses it rather than allowing a loss.

Consequence: **the player can never die.** There is no fail state, only blocked
moves.

## 2. Combat

The player defeats an enemy **only if `player.power > enemy.power`**. Strictly
greater — equal power fails.

On defeat:

- **Positive enemy:** `power += enemy.power`
- **Negative enemy:** `power -= enemy.power`
- **Gold:** `gold += tier` (the tier index, 1–10), modified by held items (§5)
- The player moves onto the enemy's cell, which becomes Empty.

Every tier has a positive and a negative variant. The negative sprite is the
positive one inverted with a white outline; see `EXTRACTION.md`.

### Enemy tiers

| Tier | Name | Power range | Gold |
|---|---|---|---|
| 1 | Slime | 1 – 9 | 1 |
| 2 | Bat | 10 – 99 | 2 |
| 3 | Serpent | 100 – 999 | 3 |
| 4 | Scorpion | 1,000 – 9,999 | 4 |
| 5 | Skeleton | 10,000 – 99,999 | 5 |
| 6 | Zombie | 100,000 – 999,999 | 6 |
| 7 | S. Warrior | 1M – 9,999,999 | 7 |
| 8 | Armor | 10M – 99,999,999 | 8 |
| 9 | Warlock | 100M – 999,999,999 | 9 |
| 10 | Demon | 1G and above | 10 |

Tier is a pure function of power (decade bands), so the sprite is redundant with
the badge value — a useful cross-check when extracting a map.

## 3. Terrain

Wall grid values in `res/maps/*` (to confirm against the draw code):
**0 = empty, 1 = Weak Wall (`wall.png`), 2 = Regular Wall
(`reinforced_wall.png`), 3 = Strong Wall (`iron_wall.png`)**. A converted Pop-Up
Wall is written as `2`, which matches "becomes a Regular Wall".


| Tile | Behaviour |
|---|---|
| **Empty** | Walkable. Rendered black in map exports. |
| **Regular Wall** | Impassable. Breakable by **Hyper Pickaxe** only. |
| **Weak Wall** | Impassable. Breakable by **Pickaxe** or **Hyper Pickaxe**. |
| **Strong Wall** | Impassable. Indestructible by any means. |
| **One-Way Wall** (N/E/S/W) | Walkable. The rule is **positional, not directional**: `barrier_u` admits entry only when `player.y >= ent.y`, and mirrored for the other three. Moving in from the same row/column is therefore allowed. |
| **Pop-Up Wall** | Walkable. Stepping on removes the entity and marks it pending; it becomes a **Regular Wall** (`walls = 2`) once the player leaves. Negated entirely by a Levitation Feather. Only **one** pop-up is pending at a time — `entitydef.popup.interact` converts the previous one when a new one is entered. |
| **Spikes** | Walkable trap, indestructible. Entering costs the shown power, every time. **Entry requires `power > value`** (strictly greater, exactly as for combat) unless holding a Levitation Feather. Confirmed in `entitydef.spikes.can_interact`. |
| **Stairs Up** / **Stairs Down** | Move the player to the **same `(x, y)`** on the adjacent floor. Always. What varies is whether a matching staircase exists there to come back — see §7. |

## 4. Gates and pickups

Gates block movement until paid. Paying moves the player onto the tile, which
becomes Empty.

| Gate | Cost |
|---|---|
| **Gold Gate** | The shown amount of gold. |
| **Gem Gate** | The shown number of gems (§6). **Master Key does not work.** |
| **Light Gate** | One Light Key. |
| **Dark Gate** | One Dark Key. |
| **Half Gate** | Halves the player's power, **rounding up**. 10 -> 5, 5 -> 3. |
| **Battle Gate** | Carries a counter that decrements each time an enemy is defeated **on the same floor**. When it would reach zero it opens (disappears) instead. |

Pickups accumulate without limit:

| Item | Effect |
|---|---|
| **Gold Bag** | `gold += shown amount` |
| **Light Key** / **Dark Key** | `+1` to the respective count |
| **Elixir** | `power *= 2` |
| **Pickaxe** | Adds one Pickaxe to the inventory. Each is later consumed to break one Weak Wall. |

## 5. Held items

**At most one at a time.** They divide into two classes, and the distinction
matters enormously for route value.

### 5.1 Consumables — single use, obligatory

Used automatically the moment an action can use them. There is no opting out.
Once used, the slot is empty.

| Item | Effect |
|---|---|
| **Master Key** | Opens any gate **except a Gem Gate** — Light, Dark, Gold, Half. On a Half Gate it removes the gate outright, so **no power is lost**. |
| **Vorpal Blade** | Defeats **any** enemy regardless of power. No power gained or lost; gold is still gained. **Expended on the next enemy attacked, whatever it is** — attacking a Slime you could have beaten wastes it. |
| **Dark Rod** | Doubles the power gained from the next **positive** enemy defeated. Does not change the power required to win. **Ignores negative enemies entirely** — no trigger, no effect, stays held. |
| **Light Rod** | The next **negative** enemy's power is **added** instead of subtracted, swinging the delta from −X to +X. **Ignores positive enemies entirely** — no trigger, no effect, stays held. |
| **Hyper Pickaxe** | Breaks **Weak and Regular** Walls. Not Strong Walls. **UNVERIFIED** whether single-use or persistent. |

The two rods are the cleanest illustration of the class: because they ignore the
wrong enemy sign rather than being wasted on it, a held rod survives arbitrarily
many irrelevant fights.

### 5.2 Passives — persist while held

Not consumed. They remain in effect **until the player picks up another held
item**, which replaces them.

| Item | Effect |
|---|---|
| **Golden Dagger** | `+2` gold for every enemy defeated. |
| **Golden Claymore** | Doubles gold obtained from every defeated enemy. |
| **Keysmasher** | On defeating an enemy, gain power equal to `lightKeys * darkKeys`. **Keys are not consumed.** |
| **Levitation Feather** | Walk over Spikes and Pop-Up Walls with no effect in either direction, indefinitely. |
| **Adamantine Shield** | Halves the power gained *and* lost from every enemy, **rounding up**. **UNVERIFIED** — rounding believed correct but untested. |

**Why the Shield is worth holding.** Halving gains looks purely bad, but it
lowers the entry cost of a blocked pair. An area guarded by a `-N` then a `+N`
enemy normally needs power `> 2N` to pass. With the Shield it needs only
`> 1.5N`: `N` to beat the first, which costs `0.5N`, leaving `N` to beat the
second. Rare, but decisive where it applies.

### 5.3 Pickup is mandatory

Moving onto a tile containing a held item **always** picks it up, and doing so
**discards whatever was held**, passive or consumable. There is no way to walk
over a held item while carrying one.

**Consequences for routing:**

- A tile containing a held item is effectively **one-way for value**: crossing
  it costs you whatever you were carrying.
- A route's worth can depend on *not* walking somewhere. The app must surface
  this — "entering here discards your Golden Claymore" — rather than letting a
  player discover it on replay.
- The value of a passive is therefore bounded by the geometry of the route
  after it, not just by its effect.

The in-game UI shows the currently held item, and the intro text states the
replacement rule.

## 6. Scoring and gems

Reaching and picking up the **Crown** wins the tower. The player's **power at
that moment is recorded as the score**, and a grade is awarded. The game does
**not** auto-exit — the player may undo or continue afterwards.

The **Dark Crown** doubles the score. It is hidden in an "ascension" section
that requires a high score to reach, usually costing gems. Its existence is
withheld from new players.

Gems are meta-progression: awarded per tower based on the player's **best**
score for that tower, against per-tower thresholds. Replaying a tower yields no
extra gems for an equal or worse score. Gems accumulate across all towers and
the player begins every run with their full stock available to spend on Gem
Gates.

**Score thresholds are out of scope** by decision — a later nicety, not needed
by the simulator.

## 7. Floor connectivity

The auto-pather is multi-floor and the player has a keyboard shortcut to jump
between floors, so reachability must be computed across the whole tower, not per
floor.

A staircase always lands the player at the **same `(x, y)`** on the adjacent
floor. What varies is whether a staircase exists at that destination to return:
**one-way connections exist**, where a Stairs Up has no corresponding Stairs
Down, or vice versa. Reference cases:

- **2-4 Descent Into Abyss**, floors 1–11: each has a Down Stair to the floor
  below with no matching Up Stair. A pure one-way descent.
- **1-2 Tower Of Might**, floors 3↔4: floor 3's top-left cell is an Up Stairs to
  floor 4 with no matching Down Stairs; floor 4's `(13,3)` is a Down Stairs to
  floor 3 with no matching Up Stairs. Two independent one-way links between the
  same pair of floors — a good stress case.

### Reachability

Flood fill from the current position over **state-neutral** tiles only. The
target is reachable iff the fill reaches it. The game's pather never routes
through a tile whose entry or exit changes state, which is why any state-neutral
path gives an identical outcome and its tie-breaking need not be replicated.

**One-way walls are governed by a user setting.** When enabled, include one-way
tiles in the fill but do not propagate *into* one from a direction its arrows
forbid. Believed to be a fallback — a regular path is attempted first, one-ways
used only if none exists. **UNVERIFIED.**

**The setting IS route metadata.** One-way traversal is not recorded
(`SAVE_FORMAT.md` §5.2), so replay depends on the pather being willing to cross.
A player with the setting disabled may be unable to replay a route that requires
a crossing. It must travel with any shared route. Confirmation pending
(`TODO.md` B5b).

## 8. Consequences for the simulator

- `applyTransition` must return a **set** of changed cells, not one cell. Battle
  Gates change tiles at a distance; stepping off a Pop-Up Wall onto a pickup
  changes two cells in one move.
- State is a pure function of `(initialTowerState, transitions[0..k])`. Undo
  need not invert anything — recompute instead. Mechanics are therefore **not**
  constrained to be locally invertible.
- Blocked moves must leave state completely unchanged.

## 10. Account meta-state affects towers

Discovered in `entitydef.lua`; not previously known.

**Royal Boon 1 — "Wealth of the Kings".** Every crown collected counts as an
additional gem. Changes the gem budget, and therefore which Gem Gates are
affordable.

**Royal Boon 2 — "Piercing Noble Sword".** A **Rapier of the Rulers** held item
**spawns** on every stage where the player has obtained a Dark Crown.

The second is structural: **a tower's contents are not fully determined by its
map file.** An entity is injected based on account progress. And the Rapier's own
strength scales with progress — `get_held_value` returns `total_crowns.."x"`.

So a route is a function of `(tower, account state)`, not of the tower alone. The
app must model at least `total_crowns`, `total_gems` and the royal boon flags as
route inputs, and a shared route must carry them or it may not reproduce.

**Orbs** are counters, not held items: `player.orbs.force/change/warp` are
incremented on pickup. Pickup is an ordinary recorded interaction; *using* an orb
is what produces the 5-tuple save entries. Their effects live in `game.lua` and
are not yet read.

Minor: `entitydef.orb_change.compendium_header` reads "Warp orb", duplicating
`orb_warp`. Looks like a copy-paste slip worth reporting to the developer.

## 9. Open questions

Ordered by how badly the simulator needs them.

1. **Orb effects** — read `game.lua`. Also what the two extra values in a
   5-tuple mean.
2. **Rapier of the Rulers** — effect, not just its `total_crowns` scaling.
3. **Hyper Pickaxe**: single-use consumable or persistent passive?
4. **Adamantine Shield**: confirm the round-up.
5. Where the general "step off a Pop-Up Wall" conversion happens — `entitydef`
   only handles popup-to-popup; the rest is in the movement code.
3. **Three unidentified sprites** on 1-5 floor 1. The most common occurs at
   `(3,13)`, `(5,2)`, `(2,5)`, `(7,6)` and symmetric partners — **probably
   Spikes**, since the pair `(3,14) -> (3,13)` is recorded *twice* in one route,
   which only makes sense for a tile whose cost applies on every entry. A second
   appears at `(1,4)` and `(15,4)`; a third, unique, at `(8,14)`.
4. **Spikes**: the exact entry threshold. Given power may never go negative and
   combat requires *strictly greater*, entry is probably refused when
   `power - spikeCost < 1`, but this is inference.
5. **One-way pathing setting**: is it fallback-only? Low priority — editor
   fidelity only, not replay correctness. See §7.
