// SPEC-009 §4 — comparing a shot with its golden.
//
// Exact — zero differing pixels. Every fault §1 names moves whole pixels, and
// a tolerance would swallow them; Chromium drift is met by pinning the version.

import { decodePng, encodePng } from "../../src/mapdiff/png";

export interface Diff {
  /** Differing pixels, or -1 when the two images are not the same size. */
  count: number;
  width: number;
  height: number;
  /** Where the first difference is, for a report that says something. */
  first: { x: number; y: number } | null;
  /** Red where they differ, the shot dimmed where they agree; null on a size mismatch. */
  image: Uint8Array | null;
}

/**
 * Golden, shot and diff stacked into one image, for judging whether a change
 * is the one that was meant. Stacked because a row of three is 3840 wide;
 * magenta rules because nothing in the palette is magenta.
 */
export function reviewImage(golden: Uint8Array, shot: Uint8Array, diff: Uint8Array): Uint8Array | null {
  const panels = [decodePng(golden), decodePng(shot), decodePng(diff)];
  const w = panels[0]!.width;
  if (panels.some((p) => p.width !== w)) return null;
  const RULE = 2;
  const h = panels.reduce((n, p) => n + p.height, 0) + RULE * (panels.length - 1);
  const out = new Uint8Array(w * h * 4);
  let y = 0;
  panels.forEach((p, i) => {
    out.set(p.pixels, y * w * 4);
    y += p.height;
    if (i === panels.length - 1) return;
    for (let r = 0; r < RULE; r++) {
      for (let x = 0; x < w; x++) {
        const d = ((y + r) * w + x) * 4;
        out[d] = 255;
        out[d + 1] = 0;
        out[d + 2] = 255;
        out[d + 3] = 255;
      }
    }
    y += RULE;
  });
  return encodePng(w, h, out);
}

export function diffPng(shot: Uint8Array, golden: Uint8Array): Diff {
  const a = decodePng(shot);
  const b = decodePng(golden);
  if (a.width !== b.width || a.height !== b.height) {
    return { count: -1, width: a.width, height: a.height, first: null, image: null };
  }
  const out = new Uint8Array(a.width * a.height * 4);
  let count = 0;
  let first: { x: number; y: number } | null = null;
  for (let i = 0; i < out.length; i += 4) {
    const same =
      a.pixels[i] === b.pixels[i] &&
      a.pixels[i + 1] === b.pixels[i + 1] &&
      a.pixels[i + 2] === b.pixels[i + 2] &&
      a.pixels[i + 3] === b.pixels[i + 3];
    if (same) {
      // Dimmed, not blanked: a lone red pixel in an empty frame says where it
      // is and nothing about what it is on top of.
      out[i] = a.pixels[i]! >> 2;
      out[i + 1] = a.pixels[i + 1]! >> 2;
      out[i + 2] = a.pixels[i + 2]! >> 2;
      out[i + 3] = 255;
      continue;
    }
    count++;
    if (first === null) {
      const p = i / 4;
      first = { x: p % a.width, y: Math.floor(p / a.width) };
    }
    out[i] = 255;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 255;
  }
  return { count, width: a.width, height: a.height, first, image: encodePng(a.width, a.height, out) };
}
