// SPEC-008 §4.2 — what an action did, for the Action List.
//
// `[D]` Derived, never stored. The cell is read **as it was before the action**
// and the player from either side of it, both of which the journal already
// holds (SPEC-004 §8), so nothing here adds state to the document.
//
// `[D]` It reads *outcomes*, not rules. Whether an item was spent is decided by
// whether the player still holds it, because `resolveEntry` sets `held = null`
// exactly where the game consumes one — restating that list here would be a
// paraphrase of a rule with one home (D33), and would drift from it.
//
// `[D]` It hands back the **cell**, not an icon. `atlas.ts` already turns a cell
// into a sprite stem, enemy decades and wall values included, so naming the art
// here would be a second copy of that mapping (D11).
//
// Pure module: no UI imports (D7).

import { effectiveCell, isEntity, towerCell } from "../grid";
import { killGold } from "../rules";
import type { Cell, HeldItem, Player, SimError, TowerJSON, Waypoint } from "../types";

export type ActionKind =
  | "attack"
  | "gate"
  | "pickup"
  | "dig"
  | "hazard"
  | "stairs"
  | "crown"
  | "walk"
  | "blocked"
  /**
   * `[I]` The action found its work already done — insert a kill for an enemy
   * the route kills later, and the later one has nothing left to do. It is not
   * a failure and not an error; it simply does nothing, so it says nothing.
   */
  | "noop";

/**
 * What an action used up: a held item, or one of the counters.
 *
 * `[F]` Not every cost is a held item — a Light Door takes a key, a Money Gate
 * takes gold, a Gem Gate takes gems, a Weak Wall takes a pickaxe — and the row
 * that says what an action spent has to be able to name all of them.
 */
export type Spent = HeldItem | "pickaxe" | "key" | "dark_key" | "money" | "gem" | null;

export interface ActionSummary {
  kind: ActionKind;
  /** The cell as it stood before the action: an entity, or a bare wall value. */
  cell: Cell;
  spent: Spent;
  /** An item that changed the outcome without being consumed — shield, keysmasher. */
  held: HeldItem | null;
  goldGained: number;
  powerDelta: number;
  /** Set where this action is the one the route fails at. */
  error?: SimError;
}

/**
 * `[F]` The items the rules consume are exactly those a successful action can
 * leave `null` behind: the Master Key on any door, the Vorpal Blade and the two
 * rods on an enemy, the Hyper Pickaxe on a wall. A Shield or a Keysmasher
 * changes the arithmetic and survives, so it is reported as `held`, not `spent`.
 */
export function describeAction(
  tower: TowerJSON,
  /** Cell state as it stood *before* the action — a `Cursor` at the previous stop. */
  cells: Uint8Array,
  before: Player,
  after: Player,
  target: Waypoint,
  opts: { error?: SimError; noop?: boolean; projected?: boolean } = {},
): ActionSummary {
  const now = effectiveCell(tower, cells, target.z, target.x, target.y);
  // `[F]` A recorded action always changed state (SAVE_FORMAT §3), so one whose
  // cell reads as **empty floor** changed it somewhere else — and the pop-up
  // chain is the only rule that does, reinforcing the pop-up behind the player
  // as they step onto the next one. The square the row should name is the
  // pop-up the tower has there, not the floor the chain has left behind.
  const own = towerCell(tower, target.z, target.x, target.y);
  const cell = now === 0 && isEntity(own) ? own : now;
  const summary: ActionSummary = {
    kind: opts.noop === true ? "noop" : kindOf(cell),
    cell,
    spent: spentBy(cell, before, after),
    held: before.held !== null && after.held === before.held ? before.held : null,
    goldGained: opts.projected === true ? projectedGold(cell, before.held) : after.gold - before.gold,
    powerDelta: after.power - before.power,
  };
  if (opts.error !== undefined) summary.error = opts.error;
  return summary;
}

/**
 * What this action *would* pay, for an action past the route's break.
 *
 * `[I]` iestyn: past a failure the simulation has not run, so the measured
 * delta is zero and the gold column goes blank down the whole grey tail — at
 * exactly the moment a player is asking whether they can afford what comes
 * next. The purse items held at the break are known, and they change only when
 * one is picked up, so evaluating the gain from the cell and that held item is
 * right unless the tail itself picks a new one up. `[D]` **Wrong sometimes is
 * the right trade here, and the row already makes it**: the "what was expended"
 * slot is filled past the break on the same reasoning, and a column that is
 * blank is not more honest than one that is usually right — it is just less
 * use. The grey tail is what says none of this has happened.
 */
function projectedGold(cell: Cell, held: HeldItem | null): number {
  if (!isEntity(cell)) return 0;
  if (cell.type === "enemy" || cell.type === "enemy_neg") return killGold(cell.value, held);
  if (cell.type === "money") return cell.value;
  return 0;
}

/**
 * `[F]` A held item is spent exactly where the rules leave `held` null, and the
 * counters are spent exactly where they fall — both are outcomes, not rules
 * restated (D33). The two doors are the one place the outcome is ambiguous: on
 * a `negative_keys` tower a Dark Door *raises* the light-key count rather than
 * lowering a dark one, so the door itself says which key it took.
 */
function spentBy(cell: Cell, before: Player, after: Player): Spent {
  if (before.held !== null && after.held === null) return before.held;
  if (after.pickaxes < before.pickaxes) return "pickaxe";
  if (isEntity(cell)) {
    if (cell.type === "door") return "key";
    if (cell.type === "dark_door") return "dark_key";
  }
  if (after.gemsSpent > before.gemsSpent) return "gem";
  if (after.gold < before.gold) return "money";
  if (after.lightKeys < before.lightKeys) return "key";
  if (after.darkKeys < before.darkKeys) return "dark_key";
  return null;
}

export function kindOf(cell: Cell): ActionKind {
  if (!isEntity(cell)) {
    // Bare terrain: 0 is a walk, 1 and 2 are walls dug through, 3 is iron and
    // cannot be entered at all.
    if (cell === 1 || cell === 2) return "dig";
    return cell === 3 ? "blocked" : "walk";
  }
  switch (cell.type) {
    case "enemy":
    case "enemy_neg":
      return "attack";
    case "door":
    case "dark_door":
    case "money_door":
    case "gem_door":
    case "gate":
    case "battle_gate":
      return "gate";
    case "spikes":
    case "popup":
    case "barrier_u":
    case "barrier_d":
    case "barrier_l":
    case "barrier_r":
      return "hazard";
    case "stairs_up":
    case "stairs_down":
      return "stairs";
    case "crown":
    case "dark_crown":
      return "crown";
    default:
      // Keys, pickaxes, money, elixirs and every held item are picked up.
      return "pickup";
  }
}
