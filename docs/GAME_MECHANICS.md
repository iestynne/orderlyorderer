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

The player defeats an enemy **only if `player.power > ent.value`**. Strictly
greater — equal power fails. `[F]` `_enemy_can_interact`, `entitydef.lua:109`.

`ent.value` is **always stored positive**; the sign lives in the entity type.
So a **−25 enemy also requires power > 25** to attack, even though beating it
costs power. This is not obvious in play and is easy to get wrong.

On defeat (`_enemy_interact`, `entitydef.lua:128`):

- `base = ent.value`, negated when `type == "enemy_neg"`.
- Held items form a **single `elseif` chain**, so they are mutually exclusive
  and their order is unreachable — see §5 for the full table.
- **Gold:** `gold += tier(ent.value)`, the tier index 1–10, then modified by
  Golden Dagger / Golden Claymore (§5).
- The player moves onto the enemy's cell, which becomes Empty.
- Every Battle Gate **on the player's floor** is decremented by 1; each that
  reaches exactly 0 opens. Already-open gates are skipped, so values never go
  below 0.

`[F]` **`modify_player_power` does not clamp.** The only clamp is
`power = min(power, MAX_POWER)` applied once per move in `Game:move_dir`
(`game.lua:1545`), after the interaction. There is no lower clamp — power stays
≥ 1 only because every entry rule requires strictly-greater power first.

Every tier has a positive and a negative variant. The negative sprite is the
positive one inverted with a white outline; see
`NOTES_map_extraction_deferred.md`.

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

Wall grid values in `res/maps/*`, **confirmed against the movement code**
(`game.lua:1421-1509`, which tests `3`, then `2`, then `1` in that order):
**0 = empty, 1 = Weak Wall (`wall.png`), 2 = Regular / Reinforced Wall
(`reinforced_wall.png`), 3 = Strong / Iron Wall (`iron_wall.png`)**. A converted
Pop-Up Wall is written as `2` (`entitydef.lua:938`, `game.lua:1569`), which
matches "becomes a Regular Wall".

**Digging precedence.** On a Weak Wall the game spends an ordinary Pickaxe
*first*; the Hyper Pickaxe branch is an `elseif` reached only when
`pickaxes == 0`. So a player carrying both loses the ordinary one. On a
Reinforced Wall only the Hyper Pickaxe works, and it is consumed
(`held_item = nil`) in both cases. A blocked dig moves nobody and consumes
nothing.


| Tile | Behaviour |
|---|---|
| **Empty** | Walkable. Rendered black in map exports. |
| **Regular Wall** | Impassable. Breakable by **Hyper Pickaxe** only. |
| **Weak Wall** | Impassable. Breakable by **Pickaxe** or **Hyper Pickaxe**. |
| **Strong Wall** | Impassable. Indestructible by any means. |
| **One-Way Wall** (N/E/S/W) | Walkable. The rule is **positional, not directional**: `barrier_u` admits entry only when `player.y >= ent.y`, and mirrored for the other three. Moving in from the same row/column is therefore allowed. |
| **Pop-Up Wall** | Walkable. Stepping on removes the entity and marks it pending; it becomes a **Regular Wall** (`walls = 2`) once the player leaves. Negated entirely by a Levitation Feather. Only **one** pop-up is pending at a time — `entitydef.popup.interact` converts the previous one when a new one is entered, and `Game:popup_check` (`game.lua:1560`) converts it on any other move away. `popup_check` compares **floor as well as x/y**, so taking stairs off a pop-up converts it too. It is called from every exit path of `Game:move_dir`, including the blocked ones, where it is a no-op because the player has not moved. |
| **Spikes** | Walkable trap, indestructible. Entering costs the shown power, every time. **Entry requires `power > value`** (strictly greater, exactly as for combat) unless holding a Levitation Feather. Confirmed in `entitydef.spikes.can_interact`. |
| **Stairs Up** / **Stairs Down** | Move the player to the **same `(x, y)`** on the adjacent floor. Always. What varies is whether a matching staircase exists there to come back — see §7. |

## 4. Gates and pickups

Gates block movement until paid. Paying moves the player onto the tile, which
becomes Empty.

| Gate | Cost |
|---|---|
| **Gold Gate** (`money_door`) | The shown amount of gold. `gold >= value` to enter. |
| **Gem Gate** (`gem_door`) | The shown number of gems (§6). **Master Key does not work.** |
| **Light Gate** (`door`) | One Light Key. |
| **Dark Gate** (`dark_door`) | One Dark Key. |
| **Half Gate** (`gate`) | `power -= floor(power/2)`, i.e. halves **rounding up**. 10 -> 5, 7 -> 4. |
| **Battle Gate** | Carries a counter that decrements each time an enemy is defeated **on the same floor**. When it would reach zero it opens (disappears) instead. |

