// SPEC-009 §4 — comparing a shot with its golden.
//
// `[D]` **Exact: zero differing pixels, no tolerance.** A tolerance is a
// number nobody can defend, and every fault §1 names — a hover offset, a click
// on the wrong row, a clipped badge — moves whole pixels. The one real source
// of drift is Chromium's anti-aliasing of the trail, and the answer to that is
// a pinned browser version and a deliberate re-baseline, not a threshold that
// would also swallow the faults.

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
