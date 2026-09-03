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
// `[D]` **The current action holds a fixed pixel row and the list moves under
// it.** Centring on every seek made the list saw back and forth as the slider
// was dragged. The row changes only when the player clicks one, and then it
// becomes exactly where that row already was — so the thing they aimed at does
// not move at all, and everything else shifts around it.
//
// `[D]` A row says what the action **did**, not where it happened. The
// classification is `src/sim/route/describe.ts`, which is pure and tested; this
// file turns it into sprites and rectangles and nothing more.

import type { AtlasManifest } from "../../../tools/atlas/build";
import type { ActionSummary } from "../../sim/route/describe";
import type { SimError } from "../../sim/types";
import { drawText, keyOf, labelOf, spriteFor, type AtlasFontRef } from "./atlas";
import { textWidth } from "../imagefont";
import { drawCheckbox, drawPlus, type Icons } from "./marks";
import * as C from "./palette";
import { ACTIONS_W, LABEL_RIGHT, LABEL_Y, PANEL_PAD, PANEL_W, SLIDER_W, type Layout } from "./screen";

export const ROW_H = 18;

/**
 * The columns, at reserved widths so everything lines up down the list:
 * the number, what the action **spent**, what it **acted on**, the gold it
 * moved, and what it was **carrying** that changed the outcome.
 *
 * `[I]` Spent first, because it is what a failure is usually about, and
 * carrying last, because it is context rather than content.
 */
const NUM_W = 20;
const SLOT = 17;
/** The spent slot holds a deficit number as well as an icon, so it is wider. */
const SPENT_W = 30;

/**
 * `[I]` A blank row above the current action and another below it. The one
 * above is where a pending insertion lands — insertions go *after* the current
 * action, and later is higher — and the one below is its mirror, so the current
 * row sits in clear air rather than at the top of a gap.
 */
const CLEARANCE = ROW_H;

export interface ActionRow {
  /** Steps from the current action: 0 is current, +1 the next, -1 the previous. */
  offset: number;
  /** 1-based, as the slider counts. */
  number: number;
  summary: ActionSummary;
  enabled: boolean;
  inserted: boolean;
  current: boolean;
  /** True from the action that breaks the route onward. */
  failed: boolean;
  /** True on the one action that breaks it. */
  breaks: boolean;
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

/** Where the current action's row sits by default: the middle of the list. */
export function defaultPinY(g: ActionListGeometry): number {
  return g.y + Math.floor((slotCount(g) >> 1) * ROW_H);
}

export function clampPinY(g: ActionListGeometry, y: number): number {
  return Math.max(g.y, Math.min(g.y + g.h - ROW_H, y));
}

/**
 * The top of the row `offset` actions away from the current one, given where
 * the current one sits.
 *
 * Later actions are above and earlier ones below, and the clearance either side
 * of the current row is what pushes them one further out.
 */
export function rowTop(pinY: number, offset: number): number {
  return pinY - offset * ROW_H - (offset > 0 ? CLEARANCE : offset < 0 ? -CLEARANCE : 0);
}

/** Which offset a point is over, or null. */
export function offsetAt(g: ActionListGeometry, pinY: number, x: number, y: number): number | null {
  if (x < g.x || x > g.x + g.w) return null;
  const span = slotCount(g) + 2;
  for (let offset = -span; offset <= span; offset++) {
    const top = rowTop(pinY, offset);
    if (y >= top && y < top + ROW_H && top >= g.y - ROW_H && top < g.y + g.h) return offset;
  }
  return null;
}

/** The checkbox of a row, for hit-testing a toggle. */
export function checkboxAt(g: ActionListGeometry, pinY: number, offset: number): { x: number; y: number; w: number; h: number } {
  return { x: g.x + g.w - 14, y: rowTop(pinY, offset), w: 14, h: ROW_H };
}

export function drawActionList(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  rows: readonly ActionRow[],
  pinY: number,
  pending: ActionSummary | null,
  icons: Icons,
  hovered: number | null,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x, g.y, g.w, g.h);
  ctx.clip();

