# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**SPEC-007, SPEC-008 and SPEC-009 are built** — 351 tests green (`STATUS.md`). The
scrubber has had four rounds of visual review and its performance faults are
fixed and confirmed by eye (§A5). The **editing UI has now had six rounds**,
and everything all six found is fixed in code. **None of round six is
confirmed by eye.** The top of this list needs a browser, and so needs iestyn:

1. **Look at §A7 again — round seven.** All thirteen are fixed and none is
   confirmed. D24a is the editing UI's only judge and it has not passed yet.
   `docs/UI.md` §7.
1a. **The D45 refactor.** The framing is decided (D45, CLAUDE.md §3a); the
   pass that applies it is not done: minimise code length, maximise
   conceptual locality so a doc's few references land, and bring every doc
   down to a minimal, consistent, reference-centric summary — visual
   description excepted. Use Fable. The evidence it answers is §A8.
1b. **A failure corpus — mostly done, inside SPEC-009.** `scenarios.ts`'s
   `FAILURES` holds one shot per error code the UI can be asked to draw:
   eight, each a single disable on a clean corpus route, found by sweeping
   every clean record of all 14 towers. Six of the remaining seven codes
   **cannot** be a break at all (SPEC-009 §4). No separate `.ord` was needed —
   a scenario names the record and the disable, which is the same information
   and is executable. What is left is `SPIKE_TOO_STRONG`: not reachable by any
   single disable in the corpus, and probably a no-entry case like the two
   other aimed-at-the-obstacle codes, but not yet proved either way.
1c. **The visual harness** — SPEC-009. **Done and merged**, 2026-09-06: 19
   goldens blessed, contract green. Its open items are §A9.
2. **Floor entry thresholds — the *number*.** Skippable segments are the
   predicate; what is left is a search over it.
3. **The two open pieces of editing UX** — §A6.
3f. **Publish, and get it to makiki** — worktree topic name `pages-deploy`.
   See §A11 for the whole task.
3ga. `[F]` **Done, 2026-09-15: both frozen specs carry an amendment note.**
   SPEC-002 and SPEC-007 named `data/towers/v0.7-455/`, which is not where the
   tower JSON lives any more (`build/towers/`, `npm run parse-towers`). Each now
   opens with a dated note redirecting every such reference, and **neither body
   was edited** — they are frozen, tests exist against them, and no behaviour
   changed, only where the output lands. `[F]` Nothing was ever broken by it:
   `tools/paths.ts` is the single definition and the tests all read it.
3g. `[D]` **Export gets its own spec, `SPEC-013-export.md`.** iestyn,
   2026-09-10: a separate topic, and non-trivial now, so SPEC-008 §7 shrinks to
   a reference. **13, not 11 or 12** — another task holds those. `[O]` Not
   written, and SPEC-008 §7 still says "every write is a fresh, uniquely named
   file", which the code no longer does. Specs are frozen once tests exist, so
   it waits for the new spec rather than being edited. The live docs
   (DESIGN §2.4, `UI.md`, `SAVE_FORMAT.md` §8) are already correct.
3h. `[F]` **Done, 2026-09-15: tower JSON is built, not committed.**
   `npm run parse-towers` writes `build/towers/`, which is gitignored, and
   `tools/paths.ts` is the one place the location is named. The **parser stays
   in the repository**, so anyone who owns the game can build their own copy —
   `[I]` iestyn wants that possible, and streamlining it is a much-later
   consideration if ever. `[O]` It is still in the *pushed* history; only a new
   push removes it from the tip.
3i. `[D]` **A misbehaving `.sav` reaches iestyn through a paste service, not
   as a file.** 2026-09-11: pastebin is convenient and safe, and **raw bytes
   are essential** — a novel failure is the one a summary would not describe.
   `[I]` A file that runs is what social engineering needs; a paste cannot be
   double-clicked. `[O]` Not built: the app would emit the bytes as pasteable
   text, with a diagnostic (record names, entry counts, payload hashes, the
   parse error) above them so common cases read without decoding anything.
