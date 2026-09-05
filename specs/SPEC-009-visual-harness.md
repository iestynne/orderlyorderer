# SPEC: Visual Harness

Status: **draft 1**, 2026-09-04. Not started.
Depends on: SPEC-007 (the scrubber, `Screen`, `capture()`), SPEC-008 (fixtures
under `data/saves/tests/`).
Load with this spec: `CLAUDE.md` Hard rules, `DECISIONS.md` D24a, D30, D45.

The agent gets to **see the app** inside its own implementation loop — a PNG
per scenario, on disk, readable with no browser and no human in the way — and a
pixel diff catches what an eye tolerates until the sixth round of looking.

`[I]` iestyn: eyeballing does not stop; he will keep finding what the agent
misses. What changes is how much reaches him.

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

`[F]` **Why interaction is in scope from the start.** Of round six's thirteen
corrections (`TODO.md` §A7), four were interaction faults — a hover offset, a
click landing on the wrong row, a mark that did not say it was clickable, a
clipped badge — and none is visible in a static frame.

---

## 1. Scope and module layout

**Out of scope**

| Not here | Why |
|---|---|
| Any browser iestyn uses | `[I]` Too risky: no path from the harness to an account. §2 |
| Judging appearance in the harness | D24a: iestyn judges. The harness shows and diffs. |
| Perf measurement | SPEC-007 §7's harness, still `[O]` |
| Production builds | `capture` and the fixture loader exist under `import.meta.env.DEV` only |

```
tools/shots/browser.ts     launch: the project's own Chromium, confined to localhost
tools/shots/scenarios.ts   the list: fixture, stop, pointer steps, crop
tools/shots/run.ts         drive every scenario; write build/shots/<name>.png
tools/shots/crop.ts        magnify a region of a PNG, for one-pixel claims
src/ui/dev.ts              ?fixture=&record=&stop=, and window.__orderly (DEV only)
test/ui/shots.test.ts      the Verification Contract
test/ui/golden/*.png       committed references, one per scenario
.browsers/                 the Chromium install. gitignored. iestyn installs it.
```

## 2. The browser

`[D]` **A browser the project owns and iestyn never opens.** Playwright's
bundled Chromium, installed by `npx playwright install chromium` with
`PLAYWRIGHT_BROWSERS_PATH=.browsers` — a project-local, gitignored directory.
`[I]` **Only iestyn runs the install:** it reaches the network. Nothing in
`package.json`'s ordinary scripts does. `[F]` No profile is ever shared with
anything: every launch gets a fresh, temporary user-data directory, deleted on
close, so there is nothing to leak *from* even in principle.

`[D]` **Confined to localhost, four ways, none load-bearing alone.**

1. **Browser flags**, set in `browser.ts` and asserted by test: a dead proxy for
   everything, bypassed for loopback only —
   `--proxy-server=127.0.0.1:9 --proxy-bypass-list=localhost;127.0.0.1;[::1]` —
   plus `--no-first-run --disable-background-networking
   --disable-component-update --disable-sync --disable-extensions
   --disable-default-apps`.
2. **The driver**: `context.route("**/*")` continues loopback and **aborts** the
   rest, logging every abort. A scenario that logs one fails.
3. **iestyn's own configuration**, outside the repo: `[I]` a Windows Firewall
   outbound block on `.browsers/**/chrome.exe`. The spec asks for it and cannot
   verify it; §5 case 3 verifies 1 and 2.
4. `CLAUDE.md`: the agent never edits the flags in `browser.ts`, and a test
   pins them, so an edit is a red test rather than a quiet one.

`[P]` **Option B, kept open:** `@napi-rs/canvas` rasterising the render
functions in Node with no browser at all. `drawTimeline`, `drawRightPanel`,
`drawActionList` and `drawTrail` already take a bare `ctx` and run headless
against a stub (`test/ui/draw.test.ts`). Faster, one dependency, no network
question — but it exercises no input path, and the input path is where the
faults were. `[O]` Worth measuring whether its `multiply`/`destination-in`
match Chromium's before trusting it for goldens.

## 3. The app's side

`[D]` **Dev-only, and real.** `src/ui/dev.ts` is imported under
`import.meta.env.DEV` and does two things:

- **Reads the URL.** `?fixture=<stem>` fetches `/data/saves/tests/<stem>.sav`
  from the dev server (the repository root is Vite's root, so the file is
  already served), opens it, picks `record=<n>` (default 0) and seeks to
  `stop=<n>` (default 0). Everything after that is the ordinary app.