`[F]` A **Master Key** substitutes for every gate above **except the Gem Gate**,
and is consumed. On a Half Gate it opens the gate with **no power loss** at all.

Pickups accumulate without limit:

| Item | Effect |
|---|---|
| **Gold Bag** (`money`) | `gold += ent.value` — the only pickup that reads `value` |
| **Light Key** / **Dark Key** | **`+1`**, always. `[F]` The tile's `value` is ignored. |
| **Elixir** | `power += min(power, 1_000_000_000)`. `[F]` **Not** `power *= 2` — the gain has its own cap, separate from `MAX_POWER`. At 3e9 power an Elixir yields 4e9. With the tower's `uncapped_elixirs` flag it is `power += power`. |
| **Pickaxe** | **`+1`**, always. Each is later consumed to break one Weak Wall. |

### 4.1 `negative_keys` rewrites the whole key system

`[F]` Tower flag bit 0, used only by **EX-3**. It is far more than the
Keysmasher formula change previously recorded. With it set, there is **one**
key counter, `player.keys`, and **it may go negative**:

| | normal | `negative_keys` |
|---|---|---|
| Pick up Light Key | `keys += 1` | `keys += 1` |
| Pick up Dark Key | `dark_keys += 1` | **`keys -= 1`** |
| Light Gate needs | `keys > 0` | `keys > 0` |
| Light Gate pays | `keys -= 1` | `keys -= 1` |
| Dark Gate needs | `dark_keys > 0` | **`keys < 0`** |
| Dark Gate pays | `dark_keys -= 1` | **`keys += 1`** |
| Keysmasher bonus | `keys * dark_keys` | **`keys * keys`** |

`dark_keys` is dead under the flag — permanently 0, which is exactly why the
Keysmasher needs a squared special case rather than the usual product.

**Consequence for the simulator:** the invariant "keys are non-negative" is
false on EX-3, and a model with two independent counters cannot replay it at
all. Carry the flag into the key rules, not just into the Keysmasher.

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
| **Hyper Pickaxe** | Breaks **Weak and Regular** Walls. Not Strong Walls. `[F]` **Single-use** — `held_item = nil` on both branches. On a Weak Wall it is only reached when `pickaxes == 0`, so an ordinary Pickaxe is always spent first. |

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
| **Keysmasher** | On defeating an enemy, the bonus `lightKeys * darkKeys` (or `lightKeys²` under `negative_keys`, §4.1) is **added to the enemy's signed base value**, not applied instead of it. **Keys are not consumed.** On a negative enemy the bonus offsets the loss and can turn it into a gain. |
| **Levitation Feather** | Walk over Spikes and Pop-Up Walls with no effect in either direction, indefinitely. |
| **Adamantine Shield** | Halves the power gained *and* lost from every enemy. `[F]` **Signed floor**, not round-up: `modify_player_power(math.floor(base/2))`. +5 -> +2, +25 -> +12, **-25 -> -13**. It never changes the power *required* to win. |

**Why the Shield is worth holding.** Halving gains looks purely bad, but it
lowers the entry cost of a blocked pair. An area guarded by a `-N` then a `+N`
enemy normally needs power `> 2N` to pass. With the Shield it needs only
`> 1.5N`: `N` to beat the first, which costs `0.5N`, leaving `N` to beat the
second. Rare, but decisive where it applies.

### 5.3 Combat resolution, exactly as the game does it

`[F]` `_enemy_interact`, `entitydef.lua:128-215`. One `elseif` chain, evaluated
in this order. `base` is `ent.value`, negated for `enemy_neg`.

| Branch | Guard | Power delta | Consumed |
|---|---|---|---|
| Vorpal Blade | held | **none at all** — `modify_player_power` is not called | yes |
| Dark Rod | held **and `type == "enemy"`** | `+ent.value * 2` (= `base*2`) | yes |
| Light Rod | held **and `type == "enemy_neg"`** | `+ent.value` (= `-base`) | yes |
| Adamantine Shield | held | `floor(base / 2)` | no |
| Keysmasher | held | `base + bonus` (§5.2) | no |
| Rapier of the Rulers | held | `base + total_crowns * tier` | no |
| — | otherwise | `base` | — |

**The rod guards test the entity type, not the sign of `base`.** Equivalent in
practice, because values are always stored positive — but it is what makes a
rod fall through to the plain `else` branch on the wrong enemy sign, taking the
ordinary delta and **staying held**. That is the "ignores it entirely"
behaviour of §5.1, and it needs no experiment to confirm.