3j. `[O]` **A gem count that did not update, seen once and not reproduced.**
   `[I]` iestyn, 2026-09-11, on 2-1 `"C 70.27M win"`: disabled actions 620-630,
   moved the current action to the end, and the **player status** still showed
   the old total. The same steps were correct on a retest. `[F]` **The model is
   not at fault** — headless, `gemsRequired` and the player at the final stop
   both go 230 to 225, changing from stop 619, exactly where those gates are.
   So it is the scrubber's re-derive or repaint, or it did not happen.
   `[O]` Possibly path-dependent. **Do not close this by failing to reproduce
   it once.**
3k. `[O]` **The export protocol's own weak point.** Nothing stops a player
   exporting against a snapshot taken before they last played; the
   newest-snapshot flag is a hint, not a guard. `[D]` Deliberate — the app
   cannot see the game's save folder, so any check would prove less than it
   implied. `[I]` iestyn: he will use it himself first, because anticipating
   how others will want it is a fool's errand short of asking them.
4. **Look for restated rules elsewhere** — D33 forbids the pattern, and
   SPEC-002/005/006 have not been checked.
5. **Fix the perf harness, then read the baseline** — SPEC-007 §7, oracle 2,
   still `[O]`. Deferred with the rest of the perf work (§A5): it decides
   Canvas 2D versus WebGL, that decision is not being made yet, and the harness
   would answer it wrongly today.

`[D]` Still open by eye, not blocking: the rest of `docs/UI.md` §7 — the
trail's `dHue`, the stack's size, whether overlapped floors read on a 32- or
75-floor tower, and the deferred proposal to freeze past and future floors.

`[O]` **Let the simulation go negative.** `[I]` iestyn: past a failure the
route's positions are known but its *resources* are not, so a deficit can be
read at the break and nowhere later. Allowing negative gold, power and keys
would give a margin at every step — the power-graph work (DESIGN §7) arriving
early. `[D]` Not started: it changes SPEC-004's semantics, and Half Gates,
elixirs and the Keysmasher each need an answer first.

`[O]` **Show the grade beside the score.** `[I]` iestyn, low priority: the
header carries the score a winning route submits, and the grade it earns would
sit naturally next to it.

`[O]` **A colour-blind-safe variant.** Red against green is the one pair that
fails for about 8% of men, and it is what says pass and fail. The colours are
gathered in `src/ui/render/palette.ts` so a variant is a swap — blue against
orange reads apart under both deuteranopia and protanopia — but the swap is
half of it: what makes the scheme survive any palette is that the failure marks
are not colour alone. That file's header says which still are.

`[O]` **Check the panel on a low-resolution or phone-shaped screen.** The left
panel fills with as many floors as the window and zoom allow, in reading order;
nobody has looked at what that does when there is very little room.

`[O]` **The toolbar wants emptying.** `[I]` iestyn: it is a strip along the
bottom because of what is in it, and it stops at the left panel now so it no
longer eats the slider's height — but move its contents somewhere better and it
need not be a strip at all.

`[D]` **`UI.md` stays over D31's 150 on purpose — 258 now, not 185.** The
export screen added to it, so the split is overdue rather than pending. iestyn, 2026-09-04:
§6 will split when **`SPEC-011`** is built — the segment-editing spec, written
2026-09-09 and not yet implemented; that code stays
but is not under test now and will be iterated heavily in its own task — and
an over-long doc is the reminder that the split is owed. `STATUS.md` and this
file are over too, with §A7 and §A8 living here until the branch merges.

`[D]` **No browser, no network** (CLAUDE.md). Screenshots come from the app's
own capture control: press `S` or the button, share the PNG.

## A12. `spec-gold-analysis` — this branch's own

`[D]` Delete this section when the branch merges. Nothing here is built: the
branch is two spec documents, one canonical doc, D47, and a six-line change to
`vite.config.ts`.

1. **SPEC-011 and SPEC-012 have had no eye but iestyn's in chat.** SPEC-011 is
   draft 1 and deliberately partial — §3 is a stub. SPEC-012 is **draft 2**, a
   rewrite: draft 1 was written in linear-programming vocabulary and could not
   be read, and two of its recommendations were wrong. `[F]` Getting its central
   idea across took most of a session, which is the evidence for its §8.1 — the
   bar chart exists because the number could not be explained.
