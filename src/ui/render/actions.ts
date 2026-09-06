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

/**
 * The colour the current action's marks wear — every one of them: its row's
 * outline here and, on the floor, its frame, the box over its two squares, the
 * line to its card and the card's own frame. Red is the action that breaks the
 * route; grey one after the break, which would happen and cannot; blue one the
 * player added, as its `+` and the insertion preview already are; lavender any
 * other. A break outranks the add: the `+` still says added, and the failure
 * is what has to be found.
 */
export function accentOf(row: Pick<ActionRow, "breaks" | "failed" | "inserted" | "enabled">): string {
  if (row.breaks) return C.FAIL_BRIGHT;
  // `[I]` **Switched off is grey and dashed** (`dashOf`). Dimming alone said
  // "less important" when what it has to say is "not happening": a dashed
  // outline reads as inactive at a glance and is far easier to spot than a
  // change of alpha, which is what finding one switched-off action in a long
  // list actually needs. A disabled action is never the one that breaks, so
  // this can sit under `breaks` and above everything else.
  if (row.enabled === false) return C.GREY;
  if (row.failed) return C.GREY;
  return row.inserted ? C.ADDED : C.LAVENDER;
}

/** The dash pattern an accent is stroked with: only a disabled action has one. */
export function dashOf(row: Pick<ActionRow, "enabled">): number[] {
  return row.enabled === false ? [3, 3] : [];
}

/**
 * Contiguous runs of rows matching `pred`, as offset ranges.
 *
 * `[I]` **A run is outlined once, not row by row.** Five switched-off actions
 * in a row are one decision, and five separate boxes make it look like five;
 * the failing stretch has read as a block since round six and the same is true
 * of a disabled run and of a run of insertions.
 */
