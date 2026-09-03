// SPEC-007 §1 — the scrubber's teardown.
//
// `[D]` The fault this asserts is not visible and does not fail anything: the
// scrubber puts `keydown` and `resize` on `window`, which outlives the canvas,
// so a scrubber that is unmounted without removing them stays alive, holds its
// whole FloorCache, and goes on seeking on every arrow key — once per mount
// ever made. React StrictMode double-invokes effects, so there were two of them
// before the user had touched anything. D40.
//
// The fake event targets below implement the DOM's own contract for
// `{ signal }`, which is the thing under test: register without one and the
// listener survives the abort, exactly as it did in the browser.

import { afterEach, describe, expect, it } from "vitest";
import { Scrubber, type ScrubberSettings } from "../../src/ui/scrubber";
import type { AtlasManifest } from "../../tools/atlas/build";

interface FakeTarget {
  addEventListener: (type: string, fn: (e: unknown) => void, opts?: { signal?: AbortSignal }) => void;
  removeEventListener: (type: string, fn: (e: unknown) => void) => void;
  listenerCount: () => number;
  dispatch: (type: string, event: unknown) => void;
}

function fakeTarget(): FakeTarget {
  const live = new Map<string, Set<(e: unknown) => void>>();
  return {
    addEventListener(type, fn, opts) {
      let set = live.get(type);
      if (!set) live.set(type, (set = new Set()));
      set.add(fn);
      opts?.signal?.addEventListener("abort", () => set!.delete(fn));
    },
    removeEventListener(type, fn) {
      live.get(type)?.delete(fn);
    },
    listenerCount: () => [...live.values()].reduce((n, s) => n + s.size, 0),
    dispatch(type, event) {
      for (const fn of [...(live.get(type) ?? [])]) fn(event);
    },
  };
}

const SETTINGS: ScrubberSettings = {
  pixelPerfect: true,
  linearFilter: false,
  perf: false,
  zoom: "auto",
};

/** Everything `Screen` touches before a record is loaded, and nothing else. */
function fakeCanvas() {
  const ctx = { imageSmoothingEnabled: false, drawImage: () => undefined, fillRect: () => undefined };
  return Object.assign(fakeTarget(), {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    parentElement: null,
    getContext: () => ctx,
  });
}

function mount(): { win: FakeTarget; canvas: FakeTarget; scrubber: Scrubber; settings: ScrubberSettings[] } {
  const win = Object.assign(fakeTarget(), { devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080 });
  const g = globalThis as Record<string, unknown>;
  g["window"] = win;
  g["document"] = { createElement: () => fakeCanvas() };
  g["cancelAnimationFrame"] = () => undefined;
  g["requestAnimationFrame"] = () => 1;

  const canvas = fakeCanvas();
  const settings: ScrubberSettings[] = [];
  const scrubber = new Scrubber(
    canvas as unknown as HTMLCanvasElement,
    {} as AtlasManifest,
    {} as CanvasImageSource,
    SETTINGS,
    (s) => settings.push(s),
  );
  return { win, canvas, scrubber, settings };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const k of ["window", "document", "cancelAnimationFrame", "requestAnimationFrame"]) delete g[k];
});

describe("Scrubber.destroy", () => {
  it("leaves nothing behind on window or on the canvas", () => {
    const { win, canvas, scrubber } = mount();
    expect(win.listenerCount(), "keydown and resize").toBe(2);
    expect(canvas.listenerCount(), "pointer down/move/up/leave and wheel").toBe(5);

    scrubber.destroy();
    expect(win.listenerCount()).toBe(0);
    expect(canvas.listenerCount()).toBe(0);
  });

  it("a key that reached the scrubber before no longer reaches it after", () => {
    const { win, scrubber, settings } = mount();
    // `0` resets the zoom, which is the one key whose effect is observable
    // without a record loaded.
    const key = { key: "0", shiftKey: false, preventDefault: () => undefined };
    win.dispatch("keydown", key);
    expect(settings.length).toBe(1);

    scrubber.destroy();
    win.dispatch("keydown", key);
    expect(settings.length, "a destroyed scrubber is deaf").toBe(1);
  });

  it("two mounts leave two scrubbers, and destroying both leaves none", () => {
    // What StrictMode does on the first mount, and what the record list does
    // every time the player goes back and picks another save.
    const first = mount();
    const canvas = first.canvas as unknown as HTMLCanvasElement;
    const second = new Scrubber(canvas, {} as AtlasManifest, {} as CanvasImageSource, SETTINGS, () => undefined);
    expect(first.win.listenerCount()).toBe(4);

    first.scrubber.destroy();
    second.destroy();
    expect(first.win.listenerCount()).toBe(0);
  });

  it("does not restart: a destroyed scrubber never asks for another frame", () => {
    const { scrubber } = mount();
    let frames = 0;
    (globalThis as Record<string, unknown>)["requestAnimationFrame"] = () => {
      frames++;
      return 1;
    };
    scrubber.destroy();
    scrubber.start();
    expect(frames).toBe(0);
  });
});
