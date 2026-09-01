// SPEC-007 §5 + docs/UI.md §4 — the control panel: scrub slider, tower stack,
// player status, settings.
//
// The panel holds a fixed shape at any window size while the left panel takes
// the rest. It is headed, as the game is, with the tower name over the floor
// name.

import type { Player, TowerJSON } from "../../sim/types";
import type { AtlasManifest } from "../../../tools/atlas/build";
import { drawText, fontFrom, type AtlasFontRef } from "./atlas";
import { textWidth } from "../imagefont";
import type { FloorCache } from "./floor";
import { PANEL_PAD, PANEL_W, SLIDER_W, STACK_W, STATUS_W, type Layout } from "./screen";

/** `[F]` util.lua:3-22. Dot separators every three digits; never an abbreviation. */
export function powerToString(n: number): string {
  let v = Math.floor(n);
  let out = "";
  while (v > 999) {
    const seg = v % 1000;
    v = (v - seg) / 1000;
    out = `.${String(seg).padStart(3, "0")}${out}`;
  }
  return `${v}${out}`;
}

// The tower stack. Being iterated on by eye (D24a).
//
// `[D]` Three rounds of enlarging it, and the cause was the same every time: a
// miniature of a 15x15 grid needs pixels before it needs anything else. The box
// filter in `FloorCache.mini` stopped it shimmering; these numbers are what stop
// it being too small to read. `[F]` A box filter is correct at any ratio, so
// none of them has to be a clean fraction.
/**
 * `[D]` **A 2:1 shear, not 1:1** — one pixel of horizontal offset per *two*
 * rows of vertical drop, where SPEC-007 §5's original projection used one per
 * row.
 *
 * That is what lets the floors be twice as tall for nothing: the horizontal
 * footprint is set by the total shear, so halving the shear rate pays for
 * doubling the height. The sides now rake at about 27° rather than 45°, which
 * is a shallower, more map-like view of a floor.
 */
export const STACK_SHEAR = 2;
export const STACK_FLOOR_H = 64;
/** `[D]` Floors may overlap, so at most this much clear air between them. */
const STACK_MAX_GAP = 2;
/** Thick enough to read as a boundary where floors overlap. */
const STACK_BORDER = 2;

/**
 * `[F]` **Derived, not chosen.** The shear pushes the top row of a floor
 * `ceil((h - 1) / STACK_SHEAR)` px to the right, so a floor plus its own shear
 * is the real width of the stack. Picking the width by eye and the height
 * separately silently cropped every floor's right-hand edge against the clip
 * box, so the width comes out of the budget instead, and is asserted in test.
 */
export const STACK_FLOOR_W = STACK_W - Math.ceil((STACK_FLOOR_H - 1) / STACK_SHEAR);

/**
 * How far apart consecutive floors sit, so the whole tower fits without
 * scrolling.
 *
 * `[D]` The stack no longer scrolls at all. A tower is a fixed, knowable shape
 * and the point of drawing it is to see that shape whole; scrolling to find a
 * floor defeats it. So the pitch is whatever makes the tower fit, and on a tall
 * tower that is less than a floor's height — the floors overlap, each showing
 * a band of itself, which is why they need a 2 px border to stay separable.
 *
 * `[D]` Capped so a short tower does not sprawl: at most `STACK_MAX_GAP` of
 * clear air between floors, with the whole stack centred in the panel.
 */
export function stackPitch(depth: number, availH: number): number {
  if (depth <= 1) return 0;
  const room = availH - STACK_FLOOR_H;
  return Math.max(1, Math.min(STACK_FLOOR_H + STACK_MAX_GAP, Math.floor(room / (depth - 1))));
}

export function stackHeight(depth: number, availH: number): number {
  return (depth - 1) * stackPitch(depth, availH) + STACK_FLOOR_H;
}

export interface StatusRow {
  /** A sprite stem drawn in place of the row's NAME, or null for a text label. */
  sprite: string | null;
  label: string;
  /** The row's value, right-aligned into the centre gutter. */
  value: string;
  /**
   * ...or a sprite in the value position, for a row whose value *is* an item.
   *
   * `[D]` The held item is the only such row: what you are carrying is the
   * value, and "held" is the name of the row. Drawing the icon on the name side
   * made it read as a label for an empty value.
   */
  valueSprite?: string;
}

