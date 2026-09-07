// SPEC-009 §2 — the browser the project owns and iestyn never opens.
//
// Confined to localhost four ways, none load-bearing alone: the launch flags
// and the request router here, both pinned by test (§5 cases 1 and 3); iestyn's
// firewall rule on the binary; and `CLAUDE.md`'s rule that `LAUNCH_ARGS` is
// never edited. Keep `LAUNCH_ARGS` a literal — the pin compares against it.
//
// `playwright-core`, not `playwright`: the latter's `postinstall` downloads
// browsers, which would put the network inside `npm ci`. The browser is
// installed by `npm run shots:install`, by iestyn, only.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Type-only: the runtime import is dynamic, after the env var is set. See `playwright()`.
import type { BrowserContext, Page } from "playwright-core";

/** A dead proxy for everything, bypassed for loopback only. Port 9 is discard, so it fails closed. */
export const LAUNCH_ARGS: readonly string[] = [
  "--proxy-server=127.0.0.1:9",
  "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
  "--no-first-run",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-extensions",
  "--disable-default-apps",
];

/**
 * Sized so `layoutFor` lands at scale 1 — anything from the SPEC-007 §5 minimum
 * (1096 × 524) to just under twice it — so the logical canvas *is* the viewport
 * and every pixel of a shot is a logical pixel. `deviceScaleFactor` is pinned
 * for the same reason.
 */
export const VIEWPORT = { width: 1280, height: 720 };

/** Where `npm run shots:install` puts Chromium. Gitignored; iestyn installs it. */
export const BROWSERS_PATH = ".browsers";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    // `data:`/`blob:` have no host and never leave the process.
    return !/^https?:/i.test(url);
  }
}

/**
 * `PLAYWRIGHT_BROWSERS_PATH` is read when `playwright-core` is first imported,
 * not at launch — so it is set here and the library imported after, dynamically.
 */
async function playwright(): Promise<typeof import("playwright-core")> {
  process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= BROWSERS_PATH;
  return import("playwright-core");
}

/** Whether `npm run shots:install` has been run. Synchronous: the test suite decides at import time. */
export function browsersInstalled(): boolean {
  try {
    return readdirSync(BROWSERS_PATH).some((d) => d.startsWith("chromium"));
  } catch {
    return false;
  }
}

export interface Harness {
  page: Page;
  context: BrowserContext;
  /** Every request the router refused, in order. A scenario that logs one fails. */
  aborts: string[];
  /** Every request the browser made, for invariant 1. */
  requests: string[];
  /** The profile, so a test can assert it is gone after `close` (§5 case 2). */
  profileDir: string;
  close(): Promise<void>;
}

/**
 * A fresh temporary profile every launch, deleted on close: nothing to leak
 * from. A *persistent* context so the profile directory is one we name and
 * can therefore promise to delete.
 */
export async function launch(): Promise<Harness> {
  const { chromium } = await playwright();
  const profileDir = mkdtempSync(join(tmpdir(), "orderly-shots-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    args: [...LAUNCH_ARGS],
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // The trail is anti-aliased; "reduce" would be a second reason for goldens to shift.
    reducedMotion: "no-preference",
  });

  const aborts: string[] = [];
  const requests: string[] = [];
  // The second confinement, and the one that reports.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requests.push(url);
    if (isLoopback(url)) {
      void route.continue();
      return;
    }
    aborts.push(url);
    void route.abort();
  });

  const page = context.pages()[0] ?? (await context.newPage());
  return {
    page,
    context,
    aborts,
    requests,
    profileDir,
    close: async () => {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    },
  };
}
