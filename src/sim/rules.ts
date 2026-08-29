// SPEC-004 §6 — cell rules. One switch, evaluated as a pure check that either
// rejects the entry or hands back an effect to apply. Nothing mutates until the
// caller runs the effect, which is what makes phases 1-2 of §4.1 pure.

import { addr, effectiveCell, isEntity } from "./grid";
import {
  CellState,
  ELIXIR_CAP,
  MAX_POWER,
  type Addr,
  type Cell,
  type CellEntity,
  type ErrorCode,
  type HeldItem,
  type Player,
  type TowerJSON,
} from "./types";

export interface RunState {
  tower: TowerJSON;
  cells: Uint8Array;
  kills: Int32Array; // per floor, indexed z - 1
  gemsOwned: number;
  negativeKeys: boolean;
  uncappedElixirs: boolean;
}

export interface Rejection {
  code: ErrorCode;
  have?: number;
  need?: number;
}

export interface Acceptance {
  /** Power this move demanded; 0 if none. SPEC-004 §8. */
  requirement: number;
  /** Phases 3-4: mutates the player, records edits, reports a kill. */
  apply: (p: Player, edit: (a: Addr, after: CellState) => void, killed: (z: number) => void) => void;
}

export type Resolution = { ok: false; why: Rejection } | { ok: true; effect: Acceptance };

const HELD_ITEMS = new Set<string>([
  "vorpal", "golden_dagger", "golden_claymore", "light_rod", "dark_rod",
  "master_key", "hyper_pickaxe", "feather", "shield", "keysmasher",
]);

const UNSUPPORTED = new Set<string>([
  "orb_force", "orb_change", "orb_warp", "rapier",
  "royal_boon1", "royal_boon2", "stairs_up_ex_4", "stairs_down_ex_4",
]);

export function isStairs(c: Cell): boolean {
  return isEntity(c) && (c.type === "stairs_up" || c.type === "stairs_down");
}

/** Decimal digit count, capped at 10. Never Math.log10 (SPEC-004 §6). */
export function tier(v: number): number {
  let t = 1;
  let n = Math.abs(v);
  while (n >= 10 && t < 10) {
    n = n / 10;
    t++;
  }
  return t;
}

/** The ONLY place an enemy value acquires a sign (SPEC-004 §6). */
export function signedBase(ent: CellEntity): number {
  return ent.type === "enemy_neg" ? -ent.value : ent.value;
}

export function keysmasherBonus(p: Player, negativeKeys: boolean): number {
  return negativeKeys ? p.lightKeys * p.lightKeys : p.lightKeys * p.darkKeys;
}

const reject = (code: ErrorCode, have?: number, need?: number): Resolution => ({ ok: false, why: { code, have, need } });
const accept = (requirement: number, apply: Acceptance["apply"]): Resolution => ({ ok: true, effect: { requirement, apply } });

/**
 * Can the player enter (z, x, y), and what happens if they do?
 * The player position matters only to the one-way walls, whose rule is
 * positional rather than directional.
 */