/**
 * `[F]` Conditional rows, matching the game: dark keys are hidden under
 * negative_keys (the counter is meaningless on EX-3), gold appears only under
 * the money_system flag, and the held item only when something is held.
 */
export function statusRows(tower: TowerJSON, p: Player): StatusRow[] {
  const flags = tower.metadata.computed_flags;
  const rows: StatusRow[] = [
    { sprite: null, label: "Power", value: powerToString(p.power) },
    { sprite: "key", label: "", value: String(p.lightKeys) },
  ];
  if (flags.negative_keys !== true) rows.push({ sprite: "dark_key", label: "", value: String(p.darkKeys) });
  rows.push({ sprite: "pickaxe", label: "", value: String(p.pickaxes) });
  if (flags.money_system === true) rows.push({ sprite: null, label: "Money", value: `${p.gold}G` });
  // Gems are shown as an amount SPENT: the total moves as gems are collected in
  // other towers, so spent is the number a route is planned against (§2.3).
  rows.push({ sprite: "gem", label: "spent", value: String(p.gemsSpent) });
  if (p.held !== null) rows.push({ sprite: null, label: "held", value: "", valueSprite: p.held });
  return rows;
}

export interface RightPanelState {
  tower: TowerJSON;
  player: Player;
  floorName: string;
  stop: number;
  stopCount: number;
  /** Stop indices where the route changes floor, for the slider's ticks. */
  ticks: number[];
  currentFloor: number;
  captions: boolean;
  perf: boolean;
  perfLine: string;
}

/**
 * A status row names an **entity type**; the atlas is keyed by **sprite file
 * stem**, and the two are not always the same word.
 *
 * `[F]` Most held items happen to match — `shield`, `feather`, `master_key` —
 * which is why looking up the type directly appeared to work. The Vorpal Blade
 * is `vorpal` as a type and `vorpal_sword.png` as a sprite, so its icon silently
 * failed to draw. `entitydef.lua` is the authority on that mapping and the atlas
 * manifest already carries it, so go through it rather than trusting the name.
 */
export function spriteRect(manifest: AtlasManifest, name: string): { x: number; y: number; w: number; h: number } | undefined {
  return manifest.sprites[name] ?? manifest.sprites[manifest.entities[name]?.[0] ?? ""];
}

export function panelX(layout: Layout): number {
  return layout.w - PANEL_W - PANEL_PAD;
}

export function sliderGeometry(layout: Layout): { x: number; y: number; h: number } {
  // Below the two-line header AND the action counter, which sits under it.
  const top = 46;
  return { x: panelX(layout), y: top, h: Math.max(40, layout.h - top - 78) };
}

export function drawRightPanel(
  ctx: CanvasRenderingContext2D,
  manifest: AtlasManifest,
  sheet: CanvasImageSource,
  floors: FloorCache,
  s: RightPanelState,
  layout: Layout,
): void {
  const x0 = panelX(layout);
  const standard = fontFrom(manifest, "FONT_STANDARD");
  const digits = fontFrom(manifest, "FONT_DIGITS");

  ctx.fillStyle = "#15151a";
  ctx.fillRect(x0 - PANEL_PAD, 0, PANEL_W + PANEL_PAD * 2, layout.h);

  // Headed, as the game is, with the tower name over the floor name.
  drawText(ctx, sheet, standard, s.tower.metadata.name, x0, 5);
  drawText(ctx, sheet, standard, s.floorName, x0, 16);

  drawSlider(ctx, sheet, standard, s, layout);
  drawStack(ctx, floors, standard, sheet, s, layout);
  drawStatus(ctx, sheet, manifest, standard, digits, s, layout);
  drawSettings(ctx, sheet, standard, s, layout);
}

/**
 * `[D]` **Time runs upward: stop 0 is at the bottom.** The route is climbing a
 * tower, and the tower stack beside it already puts floor 1 at the bottom — a
 * slider running the other way made scrubbing back feel like going up.
 */
export function stopToY(stop: number, stopCount: number, g: { y: number; h: number }): number {
  const t = stopCount <= 1 ? 0 : stop / (stopCount - 1);
  return g.y + (1 - t) * (g.h - 1);
}

export function yToStop(y: number, stopCount: number, g: { y: number; h: number }): number {
  const t = 1 - (y - g.y) / Math.max(1, g.h - 1);
  return Math.round(t * (stopCount - 1));
}

