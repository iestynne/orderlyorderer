// SPEC-007 §6.2 — a reader for love.graphics.newImageFont.
//
// Love2D delimits glyphs by columns of the colour found at pixel (0,0): each
// run of non-spacer pixels along the TOP ROW is one glyph cell, full image
// height, assigned to the charset in order. Spacer-coloured pixels inside a
// glyph are transparent. Advance is the cell width plus the font's extra
// spacing, which is negative for three of the game's four fonts.
//
// Pure: RGBA in, metrics out. No DOM, no filesystem — the build step and the
// browser both call it.

export interface Glyph {
  char: string;
  /** Left edge in the source image. */
  x: number;
  /** Cell width in pixels; the advance is this plus `spacing`. */
  w: number;
}

export interface ImageFont {
  height: number;
  spacing: number;
  /** Spacer colour as 0xRRGGBBAA, for making it transparent when baking. */
  spacer: number;
  glyphs: Glyph[];
  /** Every top-row run found, including any trailing padding past the charset. */
  cellCount: number;
}

export class ImageFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFontError";
  }
}

export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
}

export function pixelAt(img: Rgba, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return (
    ((img.pixels[i]! << 24) | (img.pixels[i + 1]! << 16) | (img.pixels[i + 2]! << 8) | img.pixels[i + 3]!) >>> 0
  );
}

/**
 * `charset` may repeat a character — digits.png's does, twice over `x` — so the
 * cells are kept in order and a lookup takes the first occurrence, as Love's
 * own map-insert does.
 */
export function readImageFont(img: Rgba, charset: string, spacing: number): ImageFont {
  const spacer = pixelAt(img, 0, 0);
  const runs: Array<{ x: number; w: number }> = [];
  let start = -1;
  for (let x = 0; x < img.width; x++) {
    const isSpacer = pixelAt(img, x, 0) === spacer;
    if (!isSpacer && start < 0) start = x;
    if (isSpacer && start >= 0) {
      runs.push({ x: start, w: x - start });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ x: start, w: img.width - start });

  const chars = [...charset];
  if (runs.length < chars.length) {
    throw new ImageFontError(`image font has ${runs.length} glyph cells for a ${chars.length}-character charset`);
  }
  // digits_neg.png carries one more cell than its charset: seven columns of
  // fully transparent padding after the last glyph. Love assigns cells to the
  // charset in order and never looks at the rest, so neither do we.
  const glyphs = chars.map((char, i) => ({ char, x: runs[i]!.x, w: runs[i]!.w }));
  return { height: img.height, spacing, spacer, glyphs, cellCount: runs.length };
}

export function glyphOf(font: Pick<ImageFont, "glyphs">, char: string): Glyph | undefined {
  return font.glyphs.find((g) => g.char === char);
}

/** Love's font:getWidth — every glyph contributes its advance, the last included. */
export function textWidth(font: Pick<ImageFont, "glyphs" | "spacing">, text: string): number {
  let w = 0;
  for (const ch of text) {
    const g = glyphOf(font, ch);
    if (g) w += g.w + font.spacing;
  }
  return w;
}
