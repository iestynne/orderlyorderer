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
// `[D]` **Rows are a plain stack; nothing opens or closes.** The current action
// used to hold a blank row either side of it, which moved everything above the
// cursor whenever the current action changed. The clearance is gone: the
// current row is outlined instead, and a pending insertion is drawn offset from
// it rather than in a slot the list has to make room for.
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
/**
 * The spent slot.
 *
 * `[F]` A slot and a pixel, like the others: the deficit number it also carries
 * is drawn where an entity's value badge goes, which is *inside* the sprite's
 * own 16 px. At 30 it pushed the held item out under the enable box.
 */
const SPENT_W = 18;
/** Where each column starts, relative to the row's left edge. */
const SPENT_X = NUM_W + 2;
const CELL_X = SPENT_X + SPENT_W;
const GOLD_X = CELL_X + SLOT;
const HELD_X = GOLD_X + SLOT;

/** Where the last column ends, so a test can check nothing runs under the box. */
export function lastColumnEnd(): number {
  return HELD_X + 16;
}

/** The card under a floor drops the number, so it starts a column earlier. */
export const CARD_W = ACTIONS_W - NUM_W - 2;

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

/** The top of the row `offset` actions away from the current one. */
export function rowTop(pinY: number, offset: number): number {
  return pinY - offset * ROW_H;
}

/**
 * The offset whose row contains `y`.
 *
 * `[F]` Row `offset` spans `[pinY - offset*ROW_H, ... + ROW_H)`, so the offset
 * containing a point is the **ceiling** of the distance above the pin, not the
 * floor of it. It was the floor, which named the row below the one the pointer
 * was in -- everywhere except the drag, which had its own arithmetic and so hid
 * the fault. One function now, used by both.
 */
export function offsetOfY(pinY: number, y: number): number {
  // Written as a floor of the shifted distance rather than a ceiling of the
  // plain one: the two agree on every row, but the ceiling hands back -0 for
  // the foot of row 0, which compares equal to 0 and is not the same value.
  return Math.floor((pinY - y + ROW_H - 1) / ROW_H);
}