export function spansOf(
  rows: readonly ActionRow[],
  pred: (r: ActionRow) => boolean,
): Array<{ from: number; to: number }> {
  const offsets = rows.filter(pred).map((r) => r.offset).sort((a, b) => a - b);
  const out: Array<{ from: number; to: number }> = [];
  for (const o of offsets) {
    const last = out[out.length - 1];
    if (last !== undefined && o === last.to + 1) last.to = o;
    else out.push({ from: o, to: o });
  }
  return out;
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

  // `[I]` **A stretch gets an outline of its own, per kind.** The band behind
  // failed rows is deliberately faint — it must not fight the text — and faint
  // is not enough to say where a stretch begins and ends. The same argument
  // applies to a run of switched-off actions and to a run of insertions: each
  // is one decision the player made, and one box says so where a box per row
  // does not. Drawn outermost-meaning-first so that where two coincide the
  // failure is the one left on top.
  for (const kind of [
    { pred: (r: ActionRow) => r.inserted, stroke: C.ADDED, dash: [] as number[] },
    { pred: (r: ActionRow) => !r.enabled, stroke: C.GREY, dash: [3, 3] },
    { pred: (r: ActionRow) => r.failed, stroke: C.FAIL, dash: [] as number[] },
  ]) {
    for (const span of spansOf(rows, kind.pred)) {
      // A larger offset is higher up the list, so the span's top is its `to`.
      const top = rowTop(pinY, span.to);
      const bottom = rowTop(pinY, span.from) + ROW_H;
      ctx.strokeStyle = kind.stroke;
      ctx.lineWidth = 1;
      ctx.setLineDash(kind.dash);
      ctx.strokeRect(g.x + 0.5, top + 0.5, g.w - 1, bottom - top - 1);
      ctx.setLineDash([]);
    }
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
  // `[I]` **The pending row goes last, body and badges together.** It floats
  // *over* the list rather than in it, and it was drawn with the rows — so
  // every row it overlapped went on to draw its value badges on top of it, and
  // a stray number from the row underneath sat in the middle of the preview
  // looking like one of its own columns. A thing that floats is drawn last.
  //
  // `[I]` Up and to the right of the current action, which is where it would
  // land, rather than in a gap the list has to hold open for it. Its own
  // colour, and a soft shadow so it reads as floating.
  if (pending !== null) {
    const px = g.x + 8;
    const py = rowTop(pinY, 0) - ROW_H / 2;
    const pg = { ...g, x: px };
    // `[I]` `inserted` so the preview wears the `+` badge: it is the mark that
    // means "the player added this", and the thing being previewed is exactly
    // that. Without it the preview said only "some action would go here".
    const pr = { offset: 0, number: 0, summary: pending, enabled: true, inserted: true, current: false, failed: false, breaks: false };
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, g.w - 8, ROW_H);
    ctx.globalAlpha = 1;
    drawRow(ctx, sheet, manifest, fonts, pg, pr, py, icons, false, { pending: true });
    // `[F]` **The outline before the badges, as everywhere else.** Drawn after,
    // it ran straight down the middle of the `+` — which reads exactly like the
    // badge being transparent, the fault A7 item 1 was about, in a new place.
    // Badges go last (see the badge pass above), and a preview is no exception.
    ctx.strokeStyle = C.ADDED;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, g.w - 9, ROW_H - 1);
    drawRowBadges(ctx, sheet, fonts, pg, pr, py, icons, { pending: true });
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
  // `[F]` **Dropping the number and moving the columns are two different
  // things.** They were one flag, so the hover preview — which has no number
  // because it has no index yet — slid its whole contents 22 px left and sat
  // with its icons under the *numbers* of the rows above and below it. The
  // card is the only thing that wants the shift: it is `CARD_W` wide precisely
  // because it drops the number column. A preview is a row, and should line up
  // with the rows it is previewing an insertion into.
  const shifted = opts.number === false;
  const numbered = !pending && !shifted;
  ctx.fillStyle = hovered ? C.BAND_HOVER : (row.failed ? C.BAND_FAILED : C.BAND)[row.number % 2]!;
  ctx.fillRect(g.x, y, g.w, ROW_H);
  // `[I]` A switched-off row is dimmer than it was: half strength still read as
  // live at a glance.
  ctx.globalAlpha = pending ? 0.55 : row.enabled ? 1 : 0.35;

  // The columns are at fixed offsets, so a missing icon leaves a hole rather
  // than shuffling everything after it along.
  const col = (x: number): number => g.x + (shifted ? x - NUM_W - 2 : x);
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
    // `[I]` **The held slot is a reminder, not a statement about this action.**
    // It says what is being carried, which is true of every action in the run
    // and tells you nothing about this one — so it is dimmed to sit under the
    // columns that do. The exception is the action that expends it: there the
    // held item is exactly the point, and it draws at full strength.
    if (row.summary.held !== null) {
      const alpha = ctx.globalAlpha;
      if (row.summary.held !== row.summary.spent) ctx.globalAlpha = alpha * 0.45;
      blit(ctx, sheet, manifest, row.summary.held, col(HELD_X), y + 1);
      ctx.globalAlpha = alpha;
    }
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
    ctx.strokeStyle = accentOf(row);
    ctx.lineWidth = row.current ? 2 : 1;
    ctx.setLineDash(dashOf(row));
    const i = row.current ? 1 : 0.5;
    ctx.strokeRect(g.x + i, y + i, g.w - i * 2, ROW_H - i * 2);
    ctx.setLineDash([]);
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
  // `[F]` **Dropping the number and moving the columns are two different
  // things.** They were one flag, so the hover preview — which has no number
  // because it has no index yet — slid its whole contents 22 px left and sat
  // with its icons under the *numbers* of the rows above and below it. The
  // card is the only thing that wants the shift: it is `CARD_W` wide precisely
  // because it drops the number column. A preview is a row, and should line up
  // with the rows it is previewing an insertion into.
  const shifted = opts.number === false;
  const numbered = !pending && !shifted;
  const col = (x: number): number => g.x + (shifted ? x - NUM_W - 2 : x);
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
    // Two pixels right of the column, clear of the outline that would otherwise
    // cut its tail off.
    if (icons.arrow) ctx.drawImage(icons.arrow, x + 2, y + ((ROW_H - icons.arrow.height) >> 1));
    return;
  }
  const stem = MISSING[error.code];
  if (stem !== undefined) blit(ctx, sheet, manifest, stem, x, y + 1);
  // `[I]` A pixel proud of the row's own outline **top and bottom**, so the two
  // read apart. It used to overhang only at the top, which left the bottom edge
  // sitting exactly under the thick current-action outline and disappearing
  // into it on the one row where it matters most.
  ctx.strokeStyle = C.FAIL_BRIGHT;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 1.5, 17, ROW_H + 2);
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
  ctx.strokeStyle = outline;
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