  for (const row of rows) {
    drawRow(ctx, sheet, manifest, fonts, g, row, rowTop(pinY, row.offset), icons, hovered === row.offset);
  }
  if (pending !== null) {
    drawRow(
      ctx, sheet, manifest, fonts, g,
      { offset: 0, number: 0, summary: pending, enabled: true, inserted: true, current: false, failed: false, breaks: false },
      rowTop(pinY, 0) - CLEARANCE,
      icons, false, { pending: true },
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
  opts: { pending?: boolean; number?: boolean } = {},
): void {
  const pending = opts.pending === true;
  ctx.fillStyle = hovered ? C.BAND_HOVER : (row.failed ? C.BAND_FAILED : C.BAND)[row.number % 2]!;
  ctx.fillRect(g.x, y, g.w, ROW_H);
  ctx.globalAlpha = pending || !row.enabled ? 0.5 : 1;

  let x = g.x;
  // 1. the number, right-justified. `[I]` Omitted from the copy under the
  //    floor: it is redundant with the list and not what that copy is for.
  if (!pending && opts.number !== false) {
    const n = String(row.number);
    drawText(ctx, sheet, fonts.digits, n, x + NUM_W - textWidth(fonts.digits, n), y + 5);
  }
  x += NUM_W + 2;

  // `[I]` An action that found its work already done says nothing but its
  // number: there is no enemy left to draw, and drawing the dead one would be
  // a lie about what this action does now.
  if (row.summary.kind !== "noop") {
    // 2. what it spent -- or, where it failed, what it was short of.
    drawSpent(ctx, sheet, manifest, fonts, row, x, y, icons);
    x += SPENT_W;

    // 3. what it acted on, with its own value badge where it has one: an enemy
    //    without its number is just a silhouette.
    const key = keyOf(row.summary.cell);
    blit(ctx, sheet, manifest, spriteFor(key, manifest), x, y + 1);
    const label = labelOf(key);
    if (label !== null) {
      drawText(ctx, sheet, fonts.digits, label, x + LABEL_RIGHT - textWidth(fonts.digits, label), y + 1 + LABEL_Y);
    }
    x += SLOT;

    // 4. gold, stamped low on the bag: higher up it sat on the neck, and the
    //    silhouette is how the bag is recognised.
    if (row.summary.goldGained !== 0) {
      blit(ctx, sheet, manifest, "money", x, y + 1);
      const label2 = String(row.summary.goldGained);
      drawText(ctx, sheet, fonts.digits, label2, x + ((16 - textWidth(fonts.digits, label2)) >> 1), y + 8);
    }
    x += SLOT;

    // 5. what it was carrying that changed the outcome without being spent.
    if (row.summary.held !== null) blit(ctx, sheet, manifest, row.summary.held, x, y + 1);
  }

  // the toggles, hard right, the add badge always immediately left of the box.
  // `[I]` The badge keeps full strength on a disabled row: "you added this" is
  // still true when you switch it off.
  ctx.globalAlpha = 1;
  const box = g.x + g.w - icons.boxSize - 3;
  if (row.inserted) drawPlus(ctx, icons, box - icons.badge - 2, y + ((ROW_H - icons.badge) >> 1));
  if (!pending) drawCheckbox(ctx, icons, box, y + ((ROW_H - icons.boxSize) >> 1), row.enabled);

  // `[I]` The failing action is outlined whether or not it is the one being
  // looked at -- thicker when it is. It is the one thing on the screen the
  // player has to be able to find.
  if (row.breaks || row.current) {
    ctx.strokeStyle = row.breaks ? C.FAIL_BRIGHT : C.LAVENDER;
    ctx.lineWidth = row.current ? 2 : 1;
    const i = row.current ? 1 : 0.5;
    ctx.strokeRect(g.x + i, y + i, g.w - i * 2, ROW_H - i * 2);
  }
}

/**
 * The spent slot: the item the action used up, or — where it failed — what it
 * was short of and by how much.
 *
 * `[I]` A number is the useful thing. *Not enough gold* is a shrug; **21 gold
 * short** is an instruction. A missing key or pickaxe has no number, so the
 * item itself is boxed in red instead, and a route that cannot reach the square
 * has nothing to blame at all, so it shows an arrow.
 */
function drawSpent(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  row: ActionRow,
  x: number,
  y: number,
  icons: Icons,
): void {
  const error = row.summary.error;
  if (error === undefined) {
    // A Money Gate spends gold, which is not a held item; everything else that
    // is spent is one.
    const stem = row.summary.spent ?? (row.summary.goldGained < 0 ? "money" : null);
    if (stem !== null) blit(ctx, sheet, manifest, stem, x, y + 1);
    return;
  }

  const want = shortfall(error);
  if (want !== null) {
    blit(ctx, sheet, manifest, want.stem, x, y + 1);
    const label = want.text;
    const w = textWidth(fonts.digits, label);
    ctx.fillStyle = C.SHORTFALL;
    ctx.fillRect(x - 1, y + 8, w + 2, 8);
    drawText(ctx, sheet, fonts.digits, label, x, y + 8);
    return;
  }
  if (error.code === "NO_PATH" || error.code === "NOT_ADJACENT" || error.code === "OFF_MAP") {
    if (icons.arrow) ctx.drawImage(icons.arrow, x, y + ((ROW_H - icons.arrow.height) >> 1));
    return;
  }
  // A missing item: name it, and box it in red a pixel taller than the row's
  // own outline so the two do not read as one.
  const stem = MISSING[error.code];
  if (stem !== undefined) blit(ctx, sheet, manifest, stem, x, y + 1);
  ctx.strokeStyle = C.FAIL_BRIGHT;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, 17, ROW_H + 1);
}

const MISSING: Record<string, string> = {
  NEED_LIGHT_KEY: "key",
  NEED_DARK_KEY: "dark_key",
  NEED_PICKAXE: "pickaxe",
  NEED_HYPER_PICKAXE: "hyper_pickaxe",
  BLOCKED_BATTLE_GATE: "battle_gate",
  BLOCKED_IRON: "iron_wall",
  BLOCKED_ONE_WAY: "barrier_u",
};

/** How much the action was short, where the shortage is a number. */
function shortfall(error: SimError): { stem: string; text: string } | null {
  if (error.have === undefined || error.need === undefined) return null;
  const short = error.have - error.need;
  switch (error.code) {
    case "NEED_GOLD":
      return { stem: "money", text: abbreviate(short) };
    case "NEED_GEMS":
      return { stem: "gem", text: abbreviate(short) };
    case "ENEMY_TOO_STRONG":
    case "SPIKE_TOO_STRONG":
      return { stem: "player", text: abbreviate(short) };
    default:
      return null;
  }
}

/**
 * Four significant figures, with the game's own k/M/G suffixes.
 *
 * `[I]` Exact below ten thousand, where the digits are few enough to read;
 * abbreviated above it, where they are not. Power reaches twelve digits, and a
 * deficit written out in full would be a wall.
 */
export function abbreviate(n: number): string {
  const a = Math.abs(n);
  if (a < 10_000) return String(n);
  for (const [div, suffix] of [[1e9, "G"], [1e6, "M"], [1e3, "k"]] as const) {
    if (a < div) continue;
    const v = n / div;
    const digits = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : 3;
    return `${v.toFixed(digits).replace(/\.?0+$/, "")}${suffix}`;
  }
  return String(n);
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
  drawRow(ctx, sheet, manifest, fonts, g, { ...row, current: false, breaks: false }, y, icons, false, { number: false });
  ctx.strokeStyle = row.breaks ? C.FAIL_BRIGHT : outline;
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