function drawSlider(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  s: RightPanelState,
  layout: Layout,
): void {
  const g = sliderGeometry(layout);
  const mid = g.x + SLIDER_W / 2;
  ctx.fillStyle = "#2a2a33";
  ctx.fillRect(mid - 2, g.y, 4, g.h);

  // Ticks on the track mark where the route changes floor.
  ctx.fillStyle = "#55556a";
  for (const t of s.ticks) ctx.fillRect(g.x + 2, Math.round(stopToY(t, s.stopCount, g)), SLIDER_W - 4, 1);

  // `[D]` The nub is an hourglass on its side, crossing the track at its waist:
  // a plain bar was too small to aim at, and a bigger bar would have hidden the
  // tick it sits on. The waist keeps the exact position visible while the flared
  // ends give it something to grab.
  const cy = Math.round(stopToY(s.stop, s.stopCount, g));
  const half = SLIDER_W / 2;
  ctx.fillStyle = "#cfc4ff";
  ctx.beginPath();
  ctx.moveTo(mid - half, cy - NUB_HALF_H);
  ctx.lineTo(mid + half, cy - NUB_HALF_H);
  ctx.lineTo(mid + 1, cy);
  ctx.lineTo(mid + half, cy + NUB_HALF_H);
  ctx.lineTo(mid - half, cy + NUB_HALF_H);
  ctx.lineTo(mid - 1, cy);
  ctx.closePath();
  ctx.fill();

  // Which action you are on, out of how many. Sits on its own line under the
  // two-line header rather than over it.
  drawText(ctx, sheet, font, `${s.stop + 1}/${s.stopCount}`, g.x, g.y - 13);
}

/** Half the height of the hourglass nub's flared end. */
export const NUB_HALF_H = 5;

/**
 * docs/UI.md §4 — the whole tower as a vertical stack, each floor squashed
 * vertically with its sides raked over at 45 degrees, reusing the same floor
 * images as the timeline panel so the two always agree.
 *
 * `[F]` §5: the shear is pixel-exact, one pixel of horizontal offset per row of
 * vertical drop, and no resampling happens along it. Only the vertical squash
 * resamples, which is why it is done a source row at a time.
 */
function drawStack(
  ctx: CanvasRenderingContext2D,
  floors: FloorCache,
  font: AtlasFontRef,
  sheet: CanvasImageSource,
  s: RightPanelState,
  layout: Layout,
): void {
  const g = sliderGeometry(layout);
  const x0 = panelX(layout) + SLIDER_W + 4;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, g.y, STACK_W, g.h);
  ctx.clip();

  // Floor 1 at the bottom, as the tower is numbered (D1). The whole tower is
  // laid out to fit the panel and centred in it, so nothing scrolls and no
  // floor is ever off-screen.
  const pitch = stackPitch(floors.depth, g.h);
  const total = stackHeight(floors.depth, g.h);
  const base = Math.round(g.y + (g.h + total) / 2);

  // `[D]` **Every floor is drawn identically.** The current one used to be
  // taller, which made the whole stack shift as you scrubbed — every floor
  // above it moved by the difference. Being drawn last and wearing the lavender
  // outline is enough to find it, and a stack that holds still is worth more
  // than one that emphasises: the floors are about to become hoverable, and a
  // target that moves when you approach it is the wrong kind of interface.
  const h = STACK_FLOOR_H;
  // `[F]` The shear is what makes the horizontal footprint, so its rate and the
  // floor height trade off exactly: at 2:1 a floor twice as tall costs no more
  // width. `x` is a whole pixel per row, so nothing resamples along it -- only
  // the vertical squash does, and that is pre-filtered into `mini`. The shear
  // is pre-applied there too, so a floor is one blit rather than 64 (D39).
  const shear = (r: number): number => Math.floor((h - 1 - r) / STACK_SHEAR);

  const drawFloor = (z: number): void => {
    const current = z === s.currentFloor;
    const top = base - (z - 1) * pitch - h;
    if (top + h < g.y || top > g.y + g.h) return;

    ctx.drawImage(floors.mini(z, STACK_FLOOR_W, h, shear), x0, top);

    // Outline every floor, following the shear. Floors overlap on a tall tower,
    // so this is the only thing separating one from the next.
    ctx.strokeStyle = current ? "#cfc4ff" : "#000";
    ctx.lineWidth = STACK_BORDER;
    const half = STACK_BORDER / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + shear(0) - half, top - half);
    ctx.lineTo(x0 + shear(0) + STACK_FLOOR_W + half, top - half);
    ctx.lineTo(x0 + shear(h - 1) + STACK_FLOOR_W + half, top + h + half);
    ctx.lineTo(x0 + shear(h - 1) - half, top + h + half);
    ctx.closePath();
    ctx.stroke();

    if (current) {
      // The current floor is the only one labelled; the rest name themselves on
      // hover, because a tall tower has nowhere near room for every name. On its
      // own dark plate, since with the floors overlapping there is no clear air
      // to put it in.
      const w = textWidth(font, s.floorName);
      ctx.fillStyle = "#15151a";
      ctx.fillRect(x0 + shear(0) - 2, top - 12, w + 4, 11);
      drawText(ctx, sheet, font, s.floorName, x0 + shear(0), top - 10);
    }
  };

  // Low floors first, so a higher floor overlaps the one below it -- then the
  // current floor again, last, so nothing above can bury the one being read.
  for (let z = 1; z <= floors.depth; z++) if (z !== s.currentFloor) drawFloor(z);
  if (s.currentFloor >= 1 && s.currentFloor <= floors.depth) drawFloor(s.currentFloor);
  ctx.restore();
}