Gold is computed after the chain and is independent of it:
`gold += tier(ent.value)`, then `+2` for a Golden Dagger or `×2` for a Golden
Claymore (also an `elseif` — they cannot combine).

`[F]` The Rapier's tier loop is `while val >= 10 and tier <= 10`, which lets
tier reach **11** for values ≥ 1e10 — unlike the gold loop's `money_gain < 10`,
which caps at 10. Almost certainly a slip in the game, and moot while the
Rapier is out of scope, but do not share one `tier()` between them without
noticing it.

### 5.4 Pickup is mandatory

`[F]` Confirmed in the source, and it was the highest-priority open mechanic.
Every held-item entity's `can_interact` is `function() return true end` and its
`interact` assigns `game.player.held_item = "<name>"` unconditionally. There is
no branch that can decline. So moving onto a tile containing a held item
**always** picks it up, and doing so **discards whatever was held**, passive or
consumable. There is no way to walk over a held item while carrying one.

**Worked example — Joker's Gate, tower 2-5 floor 13.** `[I]` iestyn's reading,
confirmed against the map data. Row 8 of that floor runs:

```
x:  1 2 3 4  5   6 7 8 9 10 11   12
    . . . . [>]  w w w w w  w   [Keysmasher]
```

A one-way wall, then **six Weak Walls in a row**, then a **Keysmasher** sitting
immediately beyond them. The six walls separate the tower's first tranche of
floors from the second, and the natural reading is "a Hyper Pickaxe is not meant
to be smuggled across". But the Weak Walls do not enforce that — a Hyper Pickaxe
opens one, and ordinary Pickaxes open the rest.

**The Keysmasher is what enforces it.** Pickup is mandatory, so crossing the gate
and continuing means picking it up, which destroys whatever was held. The
level design uses the *item-replacement* rule, not the wall rule, to do the
gating — which is why the wall-precedence question (`§3`) turns out not to
change the gate at all, only what you spend on it.

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

### 6.1 The exact gem derivation — read from the source

`util.get_total_gems()` (`util.lua:61-82`):

```
gems = 0
for each map file:
    if score_file has an entry for metadata.name:
        _, top_gems = calculate_grade(metadata.grades, score)
        gems += top_gems
if unlock flag royal_boon1: gems += get_total_crowns()
```

`util.calculate_grade(grades, score)` (`util.lua:33-59`) returns the **gem count
as the grade index**: `D`/`E` → 0, `C` → 1, `B` → 2, `A` → 3, `S` → 4, `★` → 5,
and `★+N` → `5+N`. Overscores step by `grades[6]`, and past 100 overscores the
step widens to `floor(grades[6]*overscores/100)`. `grades` is the six-value
metadata array `[C, B, A, S, ★, overscore]` that SPEC-002 already parses.

`util.get_total_crowns()` sums `crown_data[name]` over all maps, where the tier
is `1` for a Crown and `2` for a Dark Crown.

**So the `crown` file matters, and `royal_boon1` is obtainable.** The boon is
injected into 1-6 floor 25 directly beneath that tower's Dark Crown (§9.1), so
any player who has taken the 1-6 Dark Crown has it. With it set, a tower holding
a Dark Crown contributes **2** extra gems and a Crown-only tower **1**, on top of
its grade gems. Without it, crowns contribute nothing.

**Therefore computing `gemsOwned` needs three inputs**: the tower `grades` (in
the map data), the player's `score` file, and the player's `crown` file. The
`unlocks` file supplies the `royal_boon1` flag — but that flag is derivable, since
holding a Dark Crown in 1-6 is exactly the condition for having been able to
collect it.

**The two player files.** `scores.lua` reads two files from the game's save
directory, named `score` and `crown` (no extension, and note the **singular**
names). Each is plain alternating lines: tower name, then value.

### 6.2 What a Crown submits

`entitydef.crown.interact` → `scores:submit(name, player.power, 1)`.
`entitydef.dark_crown.interact` → `scores:submit(name, min(player.power*2,
MAX_POWER), 2)` (`entitydef.lua:860-901`).

`Scores:submit` keeps the **maximum** in each file independently: it overwrites
`score_data[level]` only when `score > ` the stored value, and
`crown_data[level]` only when `crown_tier > ` the stored tier. Neither crown
ends the run, so one run can submit both; the file keeps the larger.

**Score thresholds are no longer out of scope** — the derivation above is
cheap, exact, and is what turns `gemsOwned` from a UI input into a computed
value. It is still not on the critical path: the simulator takes `gemsOwned`
as an input either way.

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

## 9. Account meta-state affects towers

Discovered in `entitydef.lua`; not previously known.

