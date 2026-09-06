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
  type TowerJSON,
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

/**
 * Where a resumed run picks up: SPEC-008 §4.
 *
 * `[D]` The engine gained one optional argument rather than a second entry
 * point. A fork is "would this segment pass **from here**", and the state it
 * starts from is the mainline's — which `Cursor` already holds, cell for cell.
 * `[D]` `cells` and `kills` are **copied**, so a fork cannot write through to
 * the mainline whose prefix it borrowed (invariant 8).
 */
export interface SimStart {
  player: Player;
  cells: Uint8Array;
  kills: Int32Array;
  /** Added to every `waypointIndex`, so a resumed run indexes the whole route. */
  waypointBase?: number;
}

export function simulate(input: SimInput, start?: SimStart): Timeline {
  const { tower, gemsOwned, route } = input;
  const D = depth(tower);
  const flags = tower.metadata.computed_flags;

  const rs: RunState = {
    tower,
    cells: start ? Uint8Array.from(start.cells) : new Uint8Array(D * W * W),
    kills: start ? Int32Array.from(start.kills) : new Int32Array(D),
    gemsOwned,
    negativeKeys: flags.negative_keys === true,
    uncappedElixirs: flags.uncapped_elixirs === true,
  };

  const base = start?.waypointBase ?? 0;
  const initial = start ? start.player : initialPlayer(input);
  let player = clonePlayer(initial);
  const steps: Step[] = [];

  const fail = (waypointIndex: number, at: Waypoint, code: SimError["code"], stepIndex: number | null, have?: number, need?: number): Timeline => ({
    tower,
    initial,
    steps,
    error: { waypointIndex: base + waypointIndex, stepIndex, code, at, have, need },
  });

  for (let wi = 0; wi < route.length; wi++) {
    const wp = route[wi]!;

    if (wp.z < 1 || wp.z > D || wp.x < 1 || wp.x > W || wp.y < 1 || wp.y > W) {
      return fail(wi, wp, "OFF_MAP", null);
    }

    // 1. A waypoint equal to the current position is a no-op. Saves record the
    //    pre-action position and then the action target, so this is routine.
    if (wp.z === player.z && wp.x === player.x && wp.y === player.y) continue;

    // 1a. **The position half of an entry is not walked to, after the first.**
    //     A route is `from, to, from, to, ..., final` (SAVE_FORMAT §3), so an
    //     even index is where the player *was* when the action was recorded,
    //     not something they did. On an unedited route that is where they
    //     already are and the line above has just skipped it; on an edited one
    //     it names a square they never reached, and pathing there was worse
    //     than useless — a waypoint is exempt from traversability, so entering
    //     a stale position applied the full entry rules to it and let one
    //     action quietly do a second thing. On 1-6 "747M C2 win", disabling the
    //     key pickup at action 73 left action 81 collecting that key on its way
    //     to a bat, so the route never failed for the missing key.
    //
    // `[F]` **Index 0 is load-bearing and must still be walked.** A save can be
    //     resumed, so a route may open somewhere other than the tower start
    //     square, and that first waypoint is the only thing that says where.
    //     Skipping it too left `POP-UP-FORMAT` failing `NO_PATH` at waypoint 1.
    //
    // `[F]` **Walked passively, or not at all.** Two clean-corpus records say
    //     it cannot simply be dropped: `POP-UP-FORMAT` opens away from the
    //     tower's start square, and `2-5/G 211g 31F 1W1B 1.9M` has a position
    //     mid-route the player is genuinely not standing on. So it is pathed
    //     with the target exemption **off** — the player has to be able to
    //     stand there without acting, which is what "a position" means — and
    //     when no such path exists the waypoint is skipped rather than failed.
    //     A stale position then costs nothing, and can no longer act.
    const isPosition = wi > 0 && (base + wi) % 2 === 0;
    const path = pathfind(tower, rs.cells, player, wp, !isPosition);
    if (path === null) {
      if (isPosition) continue;
      return fail(wi, wp, "NO_PATH", null);
    }

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
        waypointIndex: base + wi,
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
 * Where each floor's Battle Gates are, indexed once per tower.
 *
 * `[D]` Keyed on the `TowerJSON` itself, so the scan is shared by every
 * simulation of that tower — the mainline, every fork, and every
 * re-evaluation after an edit — rather than repeated per run.
 *
 * `[F]` It is the biggest scan the simulator had. A kill used to walk all 225
 * cells of its floor looking for gates, and the corpus's longest route makes
 * **1 389** kills: 312 000 cell reads, six times the whole pathfinder's
 * neighbour count over the same route. Most floors hold no gate at all, so
 * most of those kills now do nothing.
 */
interface Gate {
  addr: Addr;
  value: number;
}

const battleGates = new WeakMap<TowerJSON, Gate[][]>();

function battleGatesOf(tower: TowerJSON): Gate[][] {
  const cached = battleGates.get(tower);
  if (cached !== undefined) return cached;
  const byFloor: Gate[][] = [];
  for (let z = 1; z <= tower.floors.length; z++) {
    const floor = tower.floors[z - 1]!;
    const gates: Gate[] = [];
    for (let y = 1; y <= W; y++) {
      for (let x = 1; x <= W; x++) {
        const c = floor.cells[y - 1]![x - 1]!;
        if (typeof c === "object" && c.type === "battle_gate") gates.push({ addr: addr(tower, z, x, y), value: c.value });
      }
    }
    byFloor.push(gates);
  }
  battleGates.set(tower, byFloor);
  return byFloor;
}

/**
 * SPEC-004 §6. One kill decrements every still-closed Battle Gate on the floor;
 * each reaching 0 opens. We compare a running count against the immutable
 * initial value, which agrees with the game because an opened gate stops being
 * decremented.
 */
function openBattleGates(rs: RunState, z: number, edit: (a: Addr, after: CellState) => void): void {
  const kills = rs.kills[z - 1]!;
  for (const gate of battleGatesOf(rs.tower)[z - 1]!) {
    if (rs.cells[gate.addr] !== CellState.Original) continue;
    if (kills >= gate.value) edit(gate.addr, CellState.Gone);
  }
}
