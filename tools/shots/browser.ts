// SPEC-009 §2 — the browser the project owns and iestyn never opens.
//
// `[D]` **Confined to localhost, four ways, none load-bearing alone.** Two of
// them are here — the launch flags and the request router — and a test pins
// both (§5 cases 1 and 3). The other two are outside this file: iestyn's own
// Windows Firewall outbound block on the Chromium binary, and `CLAUDE.md`'s
// rule that an agent never edits `LAUNCH_ARGS`. That rule is only enforceable
// because the array below is a literal a test can compare against, so **keep
// it a literal**: build the flags at run time and the pin becomes a tautology.
//
// `[D]` **`playwright-core`, not `playwright`.** They are the same library;
// what `playwright` adds is a `postinstall` that downloads browsers, which
// would put a network fetch inside `npm ci` — the first thing every session
// runs (`CLAUDE.md` step 2). §2 asks that nothing in `package.json`'s ordinary
// scripts reaches the network, and this is how that is true rather than merely
// intended. The browser is installed separately, by iestyn, by the one command
// in `npm run shots:install`.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// `[F]` **Type-only, and the runtime import is dynamic** — see
// `useProjectBrowsers`. A static `import { chromium }` here is enough to make
// the library read `PLAYWRIGHT_BROWSERS_PATH` before anything has set it.
import type { BrowserContext, Page } from "playwright-core";

/**
 * `[F]` A dead proxy for everything, bypassed for loopback only. Port 9 is
 * discard: a connection to it is refused rather than answered, so a request
 * that escapes the bypass list fails closed.
 */
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
 * The window the shots are taken in.
 *
 * `[D]` **Sized so the layout lands at scale 1** (§4). `layoutFor` floors the
 * scale, so any viewport from the SPEC-007 §5 minimum (1096 × 524) up to just
 * under twice it gives scale 1 — and then the logical canvas *is* the
 * viewport, so a shot is 1280 × 720 logical pixels and every pixel in it is a
 * logical one. `deviceScaleFactor` is pinned for the same reason: a 2 here
 * would put a fractional scale under the integer one.
 */
export const VIEWPORT = { width: 1280, height: 720 };

/** Where `npm run shots:install` puts Chromium. Gitignored; iestyn installs it. */
export const BROWSERS_PATH = ".browsers";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    // A `data:` or `blob:` URL has no host and never leaves the process. Only
    // something with a host can go anywhere, so anything without one is fine.
    return !/^https?:/i.test(url);
  }
}

/**
 * `[F]` **`PLAYWRIGHT_BROWSERS_PATH` is read when `playwright-core` is first
 * imported, not when a browser is launched.** Setting it in a function that
 * runs after a static `import { chromium }` is too late: the library has
 * already resolved its browsers directory to `%LOCALAPPDATA%\ms-playwright`,
 * and the launch fails saying the executable is not there — while `.browsers/`
 * holds it all along. So the env var is set here and the library is imported
 * *after*, dynamically.
 */
async function playwright(): Promise<typeof import("playwright-core")> {
  process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= BROWSERS_PATH;
  return import("playwright-core");
}

/**
 * Whether `npm run shots:install` has been run.
 *
 * `[D]` A filesystem check rather than `chromium.executablePath()`, so it stays
 * synchronous — the test suite decides at import time whether to skip — and so
 * that asking the question cannot itself import the library at the wrong
 * moment and pin the wrong directory.
 */
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
 * `[F]` **A fresh, temporary profile every launch, deleted on close.** No
 * profile is ever shared with anything, so there is nothing to leak *from*
 * even in principle — which is the answer to "could this reach an account".
 *
 * `[F]` It is a *persistent* context for exactly that reason: an ordinary
 * `launch()` makes a profile of its own somewhere in the temp directory, and a
 * directory the harness does not name is a directory it cannot promise to have
 * deleted. Naming it is what makes §5 case 2 a check rather than a hope.
 */
export async function launch(): Promise<Harness> {
  const { chromium } = await playwright();
  const profileDir = mkdtempSync(join(tmpdir(), "orderly-shots-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    args: [...LAUNCH_ARGS],
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // The trail is anti-aliased; a device that reported "reduce" would be a
    // second reason for a golden to shift, and one is enough (§4).
    reducedMotion: "no-preference",
  });

  const aborts: string[] = [];
  const requests: string[] = [];
  // `[D]` The second confinement, and the one that reports. The flags fail a
  // request closed; this refuses it *and says so*, which is what turns "no
  // bytes left the host" from a belief into a line of output.
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
