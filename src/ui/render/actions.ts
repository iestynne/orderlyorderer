// docs/UI.md §6 — the Action List.
//
// `[D]` **A route acts on the same cell more than once** — walking a spike tile
// twice, back through a one-way — so a badge on the floor cannot say *which* of
// those actions it means. The list is what makes an edit unambiguous: it names
// actions, not cells, and every edit is made against the one the slider is on.
//
// `[D]` A row says what the action **did**, not where it happened. The
// classification is `src/sim/route/describe.ts`, which is pure and tested; this
// file turns it into sprites and rectangles and nothing more.

import type { AtlasManifest } from "../../../tools/atlas/build";
import type { ActionSummary } from "../../sim/route/describe";
import { drawText, keyOf, spriteFor, type AtlasFontRef } from "./atlas";
import { textWidth } from "../imagefont";
import { drawBadge, drawCheckbox } from "./marks";
import { ACTIONS_W, PANEL_PAD, PANEL_W, SLIDER_W, type Layout } from "./screen";

export const ROW_H = 18;
/**
 * The current action, repeated in the left panel a tile and a half below its
 * own cell, so the list and the timeline visibly agree.
 *
 * `[D]` A display, not a control: clicking it would be a third place to make
 * the same edit, and the two that exist are already one more than the player
 * needs to learn.
 */
export function drawActionCard(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  row: ActionRow,
  x: number,
  y: number,
  noEntry: HTMLCanvasElement | null,
): void {
  const g: ActionListGeometry = { x, y, w: ACTIONS_W, h: ROW_H };
  ctx.fillStyle = "#15151a";
  ctx.fillRect(x, y, ACTIONS_W, ROW_H);
  drawRow(ctx, sheet, manifest, fonts, g, { ...row, current: false }, y, noEntry, false);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 2, y - 2, ACTIONS_W + 4, ROW_H + 4);
  ctx.strokeStyle = "#cfc4ff";
  ctx.strokeRect(x - 1, y - 1, ACTIONS_W + 2, ROW_H + 2);
}

/** The gap opened above and below a pending row, so it reads as not-yet-there. */
export const PENDING_GAP = 5;

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
  return Math.max(1, Math.floor(g.h / ROW_H));
}

/**
 * The window of rows to draw: centred on the current action, clamped so the
 * list never scrolls past either end.
 *
 * `[D]` Centred rather than paged, because the point of the list is the
 * neighbourhood of the edit — what came just before and just after — and a page
 * that flips would put the current action at the top or bottom half the time.
 */
export function windowStart(current: number, total: number, rows: number): number {
  return Math.max(0, Math.min(Math.max(0, total - rows), current - (rows >> 1)));
}

/** Which row index a point is over, or null. `rows` is what `drawActionList` drew. */
export function rowAt(g: ActionListGeometry, rows: readonly ActionRow[], x: number, y: number): number | null {
  if (x < g.x || x > g.x + g.w) return null;
  let top = g.y;
  for (let i = 0; i < rows.length; i++) {
    const h = ROW_H + (rows[i]!.pending === true ? PENDING_GAP * 2 : 0);
    if (y >= top && y < top + h) return i;
    top += h;
  }
  return null;
}

/** The checkbox of the i-th drawn row, for hit-testing a toggle. */
export function checkboxAt(g: ActionListGeometry, rows: readonly ActionRow[], i: number): { x: number; y: number; w: number; h: number } | null {
  let top = g.y;
  for (let k = 0; k < i; k++) top += ROW_H + (rows[k]!.pending === true ? PENDING_GAP * 2 : 0);
  const row = rows[i];
  if (!row || row.pending === true) return null;
  return { x: g.x + g.w - 12, y: top + (ROW_H - 9) / 2, w: 9, h: 9 };
}

export function drawActionList(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  rows: readonly ActionRow[],
  noEntry: HTMLCanvasElement | null,
  hovered: number | null,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x, g.y - 2, g.w, g.h + 4);
  ctx.clip();

  let y = g.y;
  rows.forEach((row, i) => {
    if (row.pending === true) y += PENDING_GAP;
    drawRow(ctx, sheet, manifest, fonts, g, row, y, noEntry, hovered === i);
    y += ROW_H + (row.pending === true ? PENDING_GAP : 0);
  });
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
  noEntry: HTMLCanvasElement | null,
  hovered: boolean,
): void {
  const ghost = row.pending === true || !row.enabled;
  ctx.globalAlpha = ghost ? 0.45 : 1;

  if (hovered && row.pending !== true) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#22222c";
    ctx.fillRect(g.x, y, g.w, ROW_H);
    ctx.globalAlpha = ghost ? 0.45 : 1;
  }

  // The number, right-aligned so the column reads down.
  const n = String(row.number);
  drawText(ctx, sheet, fonts.digits, n, g.x + 22 - textWidth(fonts.digits, n), y + 5);

  let x = g.x + 26;
  // A pending row wears its `+` on the LEFT, where a committed one wears it on
  // the right: the same badge, in the place that says "not yet" rather than
  // "new".
  if (row.pending === true) {
    drawBadge(ctx, "inserted", g.x + 24, y + 4);
    x += 12;
  } else if (row.summary.error !== undefined && noEntry) {
    ctx.drawImage(noEntry, g.x + 24, y + 1);
    x += 18;
  }

  const stem = spriteFor(keyOf(row.summary.cell), manifest);
  x = blit(ctx, sheet, manifest, stem, x, y + 1);
  // What the action used up, or the item that changed its outcome.
  const second = row.summary.spent ?? row.summary.held;
  if (second !== null) x = blit(ctx, sheet, manifest, second, x, y + 1);

  if (row.summary.goldGained > 0) {
    const g0 = `+${row.summary.goldGained}`;
    drawText(ctx, sheet, fonts.digits, g0, x + 1, y + 5);
    blit(ctx, sheet, manifest, "money", x + 2 + textWidth(fonts.digits, g0), y + 1);
  }

  if (row.pending !== true) {
    drawCheckbox(ctx, g.x + g.w - 12, y + (ROW_H - 9) / 2, row.enabled);
    if (row.inserted) drawBadge(ctx, "inserted", g.x + g.w - 23, y + 4);
    else if (!row.enabled) drawBadge(ctx, "disabled", g.x + g.w - 23, y + 4);
  }

  ctx.globalAlpha = 1;
  if (row.current) {
    ctx.strokeStyle = "#cfc4ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x + 0.5, y + 0.5, g.w - 1, ROW_H - 1);
  }
}

function blit(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  stem: string | null,
  x: number,
  y: number,
): number {
  if (stem === null) return x;
  const r = manifest.sprites[stem] ?? manifest.sprites[manifest.entities[stem]?.[0] ?? ""];
  if (!r) return x;
  ctx.drawImage(sheet, r.x, r.y, r.w, r.h, x, y, 16, 16);
  return x + 17;
}
