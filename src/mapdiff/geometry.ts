// SPEC-005 §3 — export geometry. Derived from leveldata.lua:302-399 and
// confirmed pixel-exact on three exports.
//
// The export concatenates floors as 256x256 panels in reading order, no gutter.
// Unused panel slots are always at the end of the reading order.

import type { Png } from "./png";

export const PANEL = 256;
export const CELL = 16;
export const GRID = 15;

/** Rows 1..7 of a panel are the floor-name box; row 8 is the full-width frame. */
export const TITLE_ROWS = { first: 1, last: 7 } as const;

/**
 * Rows 2..10 of a 16x16 cell: the maximal band invariant to badge content.
 * A value badge occupies rows 11-15 of its own cell and rows 0-1 of the cell
 * below, so this band is immune both to its own digits and to bleed from above.
 */
export const BAND = { first: 2, last: 10 } as const;

export interface PanelGrid {
  cols: number;
  rows: number;
  slots: number;
}

export function panelGrid(png: Png): PanelGrid {
  if (png.width % PANEL !== 0 || png.height % PANEL !== 0) {
    throw new Error(`export dimensions ${png.width}x${png.height} are not a whole number of ${PANEL}px panels`);
  }
  const cols = png.width / PANEL;
  const rows = png.height / PANEL;
  return { cols, rows, slots: cols * rows };
}

/** Top-left image pixel of cell (x, y), 1-based, in the panel at reading index i. */
export function cellOrigin(grid: PanelGrid, panel: number, x: number, y: number): { px: number; py: number } {
  const col = panel % grid.cols;
  const row = Math.floor(panel / grid.cols);
  return {
    px: col * PANEL + 8 + (x - 1) * CELL,
    py: row * PANEL + 12 + (y - 1) * CELL,
  };
}

/** The RGB bytes of a cell's comparison band, as a compact key. */
export function bandKey(png: Png, grid: PanelGrid, panel: number, x: number, y: number): string {
  const { px, py } = cellOrigin(grid, panel, x, y);
  const out: number[] = [];
  for (let r = BAND.first; r <= BAND.last; r++) {
    const rowStart = ((py + r) * png.width + px) * 4;
    for (let c = 0; c < CELL; c++) {
      const o = rowStart + c * 4;
      out.push(png.pixels[o]!, png.pixels[o + 1]!, png.pixels[o + 2]!);
    }
  }
  return String.fromCharCode(...out);
}

/** The full-width title strip of a panel, as a key. Used to pair panels (§4). */
export function titleKey(png: Png, grid: PanelGrid, panel: number): string {
  const col = panel % grid.cols;
  const row = Math.floor(panel / grid.cols);
  const out: number[] = [];
  for (let r = TITLE_ROWS.first; r <= TITLE_ROWS.last; r++) {
    const rowStart = ((row * PANEL + r) * png.width + col * PANEL) * 4;
    for (let c = 0; c < PANEL; c++) {
      const o = rowStart + c * 4;
      out.push(png.pixels[o]!, png.pixels[o + 1]!, png.pixels[o + 2]!);
    }
  }
  return String.fromCharCode(...out);
}

/**
 * §4: the title box is rectangle("fill", 122 - 3.5*len, -7, 5 + 7*len, 10)
 * inside a panel translated by (+4, +8). Verified on a 1-5 export.
 */
export function titleBox(nameLength: number): { left: number; width: number } {
  return { left: Math.floor(126 - 3.5 * nameLength), width: 5 + 7 * nameLength };
}

/** True if a panel slot holds no floor: unused slots are blank. */
export function isBlankPanel(png: Png, grid: PanelGrid, panel: number, background: string): boolean {
  return titleKey(png, grid, panel) === background;
}