2. `[D]` **SPEC-011 oracle 1 stays unspecified until SPEC-011 is built.** Its
   expected values come from a hand-authored 2-1 document, and iestyn cannot
   author one until the editing surface exists. Named, not specified, and
   correctly so — inventing the numbers would be inventing the route.
3. `[O]` **The solver was prototyped, not built, and §9 is not a fixture.** A
   dense simplex written in a session scratchpad produced SPEC-012 §9's worked
   example, and earned its keep: it found the missing epoch exclusivity (§5.2)
   and the missing epoch dual (§5.1), both now decisions. But that scratchpad is
   gone and **nothing in the tree computes those numbers.**

   `[D]` So **treat §9 as a worked example to reproduce, not expected values to
   match.** Build the solver, run it on those inputs, and if it disagrees, the
   **spec is the suspect first**, not the code. The distinction matters because
   every other named case in §11 is the opposite — the tower census figures come
   from committed tooling and are re-derivable with `npm run parse-towers`, so
   those *are* fixtures. `[F]` §7's `375 – 1500` interval has the same
   provenance as §9 and the same status.

   `[D]` The prototype was deliberately not kept: it is ~80 lines that §11 says
   belong in `src/analysis/`, and carrying it would mean writing it twice.
4. `[F]` **SPEC-012's named cases were measured before tower JSON moved.** They
   came from the then-committed `data/towers/v0.7-455/2-1.json`; the same
   figures now need `npm run parse-towers` first (`tools/paths.ts`). The values
   are unaffected — the parser is byte-exact — but a session that finds no file
   should build one rather than doubt the numbers.
5. `[O]` **`local/serve-main.cmd` is untested.** Written, never run — `../git/`
   was clean and on `main`, so neither refusal path has fired. It lives outside
   the repository, so it survived this branch's rebase and is not in the diff.
6. `[O]` **SPEC-012 §8.1's multi-resource split is decided but untried** —
   proportional to quantity x resource value, with bars hatched where another
   resource blocks them. `[I]` iestyn will judge whether the hatching is needed
   or is noise when he uses it.

## A11. `pages-deploy` — publish the app so makiki can open a URL

`[I]` iestyn, 2026-09-15: he wants makiki looking at the MVP **now**, before
the spec-gold-analysis branch lands, because the UI is easier to judge in this
state. So this is time-sensitive in a way the rest of the list is not.

`[F]` **Permitted.** makiki, 2026-09-11, prefers assets compiled into the
bundle over published as files (D14b-1), and his notice wording is already in
the app verbatim. Nothing here needs asking again.

`[F]` **The repo exists and is pushed**: `git@github.com:iestynne/orderlyorderer.git`,
`origin/main` well behind local `main` as of 2026-09-15. `[O]` Whether it is
public was not verified — Pages on a private repo needs a paid plan.

### What Pages is

GitHub serves a static site from a repository, at
`https://<user>.github.io/<repo>/`. An Actions workflow builds on push and
publishes the output; there is no server, which suits an app that has none.
`[F]` The sub-path is why `vite.config.ts` takes `BASE_PATH` — a build
defaults to `/` and a project site needs `/<repo>/`, or every asset 404s.

### The task

1. Push `main`. It is safe as it stands: `build/` and `../local/` are
   gitignored, and derived artifacts are ours to publish (D14b).
2. A workflow that runs `npm ci`, `npm run build-atlas`, `npm run parse-towers`,
   `npm run build` with
   `BASE_PATH=/<repo>/`, and deploys `dist/`. `[O]` **`build-atlas` and `parse-towers` both need
   the game archive**, which is in `../local/` and will never be on a runner
   (D14b, D29). So either the build runs locally and only `dist/` is pushed,
   or the atlas is committed — which D14b forbids. **Resolve this first; it
   decides the shape of everything else.**
3. Check the deployed page actually loads: the atlas is inlined, so a wrong
   `BASE_PATH` shows as a black canvas rather than an error (SPEC-007 §6.1).
