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

/** An item an action used up. `pickaxe` is the counter, not a held item. */
export type Spent = HeldItem | "pickaxe" | null;

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
  opts: { error?: SimError; noop?: boolean } = {},
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
    spent:
      before.held !== null && after.held === null
        ? before.held
        : after.pickaxes < before.pickaxes
          ? "pickaxe"
          : null,
    held: before.held !== null && after.held === before.held ? before.held : null,
    goldGained: after.gold - before.gold,
    powerDelta: after.power - before.power,
  };
  if (opts.error !== undefined) summary.error = opts.error;
  return summary;
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