- **Exposes `window.__orderly`**: `{ capture(): string, stop(): number,
  layout(): Layout }`. `capture` is SPEC-007 §7's existing 1× PNG. `[D]` Nothing
  else: pointer input goes through the real listeners, driven by Playwright's
  mouse, so a scenario tests the same path a hand does.

`[F]` The harness knows where to point because the geometry is pure and
importable: `actionsGeometry`, `rowTop`, `stopToY`, `cogHitbox`,
`tileOrigin` (SPEC-007 §5, SPEC-008 §8). A scenario says "hover row +2" and
`run.ts` computes the pixel from `layout()` and the same functions the app used
to draw it.

## 4. Scenarios, shots and goldens

A scenario is data, not code:

```ts
{ name: "deficit-gold", fixture: "1-5.INSUFFICIENT-POWER", record: 0, stop: 41,
  steps: [{ hover: { row: 0 } }],            // or { click: "exclaim" }, { drag: { rows: 3 } }, { hover: { cell: {x, y} } }
  crop?: { x, y, w, h } }
```

`run.ts` launches once, and per scenario: navigate, wait for `__orderly`, play
the steps through `page.mouse`, read `capture()`, write
`build/shots/<name>.png` — the app's own 1× frame, not a window screenshot, so
every pixel is a logical pixel. `[D]` The window is sized so the layout lands
at **scale 1** (`layoutFor`, SPEC-007 §5): a shot is the logical canvas exactly.

`[D]` **Goldens are exact.** `test/ui/golden/<name>.png` is committed; the test
runs the scenario and asserts **0 differing pixels**, writing
`build/shots/<name>.diff.png` on failure. Anti-aliased content (the trail) may
shift across Chromium versions, so the version is pinned in `package.json` and a
bump re-baselines on purpose, in its own commit, with the diffs looked at.
`[D]` Re-baselining is a command (`npm run shots -- --update`) that a task
runs only when the change to the picture was the point of the task.

`[D]` **For a one-pixel claim, crop.** `Read` shows a 1920-wide frame small;
`tools/shots/crop.ts <png> <x> <y> <w> <h> --scale 8` writes a magnified
region. The agent's report of "the divider is one pixel lower" cites a crop or
a diff, never a glance at the whole frame.

## 5. Verification Contract

```
Run: npm test && npm run typecheck   (shots.test.ts skips when .browsers/ is absent, and says so)
Report: PASS/FAIL per named case; per scenario the differing-pixel count;
        the abort log; any file touched outside tools/shots/, src/ui/dev.ts,
        test/ui/shots.test.ts, test/ui/golden/
```

| Case | Expected |
|---|---|
| 1. Launch args contain the proxy, the bypass list, and all six disable flags | **yes**, asserted on the literal array |
| 2. Profile directory after `close()` | **absent** |
| 3. `fetch("http://example.invalid/")` and `fetch("http://1.1.1.1/")` from the page | **both rejected**; abort log has **2** entries; no bytes left the host (Playwright's request log) |
| 4. `fetch("/data/saves/tests/1-5.INSUFFICIENT-POWER.sav")` | **200**, abort log unchanged |
| 5. `?fixture=1-5.INSUFFICIENT-POWER&stop=0` → `__orderly.stop()` | **0**; `layout().scale` **1** |
| 6. `capture()` PNG dimensions | `layout().w × layout().h` exactly |
| 7. Scenarios in `scenarios.ts` | **≥ 8**: clean current action, added action (blue), the break (red), past the break (grey), hover row, hover exclaim, hover cell with preview, help open |
| 8. Golden diff, every scenario | **0** differing pixels |
| 9. Diagnostic (D18): revert the `SHORTFALL` colour and run case 8 | the deficit scenario **fails**, and only it |
| 10. `npm run build` (production) | `__orderly` **undefined** in the built app; `?fixture=` does nothing |

**Invariants**

1. **Nothing leaves the host.** Every request Playwright records has a loopback
   host. Checked on every scenario run, not only in case 3.
2. **The shot is the frame.** `capture()` equals a Playwright screenshot of the
   canvas element at scale 1, pixel for pixel. `[D]` The diagnostic for §2's
   fidelity assumption: if the app's own buffer and what the browser shows ever
   differ, every golden is suspect.
3. **A scenario is replayable.** Two runs of the same scenario in one browser
   session produce identical PNGs. Anything else is a timing dependency, and
   the fix is a wait in `run.ts`, not a tolerance in the diff.
