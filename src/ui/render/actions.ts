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
// `[D]` **The current action holds a fixed slot and the list moves under it.**
// Centring on every seek made the list saw back and forth as the slider was
// dragged — scroll, hit the edge, recentre, again. The slot changes only when
// the player clicks a row, and then it becomes the row they clicked, so the
// thing they aimed at is the thing that stays still.
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

/** Columns at reserved widths, so everything lines up down the list. */
const NUM_W = 22; // four digits, right-justified
const SLOT = 17; // one 16 px sprite and a pixel of air

/**
 * `[I]` A blank row above the current action and another below it. The one
 * above is where a pending insertion lands — insertions go *after* the current
 * action, and later is higher — and the one below is its mirror, so the current
 * row sits in clear air rather than at the top of a gap.
 */
const CLEARANCE = ROW_H;

/** Alternating bands, a shade either side of the panel behind them. */
const BAND = ["#191920", "#131318"];
/** The same alternation, shifted towards red where the route has already failed. */
const BAND_FAILED = ["#241b1b", "#1d1616"];

export interface ActionRow {
  /** Which visual slot it occupies, 0 at the foot of the list. */
  slot: number;
  /** 1-based, as the slider counts. */
  number: number;
  summary: ActionSummary;
  enabled: boolean;
  inserted: boolean;
  current: boolean;
  /** True from the action that breaks the route onward. */
  failed: boolean;
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

/** How many rows fit, the two blank ones included. */
export function slotCount(g: ActionListGeometry): number {
  return Math.max(1, Math.floor(g.h / ROW_H));
}

/**
 * The top of the row in `slot`, given which slot the current action holds.
 *
 * Slots below the current one are pushed down and those above are pushed up, by
 * one row each, which is what opens the clearance either side of it.
 */
export function slotTop(g: ActionListGeometry, slot: number, pinned: number): number {
  const shift = slot < pinned ? CLEARANCE : slot > pinned ? -CLEARANCE : 0;
  return g.y + g.h - (slot + 1) * ROW_H + shift;
}

/** Which slot a point is over, or null. */
export function slotAt(g: ActionListGeometry, pinned: number, x: number, y: number): number | null {
  if (x < g.x || x > g.x + g.w) return null;
  for (let slot = 0; slot < slotCount(g); slot++) {
    const top = slotTop(g, slot, pinned);
    if (y >= top && y < top + ROW_H) return slot;
  }
  return null;
}

/** The checkbox of a slot, for hit-testing a toggle. */
export function checkboxAt(g: ActionListGeometry, slot: number, pinned: number): { x: number; y: number; w: number; h: number } {
  return { x: g.x + g.w - 14, y: slotTop(g, slot, pinned), w: 14, h: ROW_H };
}

export function drawActionList(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  rows: readonly ActionRow[],
  pinned: number,
  pending: ActionSummary | null,
  icons: Icons,
  hovered: number | null,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x, g.y - 2, g.w, g.h + 4);
  ctx.clip();

  for (const row of rows) {
    drawRow(ctx, sheet, manifest, fonts, g, row, slotTop(g, row.slot, pinned), icons, hovered === row.slot);
  }
  if (pending !== null) {
    drawRow(
      ctx, sheet, manifest, fonts, g,
      { slot: pinned, number: 0, summary: pending, enabled: true, inserted: true, current: false, failed: false },
      slotTop(g, pinned, pinned) - CLEARANCE,
      icons, false, true,
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
  pending = false,
): void {
  ctx.fillStyle = hovered ? "#2a2a36" : (row.failed ? BAND_FAILED : BAND)[row.number % 2]!;
  ctx.fillRect(g.x, y, g.w, ROW_H);
  ctx.globalAlpha = pending || !row.enabled ? 0.5 : 1;

  // 1. the number, right-justified in four digits' worth of column.
  if (!pending) {
    const n = String(row.number);
    drawText(ctx, sheet, fonts.digits, n, g.x + NUM_W - textWidth(fonts.digits, n), y + 5);
  }

  // `[I]` An action that found its work already done says nothing but its
  // number: there is no enemy left to draw, and drawing the dead one would be
  // a lie about what this action does now.
  if (row.summary.kind !== "noop") {
    // 2. the item carried or spent, in a slot of its own so what follows lines
    //    up whether or not anything was being carried.
    let x = g.x + NUM_W + 2;
    const carried = row.summary.spent ?? row.summary.held;
    if (carried !== null) blit(ctx, sheet, manifest, carried, x, y + 1);
    x += SLOT;

    // 3. what was acted on. `[I]` Drawn the same whether the action succeeds or
    //    fails: after a break the icons are what the action *would* do, and the
    //    red band behind the row is what says it cannot.
    blit(ctx, sheet, manifest, spriteFor(keyOf(row.summary.cell), manifest), x, y + 1);
    x += SLOT;

    // 4. gold, stamped on the bag a pixel lower than it was: the number sat on
    //    the bag's neck, and the silhouette is how the bag is recognised.
    if (row.summary.goldGained !== 0) {
      blit(ctx, sheet, manifest, "money", x, y + 1);
      const label = String(row.summary.goldGained);
      const w = textWidth(fonts.digits, label);
      drawText(ctx, sheet, fonts.digits, label, x + ((16 - w) >> 1), y + 7);
    }
  }

  // 5. the toggles, hard right, the add badge always immediately left of the
  //    box. `[I]` The badge keeps full strength on a disabled row: "you added
  //    this" is still true when you switch it off.
  ctx.globalAlpha = 1;
  const box = g.x + g.w - icons.boxSize - 3;
  if (row.inserted) drawPlus(ctx, icons, box - icons.badge - 2, y + ((ROW_H - icons.badge) >> 1));
  if (!pending) drawCheckbox(ctx, icons, box, y + ((ROW_H - icons.boxSize) >> 1), row.enabled);

  if (row.current) {
    // `[I]` The failing action wears a thicker, redder frame: it is the one
    // thing on the screen the player has to find.
    const breaks = row.summary.error !== undefined;
    ctx.strokeStyle = breaks ? "#ff5a5a" : "#cfc4ff";
    ctx.lineWidth = breaks ? 2 : 1;
    const i = breaks ? 1 : 0.5;
    ctx.strokeRect(g.x + i, y + i, g.w - i * 2, ROW_H - i * 2);
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
  outline: string,
): void {
  const g: ActionListGeometry = { x, y, w: ACTIONS_W, h: ROW_H };
  drawRow(ctx, sheet, manifest, fonts, g, { ...row, current: false }, y, icons, false);
  const breaks = row.summary.error !== undefined;
  ctx.strokeStyle = breaks ? "#ff5a5a" : outline;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, ACTIONS_W + 2, ROW_H + 2);
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