4. Send makiki the URL, and ask the one open question: his answer named *map
   data* as something to bundle — done for the tower JSON (§A.3h), so the
   question is now only whether the committed save corpus is also fine by him.

### Two things to decide while there

- `[F]` **Both settled, 2026-09-15.** The tower JSON is built rather than
  committed (§A.3h, done); the save corpus stays committed on purpose, because
  it is useful example data, and `helpers.ts` no longer claims otherwise.

## A7. The editing UI, by eye — thirteen fixed, none confirmed

`[I]` iestyn, six rounds of looking at it. Merged to `main` 2026-09-04 with
none of the thirteen confirmed by eye — iestyn: keep main moving. **Delete each
item when round seven passes it, and the section when the last one goes.**

`[F]` **All thirteen are fixed in code and are what round seven has to check.**
Kept as a list rather than folded into the log because each is a separate thing
to look at, and because a fix that misses by a pixel is invisible to a test:
five of the thirteen have diagnostic tests under `test/ui/` (checked by
reverting each and watching it fail), and the other eight can only be judged by
looking. Delete an item when it has passed, not when it has been written.

`[D]` Two were not the fault they looked like, and both are worth knowing:
**13** was the hover holding an offset measured against a pin that a click had
since moved — a cached derived value, not a hit-test error, so the fix was to
stop caching it. **2** was reading the action's recorded `from`, which is where
the *previous* action ended; the journal already held the right square in the
action's own step. Both are in `DECISIONS.md` terms the same mistake: asking a
stored answer a question it was not the answer to.

1. **The `+` badge is transparent inside.** It should be opaque black, so the
   lavender outline underneath does not show through the glyph. It overlaps the
   slider and must draw **on top** of it, which means outside the list's clip.
2. **An inserted action draws the player in the wrong square.** The outline in
   the left panel is drawn around the recorded `from`, which is where the player
   stood after the *previous* action; it belongs where the auto-pather puts them
   immediately before this one, adjacent to the target tile.
3. **Two rectangles where there should be one.** `drawTarget` still strokes its
   own accent rect around the target cell, inside the box that already covers
   both squares — it reads as a divider down the middle of the outer box.
4. **A failed action's deficit numbers are not red.** They have a red rectangle
   behind them, which is not the same thing: the digits' own white pixels want
   tinting, the black and transparent ones left alone. Bake a red-inked copy of
   the font and draw from that.
5. **The failure outlines cover the badges.** The thin lines around the failed
   action and the failed span draw over enemy value badges and deficit badges.
   Badges go last, in a pass of their own.
6. **The help `?` box is clipped** by the left edge of the right panel.
7. **The help panel's text spills off its right side.**
8. **The slider's failure mark should be the exclamation sprite**, not the drawn
   no-entry sign — `markers.png`, 8 columns by 4 rows of equal squares, column
   5 of row 4.
9. **The action counters are drawn twice**, one copy offset vertically from the
   other — current/total in the action list header.
10. **The divider under the player status wants one more pixel down.**
11. **The tower stack is still truncated on its left**, overlapped by the action
    list by a couple of pixels.
12. **Contrast-reduce the non-current floors in the stack.** e.g. blend 50% grey
    over them at 50%: (a) raises the contrast of the black outline, (b) drops
    visual noise, (c) separates floor contents from the dark panel background.
13. **Clicking in the action list selects the wrong row.** Hover brightens the
    right one; the click lands offset by the delta between the newly clicked
    action and the previously clicked one.

## A8. Two doc/code disagreements, found 2026-09-04

`[F]` Both caught by hand while compressing `UI.md`; neither by any test, and
nothing would have. This is the evidence for §A.1a.

- **`UI.md` §4 described a status *column* down the panel's right edge.** The
  column was deleted when Power moved to its own line (`screen.ts`, `PANEL_W`),
  and the items are drawn on one line under it. Fixed in the same compression.
- **Three docs and two comments still said `ScrollUnit`** — `CLAUDE.md`, D34's
  table, SPEC-008 §, `trail.ts` — after the code and its own test had renamed
  it `WorkingSet`. Fixed 2026-09-04; iestyn ratified the name, and the §7
  question about a unit narrower than the screen went with it: nothing
  scrolls, and current behaviour speaks for itself.