**Royal Boon 1 — "Wealth of the Kings".** Every crown collected counts as an
additional gem. Changes the gem budget, and therefore which Gem Gates are
affordable. **Gem budget only** — it does not change tower contents. Verified in
the source: `royal_boon1.interact` sets one unlock flag and recomputes
`total_gems`, and the only consumer of that flag is the
`gems += get_total_crowns()` line in `util.get_total_gems` (§6.1). Nothing else
reads it.

**Royal Boon 2 — "Piercing Noble Sword".** A **Rapier of the Rulers** held item
**spawns** on every stage where the player has obtained a Dark Crown.

The second is the structural one: **a tower's contents are not fully determined
by its map file.** An entity is injected based on account progress. And the
Rapier's own strength scales with progress — `get_held_value` returns
`total_crowns.."x"`.

### 9.1 `level_scripts.lua` — the map file is not the initial state

`[F]` `game.lua:525-527` runs a per-tower script immediately after loading the
level data, and **13 of the 16 towers have one**. This was missed entirely until
2026-08-28; it is the mechanism behind both royal boons and it does more than
add entities.

**The two boon pickups**, each present only while not yet unlocked:

| Boon | Where |
|---|---|
| `royal_boon1` | **1-6 floor 25 "Diploma", cell (8,8)** — directly below the Dark Crown at (8,7), so it is collected as part of reaching it |
| `royal_boon2` | **2-6 floor 75 "The Champion", cell (5,8)** — the last floor of the largest tower |

Both cells are plain empty floor in the shipped map data, so a tower JSON gives
no hint they exist.

**The Rapier injections.** Every other script body is the same shape:

```lua
if unlocks.flags["royal_boon2"] and scores.crown_data[thisTower] == 2 then
    -- add a `rapier` entity at a fixed cell
    -- then edit walls to open a route to it
end
```

Two conditions, both account state: the boon must be unlocked **and** the player
must already hold a **Dark Crown in that specific tower**.

`[F]` **The wall edits are not merely additive.** Most scripts set walls to `0`
to carve a passage — 2-2 opens 15 cells, 1-1 opens 14 — but **2-1 also sets ten
walls to `2`**, raising new Reinforced Walls. So the boon can make a tower
*harder* to traverse as well as easier, and a diff against the shipped map is
not a subset relation.

**Consequences for this tool:**

1. A tower's initial state is a function of `(map file, unlock flags,
   per-tower crown tier)`. `data/towers/` holds only the first.
2. **A shared route must carry the account state it was built under**, or it may
   not reproduce. This is the concrete case `§9` warns about in the abstract.
3. Our replay sweep (`RESULTS.md`) is valid *for an account without
   `royal_boon2`*. Once that boon is obtained, 13 towers change shape and old
   routes may replay differently.

So a route is a function of `(tower, account state)`, not of the tower alone. The
app must model at least `total_crowns`, `total_gems` and the royal boon flags as
route inputs, and a shared route must carry them or it may not reproduce.

**Orbs** are counters, not held items: `player.orbs.force/change/warp` are
incremented on pickup. Pickup is an ordinary recorded interaction; *using* an orb
is what produces the 5-tuple save entries. Their effects live in `game.lua` and
are not yet read.

Minor: `entitydef.orb_change.compendium_header` reads "Warp orb", duplicating
`orb_warp`. Looks like a copy-paste slip worth reporting to the developer.

## 10. Open questions

Ordered by how badly the simulator needs them.

1. **Orb effects** — read `game.lua`. Also what the two extra values in a
   5-tuple mean.
2. **Rapier of the Rulers** — effect, not just its `total_crowns` scaling.
3. **Keysmasher: total or bonus?** `keysmasherBonus()` is added **to** the
   enemy's base value in the Lua, but the HUD shows only the bonus. This is the
   one open mechanic that moves every downstream power number, and it is
   settled by a single in-game test — see `TODO.md` B8.
4. **One-way pathing setting**: is it fallback-only? Low priority — editor
   fidelity only, not replay correctness. See §7.
5. **One unidentified sprite** on 1-5 floor 1, at `(1,4)` and `(15,4)`.

**Answered since this list was written** (do not re-ask):

- *Hyper Pickaxe: consumable or passive?* **Consumable.** `held_item = nil` on
  both the Weak-Wall and Reinforced-Wall branches — §3.
- *Adamantine Shield rounding.* **Signed floor**, not round-up:
  `math.floor(base/2)`, so −25 → −13. Measured in game and read in source.
- *Where the general pop-up step-off conversion happens.* `Game:popup_check`
  (`game.lua:1560`), called from every movement exit path.
- *Spikes entry threshold.* `power > value`, strictly, exactly as for combat.
- *The Spikes sprite on 1-5 floor 1.* Confirmed; in `SPRITES.json`.