/** Which offset a point is over, or null when it is outside the list. */
export function offsetAt(g: ActionListGeometry, pinY: number, x: number, y: number): number | null {
  if (x < g.x || x > g.x + g.w || y < g.y || y >= g.y + g.h) return null;
  return offsetOfY(pinY, y);
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

  // `[I]` The failing stretch gets an outline of its own. The band behind those
  // rows is deliberately faint — it must not fight the text — and faint is not
  // enough to say where the stretch begins and ends, which is the thing the
  // slider says in a different set of pixels entirely.
  const failed = rows.filter((r) => r.failed);
  if (failed.length > 0) {
    const top = Math.min(...failed.map((r) => rowTop(pinY, r.offset)));
    const bottom = Math.max(...failed.map((r) => rowTop(pinY, r.offset) + ROW_H));
    ctx.strokeStyle = C.FAIL;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x + 0.5, top + 0.5, g.w - 1, bottom - top - 1);
  }

  // `[I]` A pending insertion sits up and to the right of the current action,
  // which is where it would land, rather than in a gap the list has to hold
  // open for it. Its own colour, and a soft shadow so it reads as floating.
  if (pending !== null) {
    const x = g.x + 8;
    const y = rowTop(pinY, 0) - ROW_H / 2;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, g.w - 8, ROW_H);
    ctx.globalAlpha = 1;
    drawRow(
      ctx, sheet, manifest, fonts, { ...g, x },
      { offset: 0, number: 0, summary: pending, enabled: true, inserted: false, current: false, failed: false, breaks: false },
      y, icons, false, { pending: true },
    );
    ctx.strokeStyle = C.ADDED;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, g.w - 9, ROW_H - 1);
  }
  ctx.restore();

  // `[D]` **Badges last, over every outline in the list, and in a clip of
  // their own.** Two reasons, either of which would be enough on its own. A
  // badge names a thing, while an outline says which row you are on and where
  // the route breaks — drawn row by row, the failing action's outline and the
  // failed stretch's outline both landed on badges belonging to rows drawn
  // before them, so the two kinds of mark fought over the same pixels. And the
  // `+` straddles the list's left edge, over the slider, so it needs a clip
  // wider than the list on that side; the list's own cut it in half.
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x - icons.badge, g.y, g.w + icons.badge, g.h);
  ctx.clip();
  for (const row of rows) {
    drawRowBadges(ctx, sheet, fonts, g, row, rowTop(pinY, row.offset), icons);
  }
  if (pending !== null) {
    drawRowBadges(
      ctx, sheet, fonts, { ...g, x: g.x + 8 },
      { offset: 0, number: 0, summary: pending, enabled: true, inserted: false, current: false, failed: false, breaks: false },
      rowTop(pinY, 0) - ROW_H / 2, icons, { pending: true },
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
  const numbered = !pending && opts.number !== false;
  ctx.fillStyle = hovered ? C.BAND_HOVER : (row.failed ? C.BAND_FAILED : C.BAND)[row.number % 2]!;
  ctx.fillRect(g.x, y, g.w, ROW_H);
  // `[I]` A switched-off row is dimmer than it was: half strength still read as
  // live at a glance.
  ctx.globalAlpha = pending ? 0.55 : row.enabled ? 1 : 0.35;

  // The columns are at fixed offsets, so a missing icon leaves a hole rather
  // than shuffling everything after it along.
  const col = (x: number): number => g.x + (numbered ? x : x - NUM_W - 2);
  if (numbered) {
    const n = String(row.number);
    drawText(ctx, sheet, fonts.digits, n, g.x + NUM_W - textWidth(fonts.digits, n), y + 5);
  }

  // `[I]` An action that found its work already done says nothing but its
  // number: there is no enemy left to draw, and drawing the dead one would be
  // a lie about what this action does now.
  if (row.summary.kind !== "noop") {
    drawSpent(ctx, sheet, manifest, row, col(SPENT_X), y, icons);

    // What it acted on, with its own value badge: an enemy without its number
    // is just a silhouette. The badge is drawn last of all, over the outlines.
    const key = keyOf(row.summary.cell);
    blit(ctx, sheet, manifest, spriteFor(key, manifest), col(CELL_X), y + 1);

    if (row.summary.goldGained !== 0) {
      blit(ctx, sheet, manifest, "money", col(GOLD_X), y + 1);
      const label = String(row.summary.goldGained);
      drawText(ctx, sheet, fonts.digits, label, col(GOLD_X) + ((16 - textWidth(fonts.digits, label)) >> 1), y + 8);
    }
    if (row.summary.held !== null) blit(ctx, sheet, manifest, row.summary.held, col(HELD_X), y + 1);
  }

  ctx.globalAlpha = 1;
  const box = g.x + g.w - icons.boxSize - 3;
  if (!pending) drawCheckbox(ctx, icons, box, y + ((ROW_H - icons.boxSize) >> 1), row.enabled);

  // `[I]` The failing action is outlined whether or not it is the one being
  // looked at — thicker when it is, and with a dark ring outside the lavender
  // so it holds its own against whatever the row behind it is doing.
  if (row.breaks || row.current) {
    if (row.current) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(g.x + 1.5, y + 1.5, g.w - 3, ROW_H - 3);
    }
    ctx.strokeStyle = row.breaks ? C.FAIL_BRIGHT : C.LAVENDER;
    ctx.lineWidth = row.current ? 2 : 1;
    const i = row.current ? 1 : 0.5;
    ctx.strokeRect(g.x + i, y + i, g.w - i * 2, ROW_H - i * 2);
  }

}

/**
 * The badges a row wears: the value naming what it acted on, the number it was
 * short by, and the `+` an inserted action carries.
 *
 * Drawn in a pass of its own after every row body and every outline — see
 * `drawActionList` for why that is not merely tidier.
 */
