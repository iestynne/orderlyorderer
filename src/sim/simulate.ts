// SPEC-004 §4 — resolving waypoints, and §4.1 the step pipeline.

import { addr, coords, depth, effectiveCell, isEntity, SimAssertionError } from "./grid";
import { pathfind } from "./pathfind";
import { resolveEntry, type RunState } from "./rules";
import {
  CellState,
  MAX_POWER,
  W,
  type Addr,
  type CellEdit,
  type Player,
  type SimError,
  type SimInput,
  type Step,
  type Timeline,
  type Waypoint,
} from "./types";

/** SPEC-004 §2.1. The first line of simulate(), read from game.lua:473-480. */
export function initialPlayer(input: SimInput): Player {
  const m = input.tower.metadata;
  return {
    z: m.start_floor,
    x: m.start_x,
    y: m.start_y,
    power: m.start_power,
    gold: 0,
    lightKeys: 0,
    darkKeys: 0,
    pickaxes: 0,
    gemsSpent: 0,
    held: null,
    pendingPopup: null,
    win: 0,
    submittedScore: 0,
  };
}

function clonePlayer(p: Player): Player {
  return { ...p };
}

export function simulate(input: SimInput): Timeline {
  const { tower, gemsOwned, route } = input;
  const D = depth(tower);
  const flags = tower.metadata.computed_flags;

  const rs: RunState = {
    tower,
    cells: new Uint8Array(D * W * W),
    kills: new Int32Array(D),
    gemsOwned,
    negativeKeys: flags.negative_keys === true,
    uncappedElixirs: flags.uncapped_elixirs === true,
  };

  const initial = initialPlayer(input);
  let player = clonePlayer(initial);
  const steps: Step[] = [];

  const fail = (waypointIndex: number, at: Waypoint, code: SimError["code"], stepIndex: number | null, have?: number, need?: number): Timeline => ({
    tower,
    initial,
    steps,
    error: { waypointIndex, stepIndex, code, at, have, need },
  });

  for (let wi = 0; wi < route.length; wi++) {
    const wp = route[wi]!;

    if (wp.z < 1 || wp.z > D || wp.x < 1 || wp.x > W || wp.y < 1 || wp.y > W) {
      return fail(wi, wp, "OFF_MAP", null);
    }

    // 1. A waypoint equal to the current position is a no-op. Saves record the
    //    pre-action position and then the action target, so this is routine.
    if (wp.z === player.z && wp.x === player.x && wp.y === player.y) continue;

    const path = pathfind(tower, rs.cells, player, wp);
    if (path === null) return fail(wi, wp, "NO_PATH", null);

    for (const ps of path) {
      const { z, x, y } = coords(ps.to);
      const from = addr(tower, player.z, player.x, player.y);

      // --- phase 1: topology ---
      if (z !== player.z || Math.abs(x - player.x) + Math.abs(y - player.y) !== 1) {
        return fail(wi, { z, x, y }, "NOT_ADJACENT", steps.length);
      }

      // --- phase 2: entry test (pure) ---
      const res = resolveEntry(rs, player, z, x, y);
      if (!res.ok) return fail(wi, { z, x, y }, res.why.code, steps.length, res.why.have, res.why.need);

      // --- phases 3-4: pay and apply ---
      const next = clonePlayer(player);
      const edits: CellEdit[] = [];
      let killedOn: number | null = null;
      const edit = (a: Addr, after: CellState): void => {
        const before = rs.cells[a]! as CellState;
        if (before === after) return;
        edits.push({ addr: a, before, after });
        rs.cells[a] = after;
      };
      res.effect.apply(next, edit, (kz) => {
        killedOn = kz;
        rs.kills[kz - 1] = rs.kills[kz - 1]! + 1;
        openBattleGates(rs, kz, edit);
      });

      // --- phase 5: power cap ---
      next.power = Math.min(next.power, MAX_POWER);

      // --- phase 6: position, with exactly one teleport and no recursion ---
      next.z = z;
      next.x = x;
      next.y = y;
      const landed = effectiveCell(tower, rs.cells, z, x, y);
      if (isEntity(landed)) {
        if (landed.type === "stairs_up" && z + 1 <= D) next.z = z + 1;
        else if (landed.type === "stairs_down" && z - 1 >= 1) next.z = z - 1;
      }

      // --- phase 7: pop-up commit ---
      if (next.pendingPopup !== null) {
        const cur = addr(tower, next.z, next.x, next.y);
        if (next.pendingPopup !== cur) {
          edit(next.pendingPopup, CellState.Reinforced);
          next.pendingPopup = null;
        }
      }

      // --- phase 8 ---
      if (!(next.power >= 1 && next.power <= MAX_POWER)) {
        throw new SimAssertionError(`power out of range after step ${steps.length}: ${next.power}`);
      }

      steps.push({
        waypointIndex: wi,
        from,
        to: ps.to,
        edits,
        killedOn,
        player: next,
        requirement: res.effect.requirement,
      });
      player = next;
    }
  }

  return { tower, initial, steps };
}

/**
 * SPEC-004 §6. One kill decrements every still-closed Battle Gate on the floor;
 * each reaching 0 opens. We compare a running count against the immutable
 * initial value, which agrees with the game because an opened gate stops being
 * decremented.
 */
function openBattleGates(rs: RunState, z: number, edit: (a: Addr, after: CellState) => void): void {
  const floor = rs.tower.floors[z - 1]!;
  for (let y = 1; y <= W; y++) {
    for (let x = 1; x <= W; x++) {
      const c = floor.cells[y - 1]![x - 1]!;
      if (typeof c !== "object" || c.type !== "battle_gate") continue;
      const a = addr(rs.tower, z, x, y);
      if (rs.cells[a] !== CellState.Original) continue;
      if (rs.kills[z - 1]! >= c.value) edit(a, CellState.Gone);
    }
  }
}
