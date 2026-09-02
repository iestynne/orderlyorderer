// docs/UI.md §7 — what route editing adds to the canvas: the mode buttons, the
// badges on added and disabled actions, the segment bracket with its
// alternatives, and the failure overlay.
//
// `[F]` None of this is under SPEC-008's Verification Contract, which says so
// explicitly: it is judged by looking (D24a, D30). What the contract covers is
// the document and the evaluation this draws.

import type { SimError } from "../../sim/types";
import type { Badge } from "../session";
import { drawText, type AtlasFontRef } from "./atlas";
import { tileOrigin, type ScrollUnit, type Visit } from "./left";
import { CELL, FLOOR, GAP, PANEL_PAD, tileHeight, type Layout } from "./screen";

export const MODE_BTN = 17;
const MODE_GAP = 2;

/** Scrub, remove, add — in that order, and mutually exclusive. */
export const MODES = ["scrub", "remove", "add"] as const;

/**
 * `[D]` Top-right of the left panel, over the strip rather than beside it. The
 * strip already owns the full width at every window size, and a button column
 * outside it would cost a tile.
 */
export function modeHitboxes(layout: Layout, panelW: number): Array<{ x: number; y: number; w: number; h: number }> {
  const right = layout.w - panelW - PANEL_PAD - GAP;
  const x0 = right - MODES.length * MODE_BTN - (MODES.length - 1) * MODE_GAP;
  return MODES.map((_, i) => ({ x: x0 + i * (MODE_BTN + MODE_GAP), y: GAP, w: MODE_BTN, h: MODE_BTN }));
}

export function drawModeButtons(ctx: CanvasRenderingContext2D, layout: Layout, panelW: number, mode: string): void {
  const boxes = modeHitboxes(layout, panelW);
  boxes.forEach((b, i) => {
    const on = MODES[i] === mode;
    ctx.fillStyle = on ? "#cfc4ff" : "#22222c";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "#0c0c10";
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.fillStyle = on ? "#15151a" : "#cfc4ff";
    glyph(ctx, MODES[i]!, b.x, b.y);
  });
}

