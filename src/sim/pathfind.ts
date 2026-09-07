// SPEC-004 §5 — the pathfinder.
//
// Reachability validation is mandatory, not an optimisation: without it the sim
// would accept routes that bypass locked gates. BFS with a FIFO queue, because
// every move costs 1 including stairs, so breadth-first order already gives
// shortest paths.

import { addr, effectiveCell, inBounds, isEntity } from "./grid";
import { oneWayAllows } from "./rules";
import { W, type Addr, type HeldItem, type Player, type TowerJSON } from "./types";

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
 *
 * `from` is where the step is taken *from*, which is all a one-way wall needs:
 * its rule is a comparison of the two coordinates and nothing else.
 */
function traversable(
  tower: TowerJSON,
  cells: Uint8Array,
  held: HeldItem | null,
  from: { x: number; y: number },
  z: number,
  x: number,
  y: number,
): boolean {
  const c = effectiveCell(tower, cells, z, x, y);
  if (!isEntity(c)) return c === 0;
  switch (c.type) {
    case "stairs_up":
    case "stairs_down":
      return true;
    case "popup":
    case "spikes":
      return held === "feather";
    case "barrier_u":
    case "barrier_d":
    case "barrier_l":
    case "barrier_r":
      // Entry direction is the sole constraint; there is no exit restriction.
      return oneWayAllows(c.type, from, x, y);
    default:
      return false;
  }
}

/**
 * Which floor entering (z, x, y) actually leaves the player on: stairs teleport
 * once, everything else leaves them where they stepped.
 *
 * `[D]` Returns the floor rather than a position, because `x` and `y` are
 * unchanged by a staircase and the caller already has them. An allocated
 * `{z, x, y}` here was one object per traversable neighbour examined.
 */
function arrivalFloor(tower: TowerJSON, cells: Uint8Array, z: number, x: number, y: number): number {
  const c = effectiveCell(tower, cells, z, x, y);
  if (isEntity(c)) {
    if (c.type === "stairs_up" && z + 1 <= tower.floors.length) return z + 1;
    if (c.type === "stairs_down" && z - 1 >= 1) return z - 1;
  }
  return z;
}

export interface PathStep {
  /** The cell entered. Never the stairs arrival cell (SPEC-004 §4). */
  to: Addr;
}

/**
 * The BFS working set, reused between calls.
 *
 * `[D]` Not an optimisation for its own sake. A tower of 32 floors is 7 200
 * cells, and a fresh `prev`, `entered` and `seen` for every waypoint is three
 * allocations and two full `fill(-1)` passes each — 1 773 times over the
 * corpus's longest route, which is 25 million writes and 150 MB of garbage
 * before a single cell is looked at. `seen` holds a **generation stamp**
 * instead of a flag, so a call starts by incrementing a counter rather than by
 * clearing 7 200 entries; `prev` and `entered` need no clearing because they
 * are only ever read for a node this generation has stamped.
 *
 * `[F]` Safe to share: the simulator is synchronous and single-threaded, and a
 * `pathfind` never runs inside another one.
 *
 * `[D]` `queue` is a **flat buffer walked by two indices**, not a list things
 * are removed from: dequeuing is `queue[head++]`, so nothing shifts and nothing
 * is freed. It holds `n` entries and can never need more, because an address is
 * pushed only when `seen` does not yet carry this generation's stamp and is
 * stamped in the same breath — so each of the `n` addresses enters at most
 * once, the start included. **That bound is load-bearing**: writing past the end
 * of an `Int32Array` is a silent no-op in JavaScript, so an unstamped push
 * would not throw, it would quietly drop a node and report no path.
 */
let scratch: { n: number; prev: Int32Array; entered: Int32Array; seen: Int32Array; queue: Int32Array; gen: number } | null = null;

