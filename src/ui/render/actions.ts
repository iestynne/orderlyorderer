// docs/UI.md §6 — the Action List.
//
// `[D]` **A route acts on the same cell more than once** — walking a spike tile
// twice, back through a one-way — so a badge on the floor cannot say *which* of
// those actions it means. The list is what makes an edit unambiguous: it names
// actions, not cells, and every edit is made against the one the slider is on.
//
// `[D]` **Time runs upward, as it does on the slider beside it.** Row 1 is at
// the bottom. The two are read together, and disagreeing about which way time
// goes would make that impossible.
//
// `[D]` A row says what the action **did**, not where it happened. The
// classification is `src/sim/route/describe.ts`, which is pure and tested; this
// file turns it into sprites and rectangles and nothing more.

import type { AtlasManifest } from "../../../tools/atlas/build";
import type { ActionSummary } from "../../sim/route/describe";
import { drawText, keyOf, spriteFor, type AtlasFontRef } from "./atlas";
import { textWidth } from "../imagefont";
import { drawCheckbox, drawPlus, type Icons } from "./marks";
import { ACTIONS_W, PANEL_PAD, PANEL_W, SLIDER_W, type Layout } from "./screen";

export const ROW_H = 18;
/**
 * The slot a pending row occupies, directly above the current action.
 *
 * `[D]` **Always reserved, never opened and closed.** Held only while something
 * is hovered, the list above the cursor would jump every time the pointer
 * crossed a cell that implies no action — so the gap is always there and the
 * preview drops into it.
 */
export const PENDING_SLOT = ROW_H;

/** Columns at reserved widths, so everything lines up down the list. */
const NUM_W = 22; // four digits, right-justified
const SLOT = 17; // one 16 px sprite and a pixel of air

export interface ActionRow {
  /** 1-based, as the slider counts. */
  number: number;
  summary: ActionSummary;
  enabled: boolean;
  inserted: boolean;
  current: boolean;
  /** A row that would exist if the hovered cell were clicked. */
  pending?: boolean;
}

export interface ActionListGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function actionsGeometry(layout: Layout, slider: { y: number; h: number }): ActionListGeometry {
  return { x: layout.w - PANEL_W - PANEL_PAD + SLIDER_W, y: slider.y, w: ACTIONS_W, h: slider.h };
}

export function visibleRows(g: ActionListGeometry): number {
  // One row's worth is always held back for the pending slot.
  return Math.max(1, Math.floor(g.h / ROW_H) - 1);
}

/**
 * The window of rows to draw: centred on the current action, clamped so the
 * list never runs off either end.
 */
export function windowStart(current: number, total: number, rows: number): number {
  return Math.max(0, Math.min(Math.max(0, total - rows), current - (rows >> 1)));
}

/**
 * The top of drawn row `i`, counting up from the first: the list is drawn
 * bottom-up, so row 0 is at the foot. Every row above `gapAbove` is pushed one
 * further up by the reserved pending slot.
 *
 * `[D]` `gapAbove` is passed rather than derived from which row is current,
 * because it must **not** move while the pointer is dragging down the list —
 * rows sliding under a held pointer would make the drag unusable.
 */
export function rowTop(g: ActionListGeometry, i: number, gapAbove: number): number {
  return g.y + g.h - (i + 1) * ROW_H - (i > gapAbove ? PENDING_SLOT : 0);
}

/** Which drawn row a point is over, or null. Clamped to the list's own column. */
export function rowAt(g: ActionListGeometry, count: number, gapAbove: number, x: number, y: number): number | null {
  if (x < g.x || x > g.x + g.w) return null;
  for (let i = 0; i < count; i++) {
    const top = rowTop(g, i, gapAbove);
    if (y >= top && y < top + ROW_H) return i;
  }
  return null;
}

/** The checkbox of drawn row `i`, for hit-testing a toggle. */
export function checkboxAt(g: ActionListGeometry, i: number, gapAbove: number): { x: number; y: number; w: number; h: number } {
  return { x: g.x + g.w - 14, y: rowTop(g, i, gapAbove), w: 14, h: ROW_H };
}

