// SPEC-005 §5 — the diff.
//
// Given two exports of one tower, produce the set of cells the run changed.
// This needs no entity recognition: the simulator's rules constrain every cell
// to exactly three outcomes -- unchanged, empty, or Reinforced Wall -- so the
// job is "does this cell still look like it did?", plus one band comparison to
// tell the single non-empty outcome apart.

import { bandKey, cellOrigin, panelGrid, titleKey, type PanelGrid } from "./geometry";
import { decodePng, distinctColors, type Png } from "./png";
import type { TowerJSON } from "../../tools/maps/types";

export type ChangeKind = "empty" | "reinforced" | "unknown" | "unexpected";

export interface CellChange {
  /** 1-based floor, matching D1 and the tower JSON's floor order. */
  z: number;
  x: number;
  y: number;
  kind: ChangeKind;
}

export interface DiffResult {
  changes: CellChange[];
  /** Panel reading index -> floor number, established by title-strip pairing. */
  panelToFloor: Map<number, number>;
  /** Where the differ found the player marker in `after`, if it found one. */
  playerCell: { z: number; x: number; y: number } | null;
}

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffError";
  }
}

export interface DiffInput {
  before: Png;
  after: Png;
  tower: TowerJSON;
  /**
   * Where the sim says the player ends. §8: that cell is masked in both images
   * because the marker composites OVER the cell's contents, so its true state
   * is unrecoverable. The differ still locates the marker independently and
   * reports a disagreement, since that is a real finding and nearly free.
   */
  expectedPlayerCell?: { z: number; x: number; y: number };
}

/**
 * §5.1 refinement. The spec takes the Reinforced Wall reference from within the
 * same image, located via the tower JSON, so no untinted sprite file is ever
 * consulted and palette handling stays out of the hot path. We do the same for
 * the empty reference rather than assuming a background colour -- §6 and §9
 * establish that "background" can be two different colours in a tinted export,
 * and under palette 7 it is white.
 */
interface References {
  empty: string;
  reinforced: string | null;
}

function findReferences(png: Png, grid: PanelGrid, tower: TowerJSON, panelToFloor: Map<number, number>, masked: Set<string>): References {
  let empty: string | null = null;
  let reinforced: string | null = null;

  for (const [panel, z] of panelToFloor) {
    const floor = tower.floors[z - 1]!;
    for (let y = 1; y <= 15 && (empty === null || reinforced === null); y++) {
      for (let x = 1; x <= 15; x++) {
        if (masked.has(`${z},${x},${y}`)) continue;
        const c = floor.cells[y - 1]![x - 1]!;
        if (typeof c !== "number") continue;
        if (c === 0 && empty === null) empty = bandKey(png, grid, panel, x, y);
        else if (c === 2 && reinforced === null) reinforced = bandKey(png, grid, panel, x, y);
      }
    }
  }
  if (empty === null) throw new DiffError("no empty cell anywhere in the tower to use as the background reference");
  return { empty, reinforced };
}

/** §4: pair panels by title-strip byte equality, not by index. */
function pairPanels(before: Png, after: Png, grid: PanelGrid): Map<number, number> {
  const afterByTitle = new Map<string, number>();
  for (let p = 0; p < grid.slots; p++) {
    const k = titleKey(after, grid, p);
    if (afterByTitle.has(k)) continue; // blank slots collide; first wins
    afterByTitle.set(k, p);
  }
  const pairs = new Map<number, number>();
  const usedAfter = new Set<number>();
  for (let p = 0; p < grid.slots; p++) {
    const k = titleKey(before, grid, p);
    const q = afterByTitle.get(k);
    if (q === undefined || usedAfter.has(q)) {
      // Blank slots all share a title strip, so a duplicate means we have run
      // out of real panels, not that a floor is missing.
      continue;
    }
    usedAfter.add(q);
    pairs.set(p, q);
  }
  return pairs;
}

export function diffExports(input: DiffInput): DiffResult {
  const { before, after, tower } = input;

  // --- §2 preconditions ---
  if (before.width !== after.width || before.height !== after.height) {
    throw new DiffError(`exports differ in size: ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  const cb = distinctColors(before);
  const ca = distinctColors(after);
  if (cb.size !== ca.size) {
    throw new DiffError(`exports have ${cb.size} and ${ca.size} distinct colours — the palette or brightness settings changed between them (SPEC-005 §6)`);
  }
  if (cb.size > 16) {
    throw new DiffError(`${cb.size} distinct colours; a lossless export has at most 16 (SPEC-005 §2) — was this transcoded?`);
  }

  const grid = panelGrid(before);
  if (grid.slots < tower.floors.length) {
    throw new DiffError(`export has ${grid.slots} panel slots but the tower has ${tower.floors.length} floors`);
  }

  const panelPairs = pairPanels(before, after, grid);

  // §4: panels appear in floor order (bottom-to-top), so the nth paired panel
  // is floor n. Unused slots trail at the end of the reading order.
  const panelToFloor = new Map<number, number>();
  let floor = 1;
  for (const p of [...panelPairs.keys()].sort((a, b) => a - b)) {
    if (floor > tower.floors.length) break;
    panelToFloor.set(p, floor++);
  }
  if (panelToFloor.size !== tower.floors.length) {
    throw new DiffError(`paired ${panelToFloor.size} panels but the tower has ${tower.floors.length} floors — a floor was unlocked between exports, so \`before\` is not a valid baseline (SPEC-005 §4)`);
  }

  // --- masks ---
  const masked = new Set<string>();
  if (input.expectedPlayerCell) {
    const { z, x, y } = input.expectedPlayerCell;
    masked.add(`${z},${x},${y}`);
  }
  const start = tower.metadata;
  masked.add(`${start.start_floor},${start.start_x},${start.start_y}`);

  const refs = findReferences(before, grid, tower, panelToFloor, masked);

  // --- §5: compare, cell by cell ---
  const changes: CellChange[] = [];
  let playerCell: DiffResult["playerCell"] = null;

  for (const [pBefore, z] of panelToFloor) {
    const pAfter = panelPairs.get(pBefore)!;
    for (let y = 1; y <= 15; y++) {
      for (let x = 1; x <= 15; x++) {
        const b = bandKey(before, grid, pBefore, x, y);
        const a = bandKey(after, grid, pAfter, x, y);
        if (masked.has(`${z},${x},${y}`)) {
          changes.push({ z, x, y, kind: "unknown" });
          continue;
        }
        if (a === b) continue;
        if (a === refs.empty) changes.push({ z, x, y, kind: "empty" });
        else if (refs.reinforced !== null && a === refs.reinforced) changes.push({ z, x, y, kind: "reinforced" });
        else {
          // §8: an unmasked cell that matches nothing is very often the player
          // marker, which composites over whatever is beneath it.
          if (playerCell === null) playerCell = { z, x, y };
          changes.push({ z, x, y, kind: "unexpected" });
        }
      }
    }
  }

  return { changes, panelToFloor, playerCell };
}

export function diffExportBytes(beforeBytes: Uint8Array, afterBytes: Uint8Array, tower: TowerJSON, expectedPlayerCell?: { z: number; x: number; y: number }): DiffResult {
  return diffExports({ before: decodePng(beforeBytes), after: decodePng(afterBytes), tower, expectedPlayerCell });
}