export function drawRowBadges(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  fonts: { standard: AtlasFontRef; digits: AtlasFontRef },
  g: ActionListGeometry,
  row: ActionRow,
  y: number,
  icons: Icons,
  opts: { pending?: boolean; number?: boolean } = {},
): void {
  const pending = opts.pending === true;
  const numbered = !pending && opts.number !== false;
  const col = (x: number): number => g.x + (numbered ? x : x - NUM_W - 2);
  if (row.summary.kind === "noop") return;

  // `[I]` **The deficit is a red number, not a number on red.** A block of
  // colour behind white digits is a red label; what should carry the failure is
  // the digits' own ink, which is what `icons.deficit` bakes. It sits where an
  // entity's value badge sits, so a shortfall and a quantity are read in the
  // same place and told apart by colour and by sign.
  const want = row.summary.error === undefined ? null : shortfall(row.summary.error);
  if (want !== null && icons.deficit !== null) {
    const { sheet: ink, font } = icons.deficit;
    drawText(ctx, ink, font, want.text, col(SPENT_X) + LABEL_RIGHT - textWidth(font, want.text), y + 1 + LABEL_Y);
  }

  const label = labelOf(keyOf(row.summary.cell));
  if (label !== null) {
    ctx.globalAlpha = row.enabled || pending ? 1 : 0.35;
    drawText(ctx, sheet, fonts.digits, label, col(CELL_X) + LABEL_RIGHT - textWidth(fonts.digits, label), y + 1 + LABEL_Y);
    ctx.globalAlpha = 1;
  }

  // `[I]` The add badge is centred on the row's left edge, above everything: on
  // the right it collided with the gold column, and it belongs to the row as a
  // whole rather than to any one of its columns.
  if (row.inserted) drawPlus(ctx, icons, g.x - (icons.badge >> 1), y + ((ROW_H - icons.badge) >> 1));
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
  row: ActionRow,
  x: number,
  y: number,
  icons: Icons,
): void {
  const error = row.summary.error;
  if (error === undefined) {
    if (row.summary.spent !== null) blit(ctx, sheet, manifest, row.summary.spent, x, y + 1);
    return;
  }

  const want = shortfall(error);
  if (want !== null) {
    // The player is drawn tinted, as it is everywhere else: untinted it is one
    // more white sprite (D26). The number it carries is a badge, and is drawn
    // with the others once every outline is down.
    if (want.stem === "player" && icons.player) ctx.drawImage(icons.player, x, y + 1);
    else blit(ctx, sheet, manifest, want.stem, x, y + 1);
    return;
  }
  if (error.code === "NO_PATH" || error.code === "NOT_ADJACENT" || error.code === "OFF_MAP") {
    if (icons.arrow) ctx.drawImage(icons.arrow, x, y + ((ROW_H - icons.arrow.height) >> 1));
    return;
  }
  const stem = MISSING[error.code];
  if (stem !== undefined) blit(ctx, sheet, manifest, stem, x, y + 1);
  // A pixel taller at the top than the row's own outline, so the two read apart.
  ctx.strokeStyle = C.FAIL_BRIGHT;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 1.5, 17, ROW_H + 1);
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
 * click. The name strip is already there and nothing in it is ever clicked — so
 * the name gives way to it. `[I]` Narrower by the number it does not draw: the
 * number is in the list already, and every pixel here is a pixel of floor name.
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
  const g: ActionListGeometry = { x, y, w: CARD_W, h: ROW_H };
  const body = { ...row, current: false, breaks: false };
  drawRow(ctx, sheet, manifest, fonts, g, body, y, icons, false, { number: false });
  ctx.strokeStyle = row.breaks ? C.FAIL_BRIGHT : outline;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, CARD_W + 2, ROW_H + 2);
  // The card wears its own frame, so its badges come after it for the same
  // reason the list's come after the list's outlines.
  drawRowBadges(ctx, sheet, fonts, g, body, y, icons, { number: false });
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
