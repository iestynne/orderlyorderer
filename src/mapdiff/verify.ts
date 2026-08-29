// SPEC-005 §10 oracle 2, from a SINGLE final-state export.
//
// The spec's oracle 2 diffs a `before` against an `after`. That needs two
// exports. But a final-state export alone supports a stronger check, and it
// falls out of a fact the spec already establishes:
//
//   [F] §5: "Tiles are not autotiled and there is no terrain/occupant
//   compositing, so two equivalent cells are byte-identical."
//
// So: ask the simulator what every cell should be, group the image's cells by
// that prediction, and assert each group is internally byte-identical. If the
// sim is right, the image partitions exactly along predicted-content lines. If
// it is wrong about even one cell, that cell lands in the wrong group and shows
// up as a variant.
//
// This is fiercer than the two-image diff in one way -- it checks unchanged
// cells as positively as changed ones, rather than inferring "unchanged" from
// the absence of a difference -- and weaker in another: it cannot tell an
// entity apart from a different entity that happens to render identically, and
// it needs the sim to be right about at least one cell per group to anchor it.
// Run both when a `before` export exists.

import { bandKey, panelGrid, type PanelGrid } from "./geometry";
import type { Png } from "./png";
import { coords } from "../sim/grid";
import { CellState, type Timeline } from "../sim/types";
import type { TowerJSON } from "../../tools/maps/types";

export interface VerifyOptions {
  /** Where the sim says the player ends; that cell is masked (§8). */
  playerCell?: { z: number; x: number; y: number };
}

export interface Variant {
  band: string;
  cells: Array<{ z: number; x: number; y: number }>;
}

export interface KindGroup {
  kind: string;
  count: number;
  variants: Variant[];
}

export interface VerifyResult {
  cellsChecked: number;
  masked: number;
  groups: KindGroup[];
  /** Groups whose cells are not all byte-identical. Each is a finding. */
  inconsistent: KindGroup[];
  /** Distinct predicted kinds that render identically. Usually benign. */
  collisions: Array<{ band: string; kinds: string[] }>;
  panelToFloor: Map<number, number>;
}

/**
 * The sprite a cell will draw with. Enemy sprites are chosen by decade
 * (`entitydef.enemy.get_spr`), not by exact value, so two enemies of the same
 * tier and sign are byte-identical in the band -- the badge that separates them
 * lives outside rows 2..10.
 */
export function predictedKind(cell: number | { type: string; value: number }, state: CellState): string {
  if (state === CellState.Gone) return "empty";
  if (state === CellState.Reinforced) return "wall:2";
  if (typeof cell === "number") return `wall:${cell}`;
  if (cell.type === "enemy" || cell.type === "enemy_neg") {
    let tier = 1;
    let n = cell.value;
    while (n >= 10 && tier < 10) {
      n /= 10;
      tier++;
    }
    return `${cell.type}:t${tier}`;
  }
  return cell.type;
}

/**
 * Cells a tutorial textbox draws over; their bands are contaminated and can
 * carry no information about the tile beneath.
 *
 * [F] Textbox coordinates share the panel translation of `(+4, +8)` that
 * SPEC-005 §4 records for the title box, so a box declared at `(4, 4)` lands at
 * panel pixel `(8, 12)` -- the grid's own origin. Measured: without the
 * translation, 1-6's floors 1, 16 and 25 report spurious inconsistencies in the
 * cell row immediately below each box, and with it they are clean. 2-5, which
 * has no textboxes at all, is unaffected either way.
 */
const TEXTBOX_OFFSET = { x: 4, y: 8 } as const;

export function textboxMaskKeys(tower: TowerJSON): Set<string> {
  return textboxMask(tower);
}

function textboxMask(tower: TowerJSON): Set<string> {
  const masked = new Set<string>();
  tower.floors.forEach((floor, fi) => {
    for (const b of floor.textboxes) {
      const bx = b.x + TEXTBOX_OFFSET.x;
      const by = b.y + TEXTBOX_OFFSET.y;
      for (let y = 1; y <= 15; y++) {
        for (let x = 1; x <= 15; x++) {
          const cx = 8 + (x - 1) * 16;
          const cy = 12 + (y - 1) * 16;
          const overlaps = cx < bx + b.w && cx + 16 > bx && cy < by + b.h && cy + 16 > by;
          if (overlaps) masked.add(`${fi + 1},${x},${y}`);
        }
      }
    }
  });
  return masked;
}

/** Fold a timeline's journal into the final CellState of every edited cell. */
export function finalCellStates(timeline: Timeline): Map<string, CellState> {
  const out = new Map<string, CellState>();
  for (const step of timeline.steps) {
    for (const e of step.edits) {
      const { z, x, y } = coords(e.addr);
      out.set(`${z},${x},${y}`, e.after);
    }
  }
  return out;
}

export function verifyFinalState(png: Png, tower: TowerJSON, timeline: Timeline, opts: VerifyOptions = {}): VerifyResult {
  const grid: PanelGrid = panelGrid(png);
  if (grid.slots < tower.floors.length) {
    throw new Error(`export has ${grid.slots} panel slots but the tower has ${tower.floors.length} floors`);
  }
  // §3: panels are floors in reading order, unused slots trailing.
  const panelToFloor = new Map<number, number>();
  for (let i = 0; i < tower.floors.length; i++) panelToFloor.set(i, i + 1);

  const states = finalCellStates(timeline);
  const masked = textboxMask(tower);
  if (opts.playerCell) masked.add(`${opts.playerCell.z},${opts.playerCell.x},${opts.playerCell.y}`);

  const byKind = new Map<string, Map<string, Array<{ z: number; x: number; y: number }>>>();
  let cellsChecked = 0;
  let maskedCount = 0;

  for (const [panel, z] of panelToFloor) {
    const floor = tower.floors[z - 1]!;
    for (let y = 1; y <= 15; y++) {
      for (let x = 1; x <= 15; x++) {
        const key = `${z},${x},${y}`;
        if (masked.has(key)) {
          maskedCount++;
          continue;
        }
        const kind = predictedKind(floor.cells[y - 1]![x - 1]!, states.get(key) ?? CellState.Original);
        const band = bandKey(png, grid, panel, x, y);
        let variants = byKind.get(kind);
        if (variants === undefined) byKind.set(kind, (variants = new Map()));
        let cells = variants.get(band);
        if (cells === undefined) variants.set(band, (cells = []));
        cells.push({ z, x, y });
        cellsChecked++;
      }
    }
  }

  const groups: KindGroup[] = [];
  for (const [kind, variants] of byKind) {
    const vs: Variant[] = [...variants.entries()]
      .map(([band, cells]) => ({ band, cells }))
      .sort((a, b) => b.cells.length - a.cells.length);
    groups.push({ kind, count: vs.reduce((s, v) => s + v.cells.length, 0), variants: vs });
  }
  groups.sort((a, b) => b.count - a.count);

  const bandToKinds = new Map<string, string[]>();
  for (const g of groups) {
    for (const v of g.variants) {
      const arr = bandToKinds.get(v.band) ?? [];
      if (!arr.includes(g.kind)) arr.push(g.kind);
      bandToKinds.set(v.band, arr);
    }
  }

  return {
    cellsChecked,
    masked: maskedCount,
    groups,
    inconsistent: groups.filter((g) => g.variants.length > 1),
    collisions: [...bandToKinds.entries()].filter(([, k]) => k.length > 1).map(([band, kinds]) => ({ band, kinds })),
    panelToFloor,
  };
}
