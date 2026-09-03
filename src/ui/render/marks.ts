// docs/UI.md §6 — the marks route editing puts on the canvas: the two badges,
// the no-entry sign, the settings cog, and the failure wording.
//
// `[D]` **Three states, three marks, no overlap.** A `+` says the player added
// this; a minus says the player switched it off; the game's own no-entry sign
// says *the rules refuse this*. The first two are the player's doing and the
// third is not, so they must not look alike (D38's sheet, cut in the atlas).
//
// `[F]` None of this is under SPEC-008's Verification Contract, which says so:
// it is judged by looking (D24a, D30).

import type { AtlasManifest } from "../../../tools/atlas/build";
import type { SimError } from "../../sim/types";
import { drawText, type AtlasFontRef } from "./atlas";
import { CELL, GAP, PANEL_PAD, type Layout } from "./screen";

export type Mark = "inserted" | "disabled" | "invalid";

const GREEN = "#8fe08f";
const RED = "#e08f8f";
/** `[I]` Deep red, so the sign reads as a refusal rather than as decoration. */
const DEEP_RED = "rgb(190, 40, 40)";

/**
 * The no-entry sign, tinted once.
 *
 * Canvas 2D has no per-draw colour multiply, so the tint is baked the way the
 * player's is: `multiply` lays the colour over the sprite, then
 * `destination-in` puts the sprite's own alpha back.
 */
let tinted: HTMLCanvasElement | null = null;

export function noEntrySprite(manifest: AtlasManifest, sheet: CanvasImageSource): HTMLCanvasElement | null {
  if (tinted) return tinted;
  const r = manifest.sprites["no_entry"];
  if (!r) return null;
  const c = document.createElement("canvas");
  c.width = CELL;
  c.height = CELL;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, CELL, CELL);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = DEEP_RED;
  g.fillRect(0, 0, CELL, CELL);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, CELL, CELL);
  tinted = c;
  return tinted;
}

/** A 9 px badge: `+` for an addition, `-` for a disabled action. */
export function drawBadge(ctx: CanvasRenderingContext2D, mark: "inserted" | "disabled", x: number, y: number): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.beginPath();
  ctx.arc(x + 5, y + 5, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mark === "inserted" ? GREEN : RED;
  ctx.beginPath();
  ctx.arc(x + 4, y + 4, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#15151a";
  ctx.fillRect(x + 1, y + 3, 7, 2);
  if (mark === "inserted") ctx.fillRect(x + 3, y + 1, 2, 7);
}

/** The outline an edited or refused cell wears on the floor, plus its badge. */
export function drawCellMark(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  x: number,
  y: number,
  noEntry: HTMLCanvasElement | null,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x + 1, y + 1, CELL, CELL);
  ctx.strokeStyle = mark === "inserted" ? GREEN : mark === "disabled" ? RED : DEEP_RED;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  if (mark === "invalid") {
    if (noEntry) ctx.drawImage(noEntry, x, y);
    return;
  }
  drawBadge(ctx, mark, x + CELL - 8, y - 1);
}

// --- the settings cog, where the mode buttons used to be ------------------

export const COG = 17;

export function cogHitbox(layout: Layout, panelW: number): { x: number; y: number; w: number; h: number } {
  return { x: layout.w - panelW - PANEL_PAD - GAP - COG, y: GAP, w: COG, h: COG };
}

export function drawCog(ctx: CanvasRenderingContext2D, layout: Layout, panelW: number, open: boolean): void {
  const b = cogHitbox(layout, panelW);
  ctx.fillStyle = open ? "#cfc4ff" : "#22222c";
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = "#0c0c10";
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

  // `[P]` A drawn cog, not art. iestyn replaces it if it does not sit with the
  // game's own icons.
  const cx = b.x + COG / 2;
  const cy = b.y + COG / 2;
  ctx.fillStyle = open ? "#15151a" : "#cfc4ff";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.fillRect(Math.round(cx + Math.cos(a) * 5) - 1, Math.round(cy + Math.sin(a) * 5) - 1, 2, 2);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = open ? "#cfc4ff" : "#22222c";
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

export interface Toggle {
  label: string;
  on: boolean;
}

const PANEL_ROW = 13;

export function settingsHitboxes(layout: Layout, panelW: number, n: number): Array<{ x: number; y: number; w: number; h: number }> {
  const b = cogHitbox(layout, panelW);
  const w = 112;
  const x = b.x + COG - w;
  return Array.from({ length: n }, (_, i) => ({ x, y: b.y + COG + 3 + i * PANEL_ROW, w, h: PANEL_ROW }));
}

export function drawSettingsPanel(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  layout: Layout,
  panelW: number,
  toggles: readonly Toggle[],
): void {
  const boxes = settingsHitboxes(layout, panelW, toggles.length);
  const first = boxes[0];
  if (!first) return;
  ctx.fillStyle = "#15151a";
  ctx.fillRect(first.x, first.y - 2, first.w, toggles.length * PANEL_ROW + 4);
  ctx.strokeStyle = "#3a3a44";
  ctx.lineWidth = 1;
  ctx.strokeRect(first.x + 0.5, first.y - 1.5, first.w - 1, toggles.length * PANEL_ROW + 3);

  toggles.forEach((t, i) => {
    const b = boxes[i]!;
    drawCheckbox(ctx, b.x + 4, b.y + 2, t.on);
    drawText(ctx, sheet, font, t.label, b.x + 18, b.y + 2);
  });
}

/** A 9 px box with a tick, used by the settings panel and by every action row. */
export function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
  ctx.strokeStyle = "#9a97ad";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, 8, 8);
  if (!on) return;
  ctx.strokeStyle = "#cfc4ff";
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 4.5);
  ctx.lineTo(x + 4, y + 6.5);
  ctx.lineTo(x + 7, y + 2);
  ctx.stroke();
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
