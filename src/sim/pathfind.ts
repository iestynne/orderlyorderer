// SPEC-004 §5 — the pathfinder.
//
// Reachability validation is mandatory, not an optimisation: without it the sim
// would accept routes that bypass locked gates. BFS with a FIFO queue, because
// every move costs 1 including stairs, so breadth-first order already gives
// shortest paths.

import { addr, coords, effectiveCell, inBounds, isEntity } from "./grid";
import { oneWayAllows } from "./rules";
import { W, type Addr, type Player, type TowerJSON } from "./types";

/** Fixed expansion order, so the chosen path is reproducible (§5.4, invariant 9). */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [1, 0], // right
  [0, 1], // down
  [-1, 0], // left
];

/**
 * §5.2. A non-target cell is traversable iff entering it would cause no cell
 * edit and no player-state change. The feather exception is exactly the set the
 * game marks feather_pathfind = true, verified to be {popup, spikes}.
 */
function traversable(tower: TowerJSON, cells: Uint8Array, p: Player, z: number, x: number, y: number): boolean {
  const c = effectiveCell(tower, cells, z, x, y);
  if (!isEntity(c)) return c === 0;
  switch (c.type) {
    case "stairs_up":
    case "stairs_down":
      return true;
    case "popup":
    case "spikes":
      return p.held === "feather";
    case "barrier_u":
    case "barrier_d":
    case "barrier_l":
    case "barrier_r":
      // Entry direction is the sole constraint; there is no exit restriction.
      return oneWayAllows(c.type, p, x, y);
    default:
      return false;
  }
}

/** Where entering (z, x, y) actually leaves the player: stairs teleport once. */
function arrival(tower: TowerJSON, cells: Uint8Array, z: number, x: number, y: number): { z: number; x: number; y: number } {
  const c = effectiveCell(tower, cells, z, x, y);
  if (isEntity(c)) {
    if (c.type === "stairs_up" && z + 1 <= tower.floors.length) return { z: z + 1, x, y };
    if (c.type === "stairs_down" && z - 1 >= 1) return { z: z - 1, x, y };
  }
  return { z, x, y };
}

export interface PathStep {
  /** The cell entered. Never the stairs arrival cell (SPEC-004 §4). */
  to: Addr;
}

/**
 * Returns the sequence of cells to move through, ending with the move that
 * enters `target`, or null if no passive route exists.
 *
 * The target cell is exempt from traversability: the game's own check_neighbour
 * opens with `if xx == target_x and yy == target_y then return true`. That is
 * what makes the passive/explicit split work — the only cell where a state
 * change happens is the one the pathfinder does not inspect.
 */
export function pathfind(
  tower: TowerJSON,
  cells: Uint8Array,
  player: Player,
  target: { z: number; x: number; y: number },
): PathStep[] | null {
  const n = tower.floors.length * W * W;
  const start = addr(tower, player.z, player.x, player.y);
  const goal = addr(tower, target.z, target.x, target.y);
  if (start === goal) return [];

  /**
   * If the target is itself a staircase, the player cannot get there by
   * stepping onto it -- entering a staircase teleports you off it. The only
   * way to be standing on one is to arrive via its pair. This is not a corner
   * case: a save's position-half entries record where the player stood, and
   * after taking stairs that is a staircase, 244 times in the corpus.
   */
  const goalIsStairs = (() => {
    const c = effectiveCell(tower, cells, target.z, target.x, target.y);
    return isEntity(c) && (c.type === "stairs_up" || c.type === "stairs_down");
  })();

  const prev = new Int32Array(n).fill(-1);
  const entered = new Int32Array(n).fill(-1); // cell entered to reach this node
  const seen = new Uint8Array(n);
  seen[start] = 1;

  /** Walk `prev` back from `node`, then append the move that entered `last`. */
  const reconstruct = (node: Addr, last: Addr): PathStep[] => {
    const out: PathStep[] = [{ to: last }];
    let n = node;
    while (n !== start) {
      out.push({ to: entered[n]! });
      n = prev[n]!;
    }
    out.reverse();
    return out;
  };

  let queue: Addr[] = [start];
  while (queue.length > 0) {
    const next: Addr[] = [];
    for (const cur of queue) {
      const { z, x, y } = coords(cur);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(tower, z, nx, ny)) continue;
        const stepCell = addr(tower, z, nx, ny);

        // Reached by stepping directly onto it. The target is exempt from
        // traversability, so this check comes first -- except for a staircase
        // target, where entering it would teleport the player straight back off
        // and leave the waypoint unsatisfied.
        if (stepCell === goal && !goalIsStairs) return reconstruct(cur, goal);

        // A non-target cell must be passively enterable...
        if (!traversable(tower, cells, { ...player, x, y }, z, nx, ny)) continue;
        const arr = arrival(tower, cells, z, nx, ny);
        const landing = addr(tower, arr.z, arr.x, arr.y);

        // Reached by *landing* on it off a staircase. The player never enters
        // the target cell directly in this case -- they enter the stairs and
        // are teleported -- so the final step's `to` is the staircase, and the
        // goal test has to be made against the landing as well as the step.
        if (landing === goal) return reconstruct(cur, stepCell);

        // ...and so must the cell a staircase drops us on.
        if (landing !== stepCell && !traversable(tower, cells, { ...player, x: arr.x, y: arr.y }, arr.z, arr.x, arr.y)) continue;
        if (seen[landing]) continue;
        seen[landing] = 1;
        prev[landing] = cur;
        entered[landing] = stepCell;
        next.push(landing);
      }
    }
    queue = next;
  }
  return null;
}