/** Play, minus, plus — drawn rather than blitted, there being no art for them yet. */
function glyph(ctx: CanvasRenderingContext2D, mode: string, x: number, y: number): void {
  const c = MODE_BTN / 2;
  if (mode === "scrub") {
    ctx.beginPath();
    ctx.moveTo(x + c - 3, y + c - 4);
    ctx.lineTo(x + c + 4, y + c);
    ctx.lineTo(x + c - 3, y + c + 4);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.fillRect(x + c - 4, y + c - 1, 9, 2);
  if (mode === "add") ctx.fillRect(x + c - 1, y + c - 4, 2, 9);
}

/**
 * `[I]` Added actions carry a `+` badge with a drop shadow; disabled ones are
 * subtler — a *no entry* badge on the tile that would have been affected, so
 * the player keeps a reminder of what they eliminated and something to click to
 * put it back.
 *
 * `[D]` A disabled action has no slider stop, because it is not in the route
 * that ran. The badge is what keeps it on screen and clickable, which is the
 * whole of what DESIGN §3 asks the disabled state to do.
 */
export function drawBadges(
  ctx: CanvasRenderingContext2D,
  unit: ScrollUnit,
  badges: Map<string, Badge>,
  scroll: number,
  layout: Layout,
  captions: boolean,
): void {
  if (badges.size === 0) return;
  ctx.save();
  unit.floors.forEach((z, slot) => {
    const o = tileOrigin(slot, scroll, layout, captions);
    if (o.x + FLOOR < 0 || o.x > layout.w) return;
    for (const [key, badge] of badges) {
      const [bz, bx, by] = key.split(":").map(Number);
      if (bz !== z) continue;
      drawBadge(ctx, badge, o.x + (bx! - 1) * CELL, o.y + (by! - 1) * CELL);
    }
  });
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, badge: Badge, x: number, y: number): void {
  // An outline with a drop shadow around the cell, so an edited action reads as
  // raised and clickable rather than as another white sprite.
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x + 1, y + 1, CELL, CELL);
  ctx.strokeStyle = badge === "inserted" ? "#8fe08f" : "#e08f8f";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

  const cx = x + CELL - 4;
  const cy = y + 4;
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.beginPath();
  ctx.arc(cx + 1, cy + 1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = badge === "inserted" ? "#8fe08f" : "#e08f8f";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#15151a";
  ctx.fillRect(cx - 2, cy - 1, 5, 2);
  if (badge === "inserted") ctx.fillRect(cx - 1, cy - 2, 2, 5);
}

export interface BracketState {
  /** Slots of the current unit the epoch touches, or null where it touches none. */
  span: { from: number; to: number } | null;
  name: string;
  skippable: boolean;
  skipped: boolean;
  /** One per segment of the epoch: did it pass from the epoch's start state? */
  pips: Array<"active" | "passes" | "fails">;
}

/** Pip hitboxes, left to right, so a click can switch which alternative is live. */
export function pipHitboxes(b: BracketState, scroll: number, layout: Layout, captions: boolean): Array<{ x: number; y: number; w: number; h: number }> {
  if (b.span === null || b.pips.length < 2) return [];
  const o = tileOrigin(b.span.from, scroll, layout, captions);
  const y = o.y + tileHeight(captions) + 2;
  return b.pips.map((_, i) => ({ x: o.x + i * 9, y, w: 7, h: 7 }));
}

/**
 * `[I]` The current segment is marked with a bracket over its portion of the
 * timeline, and where the epoch holds alternatives each gets a pip: filled
 * where it is live, green or red for whether it would pass from here.
 */
export function drawBracket(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  b: BracketState,
  scroll: number,
  layout: Layout,
  captions: boolean,
): void {
  if (b.span === null) return;
  const a = tileOrigin(b.span.from, scroll, layout, captions);
  const z = tileOrigin(b.span.to, scroll, layout, captions);
  const y = a.y - 4;
  const x1 = a.x - 3;
  const x2 = z.x + FLOOR + 3;
  ctx.fillStyle = b.skipped ? "#e08f8f" : "#cfc4ff";
  ctx.fillRect(x1, y, x2 - x1, 1);
  ctx.fillRect(x1, y, 1, 4);
  ctx.fillRect(x2 - 1, y, 1, 4);
  const label = b.skipped ? `${b.name} (skipped)` : b.skippable ? `${b.name} (skippable)` : b.name;
  drawText(ctx, sheet, font, label, x1 + 4, y - 9);

  for (const [i, p] of pipHitboxes(b, scroll, layout, captions).entries()) {
    const state = b.pips[i]!;
    ctx.fillStyle = state === "fails" ? "#e08f8f" : "#8fe08f";
    if (state === "active") ctx.fillRect(p.x, p.y, p.w, p.h);
    else {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    }
  }
}

/**
 * `[F]` The failure report already has its content: SPEC-004 §7's `SimError`
 * carries the code plus `have` and `need`, so it can say *4 000 short* rather
 * than *too weak*, and it separates NEED_PICKAXE from NEED_HYPER_PICKAXE
 * because telling a player to find a pickaxe for a Reinforced Wall is actively
 * misleading.
 */
export function failureText(e: SimError): string[] {
  const lines = [WHY[e.code] ?? e.code];
  if (e.have !== undefined && e.need !== undefined) {
    const short = e.need - e.have;
    lines.push(short > 0 ? `${short.toLocaleString("en-GB")} short` : `have ${e.have}, need ${e.need}`);
  }
  return lines;
}

const WHY: Record<string, string> = {
  NO_PATH: "no way through",
  OFF_MAP: "off the map",
  NOT_ADJACENT: "not adjacent",
  BLOCKED_IRON: "iron wall",
  BLOCKED_ONE_WAY: "one-way wall",
  BLOCKED_BATTLE_GATE: "battle gate still closed",
  NEED_LIGHT_KEY: "no light key",
  NEED_DARK_KEY: "no dark key",
  NEED_GEMS: "not enough gems",
  NEED_GOLD: "not enough gold",
  NEED_PICKAXE: "no pickaxe",
  NEED_HYPER_PICKAXE: "no hyper pickaxe",
  ENEMY_TOO_STRONG: "too weak for this enemy",
  SPIKE_TOO_STRONG: "spikes would kill you",
  UNSUPPORTED_ENTITY: "not simulated",
};

/** Below the failing action, in the left panel, as DESIGN §4.3 asks. */
export function drawFailure(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  error: SimError,
  unit: ScrollUnit,
  visits: Visit[],
  scroll: number,
  layout: Layout,
  captions: boolean,
): void {
  const slot = unit.floors.indexOf(error.at.z);
  if (slot < 0 || visits.length === 0) return;
  const o = tileOrigin(slot, scroll, layout, captions);
  if (o.x + FLOOR < 0 || o.x > layout.w) return;

  const cx = o.x + (error.at.x - 1) * CELL;
  const cy = o.y + (error.at.y - 1) * CELL;
  ctx.strokeStyle = "#e08f8f";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 0.5, cy + 0.5, CELL - 1, CELL - 1);

  const lines = failureText(error);
  const w = 118;
  const h = 6 + lines.length * 10;
  const bx = Math.min(Math.max(o.x, cx - w / 2 + CELL / 2), o.x + FLOOR - w);
  const by = Math.min(cy + CELL + 2, o.y + FLOOR - h);
  ctx.fillStyle = "rgba(24, 12, 12, 0.92)";
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = "#e08f8f";
  ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  lines.forEach((line, i) => drawText(ctx, sheet, font, line, bx + 4, by + 4 + i * 10));
}
