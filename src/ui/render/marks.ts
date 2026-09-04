// docs/UI.md §6 — the marks route editing puts on the canvas: the add badge,
// the enable checkbox, the no-entry sign, and the settings cog.
//
// `[D]` **Two states the player owns, one the rules own.** A `+` says the
// player added this and an unticked box says they switched it off; the game's
// own no-entry sign says *the rules refuse this*. The first two are the
// player's doing and the third is not, so they must not look alike.
//
// `[D]` **Every icon is a sprite, tinted once.** The app's own four are pixel
// maps in `tools/atlas/icons.ts`, packed into `atlas.png` beside the game's —
// so they are inspected the same way, and so nothing here draws a path. Canvas
// 2D has no per-draw colour multiply, so a tint is baked: `multiply` lays the
// colour over the sprite and `destination-in` puts the sprite's own alpha back,
// which leaves the black outline black and turns the white ink the tint.
//
// `[F]` None of this is under SPEC-008's Verification Contract, which says so:
// it is judged by looking (D24a, D30).

import type { AtlasManifest } from "../../../tools/atlas/build";
import type { SimError } from "../../sim/types";
import { drawText, type AtlasFontRef } from "./atlas";
import { CELL, GAP, PANEL_PAD, type Layout } from "./screen";

import * as C from "./palette";

export interface Icons {
  plus: HTMLCanvasElement | null;
  box: HTMLCanvasElement | null;
  tick: HTMLCanvasElement | null;
  cog: HTMLCanvasElement | null;
  cogOpen: HTMLCanvasElement | null;
  noEntry: HTMLCanvasElement | null;
  arrow: HTMLCanvasElement | null;
  /** `[F]` The game tints the player, and so does everywhere we draw it (D26). */
  player: HTMLCanvasElement | null;
  /** The enable box, which is square, so one number sizes every hitbox. */
  boxSize: number;
  badge: number;
}

/** Baked once when a record is opened, never per frame. */
export function bakeIcons(manifest: AtlasManifest, sheet: CanvasImageSource): Icons {
  return {
    plus: tint(manifest, sheet, "icon_plus", C.ADDED),
    box: tint(manifest, sheet, "icon_box", C.DIM),
    tick: tint(manifest, sheet, "icon_tick", C.LAVENDER),
    cog: tint(manifest, sheet, "icon_cog", C.LAVENDER),
    cogOpen: tint(manifest, sheet, "icon_cog", "#15151a"),
    noEntry: tint(manifest, sheet, "no_entry", C.REFUSED),
    arrow: tint(manifest, sheet, "icon_arrow", C.FAIL_BRIGHT),
    player: tint(manifest, sheet, "player", C.PLAYER_TINT),
    boxSize: manifest.sprites["icon_box"]?.w ?? 9,
    badge: manifest.sprites["icon_plus"]?.w ?? 9,
  };
}

function tint(manifest: AtlasManifest, sheet: CanvasImageSource, name: string, colour: string): HTMLCanvasElement | null {
  const r = manifest.sprites[name];
  if (!r) return null;
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = colour;
  g.fillRect(0, 0, r.w, r.h);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

/** The `+` an added action wears. */
export function drawPlus(ctx: CanvasRenderingContext2D, icons: Icons, x: number, y: number): void {
  if (icons.plus) ctx.drawImage(icons.plus, x, y);
}

/**
 * The enable box. `[I]` Unticked is **filled dim red** rather than merely
 * empty: a switched-off action should be findable by scanning the column, and
 * an empty outline is not.
 */
export function drawCheckbox(ctx: CanvasRenderingContext2D, icons: Icons, x: number, y: number, on: boolean): void {
  if (!on) {
    ctx.fillStyle = C.DISABLED_FILL;
    ctx.fillRect(x + 1, y + 1, icons.boxSize - 2, icons.boxSize - 2);
  }
  if (icons.box) ctx.drawImage(icons.box, x, y);
  if (on && icons.tick) ctx.drawImage(icons.tick, x, y);
}

/** What a hovered cell would do: add an action, or be refused. */
export function drawCellMark(
  ctx: CanvasRenderingContext2D,
  icons: Icons,
  mark: "inserted" | "invalid",
  x: number,
  y: number,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x + 1, y + 1, CELL, CELL);
  ctx.strokeStyle = mark === "inserted" ? C.ADDED : C.REFUSED;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  if (mark === "invalid") {
    if (icons.noEntry) ctx.drawImage(icons.noEntry, x, y);
    return;
  }
  drawPlus(ctx, icons, x + CELL - icons.badge, y - 1);
}

