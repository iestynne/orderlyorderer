// SPEC-007 §7 — the frame-time harness.
//
// `[D]` Measure requestAnimationFrame timestamp deltas, NOT the draw calls.
// Canvas 2D defers work, so timing around the blits under-reports and shows a
// false pass. `[D]` Report median and rolling max, never mean.
//
// The harness exists so a renderer swap can be judged rather than argued
// about. If Canvas 2D misses the 5 ms budget, WebGL goes behind the same
// interface and this test decides it.

export const BUDGET_MS = 5;

export interface PerfReport {
  /** [median, rolling max] in milliseconds. */
  frame: [number, number];
  seek: [number, number];
  blit: [number, number];
  pass: boolean;
}
const WINDOW = 120;

export interface PerfSample {
  seek: number;
  blit: number;
}

interface Track {
  values: number[];
  max: number;
}

function track(): Track {
  return { values: [], max: 0 };
}

function push(t: Track, v: number): void {
  t.values.push(v);
  if (t.values.length > WINDOW) t.values.shift();
  t.max = Math.max(...t.values);
}

function median(t: Track): number {
  if (t.values.length === 0) return 0;
  const s = [...t.values].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/**
 * `[D]` seek, blit and frame are reported separately, so a regression says
 * which side it came from.
 */
export class PerfHarness {
  private readonly seek = track();
  private readonly blit = track();
  private readonly frame = track();
  private last = 0;
  /** Alternates the scrub position between history start and end each frame. */
  private toEnd = true;

  /** Call with the rAF timestamp. Returns the stop index to scrub to, or null. */
  tick(now: number, stopCount: number): number | null {
    if (this.last !== 0) push(this.frame, now - this.last);
    this.last = now;
    this.toEnd = !this.toEnd;
    return this.toEnd ? stopCount - 1 : 0;
  }

  record(sample: PerfSample): void {
    push(this.seek, sample.seek);
    push(this.blit, sample.blit);
  }

  reset(): void {
    for (const t of [this.seek, this.blit, this.frame]) {
      t.values.length = 0;
      t.max = 0;
    }
    this.last = 0;
  }

  get line(): string {
    const f = (t: Track): string => `${median(t).toFixed(1)}/${t.max.toFixed(1)}`;
    return `frame ${f(this.frame)}  seek ${f(this.seek)}  blit ${f(this.blit)}  (median/max ms, budget ${BUDGET_MS})`;
  }

  get report(): PerfReport {
    const pair = (t: Track): [number, number] => [median(t), t.max];
    return {
      frame: pair(this.frame),
      seek: pair(this.seek),
      blit: pair(this.blit),
      pass: median(this.frame) <= BUDGET_MS,
    };
  }
}