## A5. The two scrubber performance faults — fixed 2026-09-01

`[F]` Both faults are fixed: **four causes**, three behind the scrubbing one
and one behind the load; the **second** row was not among the hypotheses.
Rationale in `DECISIONS.md` D38-D41, each with a diagnostic test under
`test/ui/` checked by reverting the fix and watching it fail.

| Fault | Was | Now |
|---|---|---|
| `willReadFrequently` never took effect, so every miniature rebuild read back from an accelerated canvas and Chrome demoted it for good | slower, then a cliff, never recovering | asked for at creation, on the floors and on the atlas they are painted from (D38) |
| The stack's shear ran one `drawImage` per source row | 2 048 draw calls per scrub update on 2-5, 4 800 on 2-6 | baked into the cached miniature: one blit per floor (D39) |
| `keydown` and `resize` were left on `window` at unmount | one dead scrubber still seeking per mount ever made; two from StrictMode alone | one `AbortController`, aborted by `destroy()` (D40) |
| Opening a `.sav` simulated all 41 records before drawing the list | ~3 s of blank window | the list first, the columns behind it (D41) |

`[F]` **Confirmed by eye, 2026-09-02.** iestyn: the cliff is gone and load time
is fixed. `[I]` **Long-range slider drags are still slower than he would like**
— a full-length seek invalidates many floors, so one update rebuilds many
miniatures. `[D]` **Deferred, and the reason is why deferring is safe:**
short-range scrubbing is the common path and is fine. Features outrank it.

`[F]` A fifth, in the same family, landed with SPEC-008: `pathfind` allocated
three tower-sized arrays per waypoint and copied the `Player` per neighbour,
which halved re-evaluation time. Measured — SPEC-008 oracle 4.

`[P]` If it is picked up: the cost is proportional to floors touched, not to
distance, so the lever is refiltering only the rows an edit changed. The rest
of load time is `paintAll` and 32 miniature builds, both one-off.

`[P]` **The harness is not trustworthy; record no baseline from it** (SPEC-007
§7, §8 oracle 2). `pass` compares rAF deltas to the 5 ms budget, which nothing
under ~200 Hz can meet: a rAF delta is floored by the refresh period, while
§7's own "roughly 3x" is about CPU work inside a frame. And `record()` writes
both tracks every call while being called twice per update with one side
zeroed, so `seek` and `blit` are half zeros. Fix: budget `seek + blit`, report
`frame` rather than judge on it, add long-task and Event Timing tracks — zero
long tasks in a minute of scrubbing is a real expected value for oracle 2.

## A3. Map exports — captured; one nice-to-have left

Done 2026-08-29: all fourteen towers with saves captured, 16 exports for 14
towers, oracle covering **62 040 cells over 292 floors**. Regenerate the
longest-save table with
`npx tsx tools/sav/longest-per-tower.ts data/saves/iestyn.2026.08.28`.

`[P]` Uncaptured: a **`before` export**, taken immediately after restarting a
tower, enabling SPEC-005's two-image diff (§5) alongside the single-image check.
The single-image check is the stronger of the two and needs no baseline, so this
is a nice-to-have. Towers 2-6 and 3-1 have no saves (B3), so nothing to export.

## A6. SPEC-008 route editing — two open pieces of UX

`[D]` SPEC-008 is implemented; these are the two questions it deliberately
leaves to design rather than answers. Neither blocks the editor as it stands.

- **Importing a route from a `.sav` into an existing `.ord`.** What makes one
  `.ord` usable for all of a player's work. Includes reconciliation: the `.ord`
  stores the payload hash of the record it came from, so a match is clean and a
  mismatch means the player has played on and the metadata must be re-anchored
  by prefix alignment.
