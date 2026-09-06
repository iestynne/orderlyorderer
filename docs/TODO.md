# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**SPEC-007 and SPEC-008 are both built** — 320 tests green (`STATUS.md`). The
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
1b. **A failure corpus.** `[I]` iestyn will list, per SPEC-004 §7 error code,
   an insertion or a disable on a corpus record that triggers it. From that
   list: one `.ord` holding every such route, as the regression corpus for
   failed-action behaviour — the deficit badges, the outlines, the grey tail.
1c. **The visual harness** — SPEC-009. Its own session.
2. **Floor entry thresholds — the *number*.** Skippable segments are the
   predicate; what is left is a search over it.
3. **The two open pieces of editing UX** — §A6.
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

`[D]` **`UI.md` stays over D31's 150 on purpose, at 185.** iestyn, 2026-09-04:
§6 will split when the **segment-editing spec** is written — that code stays
but is not under test now and will be iterated heavily in its own task — and
an over-long doc is the reminder that the split is owed. `STATUS.md` and this
file are over too, with §A7 and §A8 living here until the branch merges.

`[D]` **No browser, no network** (CLAUDE.md). Screenshots come from the app's
own capture control: press `S` or the button, share the PNG.

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
- **Autosave behaviour for the working store.** It writes on every edit today,
  which is what DESIGN §2.2 asks for and may be more than is wanted on a long
  route. Also unanswered: whether to request `navigator.storage.persist()`.

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

- **Agree the wording of the "unofficial" notice.** He asked for one and wants
  to research it; a draft is in `DECISIONS.md` D14b-1 to react to.
- **Confirm that publishing tower JSON is fine.** A text dump of every level,
  derived from `res/maps/*` — equivalent to what any player sees in game and
  carrying no secret, but it is his level design in machine-readable form, so
  worth asking as a courtesy. **This gates `data/towers/`, already committed**:
  the one item here with a live consequence.
- **Would a public repo containing the sprite files be acceptable**, or should
  assets stay outside it with the build pulling from them? The second is the
  safe default and is what we do regardless.
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

Neither needs a dev build, a flag or a code change on their side, and neither is
built. Recorded as a possibility, not queued: worth running occasionally, not
per-commit.

- **`logs/log1.txt`** — `logger.lua`, always on, no flag, rotated 10 deep at
  each *launch*, so one session appends to one file however many saves are
  loaded into it. It records every floor transition, every item obtained or
  consumed, every unlock flag set, and each level script that ran. Not
  move-by-move, so it cannot replace the replay oracle — but it is a free
  *ordering* check against what the simulator predicts.

  **And it does not need a hand-played run.** `save_manager:load` replays a
  savestate's move list through the real engine, and the `entitydef` interact
  logs fire during that replay — `g_sfx.lock` silences the audio, not the
  logger. So one keypress per save emits that whole run's pickup-and-floor
  trace, and `data/saves/` already holds 326 of them.

  **`[I]` Agreed shape, 2026-09-06: iestyn loads saves in the game by hand and
  the log gets scanned afterwards.** An occasional sanity check, not a build
  step — so what this needs is a log parser and a comparison against the
  simulator's predicted ordering, not a way to drive the game.

- **The in-run stats screen** (`i`) — `ingame_stats.lua` `STATS_ORDER`, 24
  counters: kills split positive/negative, per-item gains and losses, gold in
  and out, keys spent, power the Adamantine Shield saved *and* lost. The
  simulator tracks none of them. A mismatch there names a mechanic; a mismatch
  in final power only says "something". This half stays manual — the counters
  are drawn and never written to a file, and SPEC-009's harness screenshots our
  app, not the game.

## F. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.