function drawStatus(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  standard: AtlasFontRef,
  digits: AtlasFontRef,
  s: RightPanelState,
  layout: Layout,
): void {
  const g = sliderGeometry(layout);
  const x0 = panelX(layout) + SLIDER_W + STACK_W + 4;
  // Numbers right-aligned into a centre gutter, labels to the right of it, so
  // the magnitudes line up and read down the column (UI.md §4).
  const gutter = x0 + 96;
  let y = g.y + 4;

  for (const row of statusRows(s.tower, s.player)) {
    const hasIcon = row.sprite !== null || row.valueSprite !== undefined;

    // The value side of the gutter: a number, or — for the held item — the
    // icon of the thing itself, right-aligned exactly as a number would be.
    if (row.valueSprite !== undefined) {
      const r = spriteRect(manifest, row.valueSprite);
      if (r) ctx.drawImage(sheet, r.x, r.y, r.w, r.h, gutter - 16, y - 4, 16, 16);
    } else if (row.value !== "") {
      const font = row.label === "Power" ? standard : digits;
      drawText(ctx, sheet, font, row.value, gutter - textWidth(font, row.value), y + (font === digits ? 1 : 0));
    }

    // The name side: a sprite standing in for the word, as the game does, or
    // the word itself.
    if (row.sprite !== null) {
      const r = spriteRect(manifest, row.sprite);
      if (r) ctx.drawImage(sheet, r.x, r.y, r.w, r.h, gutter + 4, y - 4, 16, 16);
      if (row.label !== "") drawText(ctx, sheet, standard, row.label, gutter + 23, y);
    } else {
      drawText(ctx, sheet, standard, row.label, gutter + 4, y);
    }
    y += hasIcon ? 17 : 11;
  }
}

function drawSettings(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  s: RightPanelState,
  layout: Layout,
): void {
  const x0 = panelX(layout);
  let y = layout.h - 38;
  for (const [label, on] of [
    ["perf test", s.perf],
    ["captions", s.captions],
  ] as const) {
    ctx.fillStyle = on ? "#b9aef0" : "#3a3a44";
    ctx.fillRect(x0, y, 9, 9);
    ctx.fillStyle = "#15151a";
    ctx.fillRect(x0 + 2, y + 2, 5, 5);
    if (on) {
      ctx.fillStyle = "#b9aef0";
      ctx.fillRect(x0 + 3, y + 3, 3, 3);
    }
    drawText(ctx, sheet, font, label, x0 + 14, y + 1);
    y += 12;
  }
  if (s.perf) drawText(ctx, sheet, font, s.perfLine, x0 + 92, layout.h - 37);
  drawText(ctx, sheet, font, "Unofficial. Not by the developer of Towers of Scale.", x0, layout.h - 12);
}

export const SETTINGS_HITBOXES = (layout: Layout): Array<{ x: number; y: number; w: number; h: number }> => [
  { x: panelX(layout), y: layout.h - 38, w: STATUS_W, h: 9 },
  { x: panelX(layout), y: layout.h - 26, w: STATUS_W, h: 9 },
];