function workspace(n: number): NonNullable<typeof scratch> {
  if (scratch === null || scratch.n < n) {
    scratch = { n, prev: new Int32Array(n), entered: new Int32Array(n), seen: new Int32Array(n), queue: new Int32Array(n), gen: 0 };
  }
  scratch.gen++;
  return scratch;
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
  /** Target exempt from traversability, as the game's check_neighbour has it. False for a position waypoint. */
  exemptTarget = true,
  /** On failure, return the walk to the closest square reached instead of null. Drawing only. */
  bestEffort = false,
  /** Filled with every square the search could reach, when given. */
  visited?: Addr[],
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
  const goalCell = effectiveCell(tower, cells, target.z, target.x, target.y);
  const goalIsStairs = isEntity(goalCell) && (goalCell.type === "stairs_up" || goalCell.type === "stairs_down");

  const { prev, entered, seen, queue, gen } = workspace(n);
  seen[start] = gen;

  /** Walk `prev` back from `node`, then append the move that entered `last`. */
  const reconstruct = (node: Addr, last: Addr): PathStep[] => {
    const out: PathStep[] = [{ to: last }];
    let at = node;
    while (at !== start) {
      out.push({ to: entered[at]! });
      at = prev[at]!;
    }
    out.reverse();
    return out;
  };

  // One mutable position, rather than a Player copy per neighbour: a one-way
  // wall reads two coordinates and the feather rule reads one field.
  const from = { x: 0, y: 0 };
  const held = player.held;

  let bestNode = -1;
  let bestDist = Infinity;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cur = queue[head++]!;
    const x = (cur % W) + 1;
    const y = (Math.floor(cur / W) % W) + 1;
    const z = Math.floor(cur / (W * W)) + 1;
    from.x = x;
    from.y = y;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(tower, z, nx, ny)) continue;
      const stepCell = addr(tower, z, nx, ny);

      // Reached by stepping directly onto it. The target is exempt from
      // traversability, so this check comes first -- except for a staircase
      // target, where entering it would teleport the player straight back off
      // and leave the waypoint unsatisfied.
      if (exemptTarget && stepCell === goal && !goalIsStairs) return reconstruct(cur, goal);

      // A non-target cell must be passively enterable...
      if (!traversable(tower, cells, held, from, z, nx, ny)) continue;
      if (!exemptTarget && stepCell === goal && !goalIsStairs) return reconstruct(cur, goal);
      const az = arrivalFloor(tower, cells, z, nx, ny);
      const landing = az === z ? stepCell : addr(tower, az, nx, ny);

      // Reached by *landing* on it off a staircase. The player never enters
      // the target cell directly in this case -- they enter the stairs and
      // are teleported -- so the final step's `to` is the staircase, and the
      // goal test has to be made against the landing as well as the step.
      if (landing === goal) return reconstruct(cur, stepCell);

      // ...and so must the cell a staircase drops us on.
      if (landing !== stepCell) {
        from.x = nx;
        from.y = ny;
        const ok = traversable(tower, cells, held, from, az, nx, ny);
        from.x = x;
        from.y = y;
        if (!ok) continue;
      }
      if (seen[landing] === gen) continue;
      seen[landing] = gen;
      prev[landing] = cur;
      entered[landing] = stepCell;
      queue[tail++] = landing;
      if (visited !== undefined) visited.push(landing);
      if (bestEffort) {
        // Manhattan distance, with two floor-widths charged per floor apart.
        const lz = Math.floor(landing / (W * W)) + 1;
        const lx = (landing % W) + 1;
        const ly = (Math.floor(landing / W) % W) + 1;
        const d = Math.abs(lx - target.x) + Math.abs(ly - target.y) + Math.abs(lz - target.z) * W * 2;
        if (d < bestDist) {
          bestDist = d;
          bestNode = landing;
        }
      }
    }
  }
  if (bestEffort && bestNode >= 0) {
    const out: PathStep[] = [];
    let at = bestNode;
    while (at !== start) {
      out.push({ to: entered[at]! });
      at = prev[at]!;
    }
    out.reverse();
    return out;
  }
  return null;
}

/**
 * For drawing a `NO_PATH`: the walk to the best square to stand on, and the
 * obstacle beside it that stopped the player. Every reachable square is paired
 * with each non-enterable neighbour and the best pair wins (`blockerRank`,
 * then distance to the target). A heuristic: it names one obstacle, not the
 * only one.
 */
export function blockedApproach(
  tower: TowerJSON,
  cells: Uint8Array,
  player: Player,
  target: { z: number; x: number; y: number },
  /** Cells a disabled action would have removed. */
  removed: ReadonlySet<Addr> = new Set(),
): { path: PathStep[]; blocker: Addr | null } | null {
  const reached: Addr[] = [];
  const fallback = pathfind(tower, cells, player, target, true, true, reached);
  if (fallback === null) return null;
  reached.push(addr(tower, player.z, player.x, player.y));

  let stand: Addr | null = null;
  let blocker: Addr | null = null;
  let best: [number, number] = [Infinity, Infinity];
  for (const a of reached) {
    const at = coordsOf(tower, a);
    for (const [dx, dy] of DIRS) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      if (!inBounds(tower, at.z, nx, ny)) continue;
      if (traversable(tower, cells, player.held, at, at.z, nx, ny)) continue;
      const na = addr(tower, at.z, nx, ny);
      const rank = blockerRank(tower, cells, na, at.z, nx, ny, removed);
      if (rank === null) continue;
      const d = Math.abs(nx - target.x) + Math.abs(ny - target.y) + Math.abs(at.z - target.z) * W * 2;
      if (rank < best[0] || (rank === best[0] && d < best[1])) {
        best = [rank, d];
        stand = a;
        blocker = na;
      }
    }
  }

  const path = stand === null ? fallback : pathfind(tower, cells, player, coordsOf(tower, stand)) ?? fallback;
  return { path, blocker };
}

function coordsOf(tower: TowerJSON, a: Addr): { z: number; x: number; y: number } {
  return { z: Math.floor(a / (W * W)) + 1, x: (a % W) + 1, y: (Math.floor(a / W) % W) + 1 };
}

/**
 * How likely an obstacle is to be what changed; lower is likelier, null never.
 * `[I]` A `NO_PATH` on an edited route is caused by a disable, so a cell a
 * disabled action would have cleared wins outright. Then item or gate, then
 * Weak Wall (a pickaxe), then Reinforced Wall (a Hyper Pickaxe). Iron and
 * one-way walls are never chosen: nothing removes them.
 */
function blockerRank(
  tower: TowerJSON,
  cells: Uint8Array,
  a: Addr,
  z: number,
  x: number,
  y: number,
  removed: ReadonlySet<Addr>,
): number | null {
  if (removed.has(a)) return 0;
  const c = effectiveCell(tower, cells, z, x, y);
  if (!isEntity(c)) {
    if (c === 1) return 2;
    if (c === 2) return 3;
    return null;
  }
  return c.type.startsWith("barrier_") ? null : 1;
}