// --- the settings cog, where the mode buttons used to be ------------------

export const COG_BOX = 15;

export function cogHitbox(layout: Layout, panelW: number): { x: number; y: number; w: number; h: number } {
  return { x: layout.w - panelW - PANEL_PAD - GAP - COG_BOX, y: GAP, w: COG_BOX, h: COG_BOX };
}

/**
 * `[I]` **A question mark, not a cog.** The drawn cog never read as one at
 * eleven pixels, and what is behind it is mostly the keys — so the panel is
 * help that happens to hold two switches, and the button says so. The glyph is
 * the font's own, in a thin box the colour of an ordinary floor's outline.
 */
export function drawHelpButton(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  layout: Layout,
  panelW: number,
  open: boolean,
): void {
  const b = cogHitbox(layout, panelW);
  ctx.fillStyle = open ? C.LAVENDER : C.PANEL;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = open ? C.LAVENDER : C.LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  drawText(ctx, sheet, font, "?", b.x + 6, b.y + 4);
}

export interface Toggle {
  label: string;
  on: boolean;
}

const PANEL_ROW = 14;
const PANEL_INSET = 5;

export function settingsPanel(layout: Layout, panelW: number, n: number, keys = 0): { x: number; y: number; w: number; h: number } {
  const b = cogHitbox(layout, panelW);
  const w = 210;
  return { x: b.x + b.w - w, y: b.y + b.h + 3, w, h: n * PANEL_ROW + keys * 11 + PANEL_INSET * 2 + (keys > 0 ? 5 : 0) };
}

export function settingsHitboxes(layout: Layout, panelW: number, n: number): Array<{ x: number; y: number; w: number; h: number }> {
  const p = settingsPanel(layout, panelW, n);
  return Array.from({ length: n }, (_, i) => ({
    x: p.x + PANEL_INSET,
    y: p.y + PANEL_INSET + i * PANEL_ROW,
    w: p.w - PANEL_INSET * 2,
    h: PANEL_ROW,
  }));
}

/**
 * `[I]` A **brighter, thicker** border, and drawn last so nothing covers it:
 * it is a transient thing the player has opened, so it has to look like it is
 * in front, and a click anywhere off it closes it.
 */
export function drawSettingsPanel(
  ctx: CanvasRenderingContext2D,
  icons: Icons,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  layout: Layout,
  panelW: number,
  toggles: readonly Toggle[],
  keys: readonly string[] = [],
): void {
  const p = settingsPanel(layout, panelW, toggles.length, keys.length);
  ctx.fillStyle = C.PANEL;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = C.LAVENDER;
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

  const boxes = settingsHitboxes(layout, panelW, toggles.length);
  toggles.forEach((t, i) => {
    const b = boxes[i]!;
    drawCheckbox(ctx, icons, b.x, b.y + 2, t.on);
    drawText(ctx, sheet, font, t.label, b.x + icons.boxSize + 5, b.y + 3);
  });
  let y = p.y + PANEL_INSET + toggles.length * PANEL_ROW + 3;
  for (const line of keys) {
    drawText(ctx, sheet, font, line, p.x + PANEL_INSET, y);
    y += 11;
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