- **`[O]` Think the `.sav`/`.ord` pairing through once more, before anything
  leans on `.ord` files.** `[I]` iestyn, 2026-09-09. Now that export injects
  into the player's real save (`SAVE_FORMAT.md` §8), the two formats meet in a
  way D35 did not anticipate. The idea to weigh: **store a copy of the original
  `.sav` inside the `.ord`**, so a route can be compared against other `.sav`
  files and restored in a pinch. `[D]` **Not decided, and there is a known
  hazard**: two `.ord` files made on different days from different generations
  of the same master `.sav` would each carry a stale copy, so exporting "all
  routes" from either would publish out-of-date versions of every route but the
  edited one. That hazard is what moved export to injection instead. Whether an
  embedded copy still earns its place for *comparison and rescue* — never as a
  source to write back from — is the open question.

- **Autosave behaviour for the working store.** It writes on every edit today,
  which is what DESIGN §2.2 asks for and may be more than is wanted on a long
  route. Also unanswered: whether to request `navigator.storage.persist()`.

## A9. SPEC-009 — open items

Merged 2026-09-06 with all 19 goldens blessed. The workflow: `npm run shots`
to check, `npm run bless` to walk what moved. A fresh session needs `.browsers/`
(gitignored) — `npm run shots:install`, iestyn only.

`[F]` **The binary is `chrome-headless-shell.exe`**, not `chrome.exe` —
`headless: true` launches the shell. Any firewall rule naming `chrome.exe`
alone blocks nothing that this harness runs.

1. `[O]` **Two settings on trial**, both in the help panel. **Show paths**
   (on by default: iestyn liked it) draws every action's walk, not only a
   failing one's. **Trail behind** (off) draws the route trail under the floors
   at one strength instead of fading. Decide on each; make it the only
   behaviour or take the switch out.
2. `[O]` **Two things no golden exercises.** The battle-gate countdown
   (`drawGateCounts`) — confirmed by eye on 2-5, steps 1587-1652, but no
   scenario shows a floor with a gate. And the `"N gems"` name rule
   (`RouteSession.displayName`, D46): it fires only when this app changed the
   route's gem cost, which is provisional until the export workflow has been
   used in earnest.
3. **Grey over blue is not covered.** `accentOf` treats `inserted` and the
   break state as independent, so there are three added-action pictures: blue
   (`added-action`), red (`added-then-broken`), and grey — an added action
   *past* a break, which no scenario reaches. It needs an insertion plus a
   disable that breaks the route **before** the inserted action; the search
   that found red-over-blue can be pointed at it.
4. `[O]` **`SPIKE_TOO_STRONG` is unproved.** No single disable in the corpus
   produces it. Probably a no-entry case like `BLOCKED_IRON` and
   `BLOCKED_ONE_WAY` (SPEC-009 §4), but that has not been shown.
5. `[O]` **§2's third confinement is still trust.** A Windows Firewall rule
   takes one absolute program path — no wildcards, no folder trees — so there
   is nothing to set once, and a Playwright version bump makes a new
   `.browsers/chromium-NNNN/` that any existing rule silently misses. The fix
   is to make it unforgettable rather than global: have `shots:install` create
   the block rules for what it just downloaded, and have `browser.ts` refuse
   to launch unless a Block rule covers the executable it is about to run.
   Reading rules needs no elevation, so the check works from any shell; only
   creating them does. Not built.
6. `[O]` **Option B is still open** — SPEC-009 §2's `@napi-rs/canvas`, no
   browser at all. Worth measuring only if the browser route proves painful;
   it exercises no input path, and the input path is where the faults were.

## B. Loose ends from the oracle work