export function drawActionList(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  rows: readonly ActionRow[],
  gapAbove: number,
  pending: ActionSummary | null,
  icons: Icons,
  hovered: number | null,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x, g.y - 2, g.w, g.h + 4);
  ctx.clip();

  rows.forEach((row, i) => drawRow(ctx, sheet, manifest, fonts, g, row, rowTop(g, i, gapAbove), icons, hovered === i));

  if (pending !== null) {
    drawRow(
      ctx, sheet, manifest, fonts, g,
      { number: 0, summary: pending, enabled: true, inserted: true, current: false, pending: true },
      rowTop(g, gapAbove, gapAbove) - PENDING_SLOT,
      icons, false,
    );
  }
  ctx.restore();
}

export function drawRow(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  row: ActionRow,
  y: number,
  icons: Icons,
  hovered: boolean,
): void {
  if (hovered) {
    ctx.fillStyle = "#22222c";
    ctx.fillRect(g.x, y, g.w, ROW_H);
  }
  ctx.globalAlpha = row.pending === true || !row.enabled ? 0.5 : 1;

  // 1. the number, right-justified in four digits' worth of column.
  if (row.pending !== true) {
    const n = String(row.number);
    drawText(ctx, sheet, fonts.digits, n, g.x + NUM_W - textWidth(fonts.digits, n), y + 5);
  }

  // 2. the held item, in a slot of its own so what follows lines up whether or
  //    not anything was being carried.
  let x = g.x + NUM_W + 2;
  const carried = row.summary.spent ?? row.summary.held;
  if (carried !== null) blit(ctx, sheet, manifest, carried, x, y + 1);
  x += SLOT;

  // 3. what was acted on — or the no-entry sign, where this is the action that
  //    breaks the route.
  if (row.summary.error !== undefined && icons.noEntry) ctx.drawImage(icons.noEntry, x, y + 1);
  else blit(ctx, sheet, manifest, spriteFor(keyOf(row.summary.cell), manifest), x, y + 1);
  x += SLOT;

  // 4. gold, stamped on the bag. `[I]` A Money Gate is the only thing that
  //    takes gold away, so the badge carries its sign.
  if (row.summary.goldGained !== 0) {
    blit(ctx, sheet, manifest, "money", x, y + 1);
    const label = String(row.summary.goldGained);
    const w = textWidth(fonts.digits, label);
    drawText(ctx, sheet, fonts.digits, label, x + ((16 - w) >> 1), y + 6);
  }

  // 5. the toggles, hard right, the add badge always immediately left of the box.
  const box = g.x + g.w - icons.boxSize - 3;
  if (row.inserted) drawPlus(ctx, icons, box - icons.badge - 2, y + ((ROW_H - icons.badge) >> 1));
  if (row.pending !== true) drawCheckbox(ctx, icons, box, y + ((ROW_H - icons.boxSize) >> 1), row.enabled);

  ctx.globalAlpha = 1;
  if (row.current) {
    ctx.strokeStyle = "#cfc4ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x + 0.5, y + 0.5, g.w - 1, ROW_H - 1);
  }
}

/**
 * The current action, repeated at the right of its floor's name strip.
 *
 * `[D]` **A fixed place, and never over the grid.** It used to sit a tile and a
 * half below the cell, which put it on top of squares the player may want to
 * click. The name strip is already there, already the right height, and nothing
 * in it is ever clicked — so the name gives way to it instead.
 */
export function drawActionCard(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  row: ActionRow,
  x: number,
  y: number,
  icons: Icons,
): void {
  const g: ActionListGeometry = { x, y, w: ACTIONS_W, h: ROW_H };
  ctx.fillStyle = "#15151a";
  ctx.fillRect(x, y, ACTIONS_W, ROW_H);
  drawRow(ctx, sheet, manifest, fonts, g, { ...row, current: false }, y, icons, false);
  ctx.strokeStyle = "#cfc4ff";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, ACTIONS_W - 1, ROW_H - 1);
}

function blit(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  stem: string | null,
  x: number,
  y: number,
): void {
  if (stem === null) return;
  const r = manifest.sprites[stem] ?? manifest.sprites[manifest.entities[stem]?.[0] ?? ""];
  if (!r) return;
  ctx.drawImage(sheet, r.x, r.y, r.w, r.h, x, y, 16, 16);
}