export function resolveEntry(rs: RunState, p: Player, z: number, x: number, y: number): Resolution {
  const cell = effectiveCell(rs.tower, rs.cells, z, x, y);
  const a = addr(rs.tower, z, x, y);

  // --- terrain: a bare wall value ---
  if (!isEntity(cell)) {
    if (cell === 0) return accept(0, () => {});
    if (cell === 3) return reject("BLOCKED_IRON");
    if (cell === 2) {
      if (p.held !== "hyper_pickaxe") return reject("NEED_HYPER_PICKAXE");
      return accept(0, (pl, edit) => {
        pl.held = null;
        edit(a, CellState.Gone);
      });
    }
    // cell === 1, a Weak Wall. The ordinary Pickaxe is spent FIRST; the Hyper
    // Pickaxe branch is an elseif reached only when pickaxes === 0
    // (game.lua:1460-1500).
    if (p.pickaxes > 0) {
      return accept(0, (pl, edit) => {
        pl.pickaxes -= 1;
        edit(a, CellState.Gone);
      });
    }
    if (p.held === "hyper_pickaxe") {
      return accept(0, (pl, edit) => {
        pl.held = null;
        edit(a, CellState.Gone);
      });
    }
    return reject("NEED_PICKAXE", p.pickaxes, 1);
  }

  const e = cell;
  if (UNSUPPORTED.has(e.type)) return reject("UNSUPPORTED_ENTITY");

  switch (e.type) {
    case "stairs_up":
    case "stairs_down":
      return accept(0, () => {});

    case "enemy":
    case "enemy_neg": {
      if (!(p.power > e.value) && p.held !== "vorpal") {
        return reject("ENEMY_TOO_STRONG", p.power, e.value + 1);
      }
      const base = signedBase(e);
      return accept(e.value + 1, (pl, edit, killed) => {
        if (pl.held === "vorpal") {
          pl.held = null;
        } else if (pl.held === "dark_rod" && e.type === "enemy") {
          pl.held = null;
          pl.power += base * 2;
        } else if (pl.held === "light_rod" && e.type === "enemy_neg") {
          pl.held = null;
          pl.power += -base;
        } else if (pl.held === "shield") {
          pl.power += Math.floor(base / 2);
        } else if (pl.held === "keysmasher") {
          pl.power += base + keysmasherBonus(pl, rs.negativeKeys);
        } else {
          pl.power += base;
        }
        let gain = tier(e.value);
        if (pl.held === "golden_dagger") gain += 2;
        else if (pl.held === "golden_claymore") gain *= 2;
        pl.gold += gain;
        edit(a, CellState.Gone);
        killed(z);
      });
    }

    case "spikes": {
      if (p.held === "feather") return accept(0, () => {});
      if (!(p.power > e.value)) return reject("SPIKE_TOO_STRONG", p.power, e.value + 1);
      return accept(e.value + 1, (pl) => {
        pl.power -= e.value;
      });
    }

    case "popup":
      // §4.2. The commit-on-leave half is phase 7, in the pipeline.
      if (p.held === "feather") return accept(0, () => {});
      return accept(0, (pl, edit) => {
        if (pl.pendingPopup !== null) edit(pl.pendingPopup, CellState.Reinforced);
        edit(a, CellState.Gone);
        pl.pendingPopup = a;
      });

    case "barrier_u":
    case "barrier_d":
    case "barrier_l":
    case "barrier_r":
      if (!oneWayAllows(e.type, p, x, y)) return reject("BLOCKED_ONE_WAY");
      return accept(0, () => {});

    case "door":
      if (p.held === "master_key") return accept(0, (pl, edit) => { pl.held = null; edit(a, CellState.Gone); });
      if (!(p.lightKeys > 0)) return reject("NEED_LIGHT_KEY", p.lightKeys, 1);
      return accept(0, (pl, edit) => { pl.lightKeys -= 1; edit(a, CellState.Gone); });

    case "dark_door":
      if (p.held === "master_key") return accept(0, (pl, edit) => { pl.held = null; edit(a, CellState.Gone); });
      if (rs.negativeKeys) {
        if (!(p.lightKeys < 0)) return reject("NEED_DARK_KEY", p.lightKeys, -1);
        return accept(0, (pl, edit) => { pl.lightKeys += 1; edit(a, CellState.Gone); });
      }
      if (!(p.darkKeys > 0)) return reject("NEED_DARK_KEY", p.darkKeys, 1);
      return accept(0, (pl, edit) => { pl.darkKeys -= 1; edit(a, CellState.Gone); });

    case "money_door":
      if (p.held === "master_key") return accept(0, (pl, edit) => { pl.held = null; edit(a, CellState.Gone); });
      if (!(p.gold >= e.value)) return reject("NEED_GOLD", p.gold, e.value);
      return accept(0, (pl, edit) => { pl.gold -= e.value; edit(a, CellState.Gone); });

    case "gem_door":
      // The Master Key does not substitute here, and is not consumed.
      if (!(p.gemsSpent + e.value <= rs.gemsOwned)) {
        return reject("NEED_GEMS", rs.gemsOwned - p.gemsSpent, e.value);
      }
      return accept(0, (pl, edit) => { pl.gemsSpent += e.value; edit(a, CellState.Gone); });

    case "gate": // Half Gate
      if (p.held === "master_key") return accept(0, (pl, edit) => { pl.held = null; edit(a, CellState.Gone); });
      return accept(0, (pl, edit) => { pl.power -= Math.floor(pl.power / 2); edit(a, CellState.Gone); });

    case "battle_gate":
      if (p.held === "master_key") return accept(0, (pl, edit) => { pl.held = null; edit(a, CellState.Gone); });
      return reject("BLOCKED_BATTLE_GATE", rs.kills[z - 1], e.value);

    case "key":
      return accept(0, (pl, edit) => { pl.lightKeys += 1; edit(a, CellState.Gone); });

    case "dark_key":
      return accept(0, (pl, edit) => {
        if (rs.negativeKeys) pl.lightKeys -= 1;
        else pl.darkKeys += 1;
        edit(a, CellState.Gone);
      });

    case "pickaxe":
      return accept(0, (pl, edit) => { pl.pickaxes += 1; edit(a, CellState.Gone); });

    case "money":
      return accept(0, (pl, edit) => { pl.gold += e.value; edit(a, CellState.Gone); });

    case "elixir":
      return accept(0, (pl, edit) => {
        pl.power += rs.uncappedElixirs ? pl.power : Math.min(pl.power, ELIXIR_CAP);
        edit(a, CellState.Gone);
      });

    case "crown":
      // Both crowns persist, and neither ends the run.
      return accept(0, (pl) => {
        if (pl.win === 0) pl.win = 1;
        pl.submittedScore = Math.max(pl.submittedScore, pl.power);
      });

    case "dark_crown":
      return accept(0, (pl) => {
        pl.win = 2;
        pl.submittedScore = Math.max(pl.submittedScore, Math.min(pl.power * 2, MAX_POWER));
      });

    default:
      if (HELD_ITEMS.has(e.type)) {
        return accept(0, (pl, edit) => {
          pl.held = e.type as HeldItem;
          edit(a, CellState.Gone);
        });
      }
      return reject("UNSUPPORTED_ENTITY");
  }
}

/**
 * SPEC-004 §6. The direction letter names the BLOCKED side, and the rule is
 * positional rather than directional: three of four approaches always work.
 */
export function oneWayAllows(type: string, p: { x: number; y: number }, x: number, y: number): boolean {
  switch (type) {
    case "barrier_u": return p.y >= y;
    case "barrier_d": return p.y <= y;
    case "barrier_l": return p.x >= x;
    case "barrier_r": return p.x <= x;
    default: return true;
  }
}