| # | What | Why it matters |
|---|---|---|
| B1 | **Save *writing* from TypeScript is not byte-exact.** Node's zlib reproduces only 82 of 326 of the game's compressed streams at any level; the payload underneath is exact in all 326. | Blocks nothing today — reading is unaffected and writing stays on the Python codec. But byte-comparison against a hand-played save is how D17 and the pop-up encoding were settled, so it must be restored before we write saves from TS. SPEC-006 §6. |
| B2 | **The `crown` file is needed after all.** | Corrected 2026-08-28: `royal_boon1` *is* obtainable — `level_scripts.lua` injects it into 1-6 floor 25 directly beneath that tower's Dark Crown, and iestyn's 1-6 hi-score run ends on that exact cell, so he has it. With the boon set, `gemsOwned` = grade gems **+ the sum of per-tower crown tiers**, which only the `crown` file supplies. It also independently confirms which hi-scores were doubled. |
| B4 | **The `unlocks` file: not needed.** | It holds the boon flags, the seen-floor set (for map-view filtering) and the compendium flags. The only part that affects simulation is `royal_boon1` / `royal_boon2`, and both are derivable from the `crown` file: you can only have collected a boon by reaching the crown it sits under. The rest is presentation state. |
| B5 | ~~Beating 2-6 will invalidate the corpus.~~ **Answered: it will not.** | Simulated both ways with `royal_boon2` hypothetically unlocked: **326/326 still replay clean.** And the reason is structural rather than lucky — across the 11 towers with Rapier scripts, **no route ever enters any of the 59 cells a script edits**. The vaults are sealed regions holding nothing until the boon opens them, so no route ever had a reason to go there. Asserted by `test/sim/levelScripts.test.ts`. Go and beat 2-6. |
| B3 | **Tower 2-6 and 3-1 have no saves.** 2-6 is 75 floors and unplayed; 3-1 is the only tower with orbs, which SPEC-004 §1 does not model. | The sweep covers 14 of 16 towers. 3-1 needs the orb work before a save would help; 2-6 needs only play. |

## C. Experiments — all four run and passed

C1-C4 were played on 2026-08-28 and all four confirmed the simulator. Numbers
and the C4 finding — including the method it taught — are in `RESULTS.md`; the
saves are in `data/saves/tests/`, asserted by `test/sim/experiments.test.ts`.

Six further questions that once lived here are **answered by the source**, and
their answers are in `GAME_MECHANICS.md` where game rules live (D33).

## D. Ask the developer

- `[F]` **The "unofficial" notice is agreed**, 2026-09-11, in his own words —
  D14b-1 holds it verbatim and `src/ui/App.tsx` uses it unaltered.
- `[F]` **Bundling map data and sprites into the app is his preference**, and
  keeping them out of the public repo is the point of it (D14b-1, §A10.7). So
  the sprite-repo question is answered: assets stay out, the bundle carries
  them, and the built app may be deployed.
- `[O]` **Tower JSON is not explicitly covered.** His answer names "map data"
  as something to compile into the bundle, which the tower JSON now is
  (§A.3h). `[O]` What is left to ask is narrower: the **save corpus** is
  committed on purpose as example data, and that is iestyn's own files rather
  than makiki's, so it is a courtesy question rather than a permission one.
- Minor: `entitydef.orb_change.compendium_header` reads "Warp orb", duplicating
  `orb_warp`. Looks like a copy-paste slip.

## E. Still unread in the source

Deliberately deferred, not forgotten. All are out of scope for v1 (SPEC-004 §1).

- **Orb effects** — `game.lua`. Also the meaning of the two extra values in an
  orb 5-tuple. Orbs occur in tower **3-1** only, 60 entities.
- **Rapier of the Rulers** — the combat formula is read
  (`GAME_MECHANICS.md` §5.3); what remains is how `royal_boon2` injects it.
- One unidentified sprite on 1-5 floor 1, at `(1,4)` and `(15,4)`.

## G. Two sim oracles the game already ships

Neither needs a dev build, a flag or a code change on the developer's side.

- **`logs/log1.txt`** — **specced: `SPEC-010-log-oracle.md`.** Not started. The
  game logs every floor transition and item event unconditionally, and loading a
  savestate replays the route through the real engine, so the trace comes out
  without a hand-played run. An *ordering* check, where SPEC-004's two oracles
  compare a final number. `[I]` Occasional sanity check, not a build step.

- **The in-run stats screen** (`i`) — `ingame_stats.lua` `STATS_ORDER`, 24
  counters: kills split positive/negative, per-item gains and losses, gold in
  and out, keys spent, power the Adamantine Shield saved *and* lost. The
  simulator tracks none of them. A mismatch there names a mechanic; a mismatch
  in final power only says "something". Unspecced, and manual either way — the
  counters are drawn and never written to a file, and SPEC-009's harness
  screenshots our app, not the game.

## F. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.
