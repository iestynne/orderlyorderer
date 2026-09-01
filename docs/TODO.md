# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**SPEC-007 slice 1 is built and has been through four rounds of visual review**
— 242 tests green (`STATUS.md`). It is an MVP by iestyn's own assessment. Next,
in order:

1. **Fix the two performance faults in §A5.** The scrubbing one degrades until
   the app is unusable, so it outranks anything cosmetic.
2. **Set the perf baseline** — SPEC-007 §7, oracle 2, still `[O]`. The harness
   is built and toggled from the settings block; nobody has read the number.
   It is what decides Canvas 2D versus WebGL, and §A5 should be fixed first or
   the baseline measures the leak.
3. **Look for restated rules elsewhere.** §A4 cleaned SPEC-004; D33 forbids the
   pattern, but SPEC-002/005/006 have not been checked.
4. **Floor entry thresholds**, the analysis `STATUS.md` names as the whole point
   of the tool. Nothing depends on further reverse-engineering.

`[D]` Still open by eye, not blocking: `docs/UI.md` §6 — the trail's `dHue`,
the stack's size, whether overlapped floors read on a 32- or 75-floor tower,
and the deferred proposal to freeze past and future floors.

`[D]` **No browser, no network** (CLAUDE.md). Screenshots come from the app's
own capture control: press `S` or the button, share the PNG.

## A5. Two scrubber performance faults, both observed 2026-09-01

`[I]` **Scrubbing back and forth gets progressively slower, then falls off a
cliff into hundreds of milliseconds per update, and never recovers.** Observed
by iestyn on the tower stack; a leak of some kind is the obvious shape.

`[P]` **A specific hypothesis, cheap to test.** `FloorCache.makeCanvas` creates
each floor's context with `getContext("2d")`, and `boxDownscale` then asks the
same canvas for `getContext("2d", { willReadFrequently: true })`. A canvas
returns its *existing* context and ignores the attributes, so that flag has
never taken effect — and Chrome said so twice in the console during the last
screenshot runs:

> Canvas2D: Multiple readback operations using getImageData are faster with
> the willReadFrequently attribute set to true.

Chrome demotes a GPU-backed canvas to software after repeated readbacks and does
not promote it back — which matches "slower and slower, then a cliff, never
recovers". Test first: pass the flag at creation in `makeCanvas`, or drop
`getImageData` and downscale with `drawImage` into a scratch canvas.

`[P]` Second candidate: `Scrubber.bindInput` adds `keydown` and `resize`
listeners to `window` and `stop_()` never removes them, so every remount leaks a
listener plus a retained `FloorCache`. StrictMode double-invokes effects, so
there are two already.

`[F]` **Loading is slow, and the cause is measured.** 2-5.sav takes ~3 s.
Opening a `.sav` simulates **every** record just to fill the list's power, floor
and stop columns: 41 records, **156 546 steps**, 1 144 ms in node alone. Fixes,
cheapest first: simulate lazily per row, cache by record, or show the list at
once and fill those columns in as they compute. `[P]` The rest is `paintAll`
(32 floors x 450 draws) and 32 `boxDownscale` calls, both one-off.

`[D]` Neither is a correctness fault nor blocks the MVP, so both are recorded
rather than fixed in the session that found them.

## A3. Map exports — captured; one nice-to-have left

Done 2026-08-29: all fourteen towers with saves captured, 16 exports for 14
towers, oracle covering **62 040 cells over 292 floors**. Regenerate the
longest-save table with
`npx tsx tools/sav/longest-per-tower.ts data/saves/iestyn.2026.08.28`.

`[P]` Uncaptured: a **`before` export**, taken immediately after restarting a
tower, enabling SPEC-005's two-image diff (§5) alongside the single-image check.
The single-image check is the stronger of the two and needs no baseline, so this
is a nice-to-have. Towers 2-6 and 3-1 have no saves (B3), so nothing to export.

## A4. ~~De-duplicate the game rules out of SPEC-004 §6~~ — done 2026-08-31

`SPEC-004` §6 restated ten rules from `GAME_MECHANICS.md` §2-§5 and now cites
them: **1082 → 880 lines**, no behaviour change. The one-way wall table moved to
`GAME_MECHANICS.md` §3; nothing was deleted without a home to go to. `[F]` The
rewrite also found the Adamantine Shield's signed-floor rule written out
**twice inside §6 itself** — D33's failure mode, twice in one section.

## B. Loose ends from the oracle work

| # | What | Why it matters |
|---|---|---|
| B1 | **Save *writing* from TypeScript is not byte-exact.** Node's zlib reproduces only 82 of 326 of the game's compressed streams at any level; the payload underneath is exact in all 326. | Blocks nothing today — reading is unaffected and writing stays on the Python codec. But byte-comparison against a hand-played save is how D17 and the pop-up encoding were settled, so it must be restored before we write saves from TS. SPEC-006 §6. |
| B2 | **The `crown` file is needed after all.** | Corrected 2026-08-28: `royal_boon1` *is* obtainable — `level_scripts.lua` injects it into 1-6 floor 25 directly beneath that tower's Dark Crown, and iestyn's 1-6 hi-score run ends on that exact cell, so he has it. With the boon set, `gemsOwned` = grade gems **+ the sum of per-tower crown tiers**, which only the `crown` file supplies. It also independently confirms which hi-scores were doubled. |
| B4 | **The `unlocks` file: not needed.** | It holds the boon flags, the seen-floor set (for map-view filtering) and the compendium flags. The only part that affects simulation is `royal_boon1` / `royal_boon2`, and both are derivable from the `crown` file: you can only have collected a boon by reaching the crown it sits under. The rest is presentation state. |
| B5 | ~~Beating 2-6 will invalidate the corpus.~~ **Answered: it will not.** | Simulated both ways with `royal_boon2` hypothetically unlocked: **326/326 still replay clean.** And the reason is structural rather than lucky — across the 11 towers with Rapier scripts, **no route ever enters any of the 59 cells a script edits**. The vaults are sealed regions holding nothing until the boon opens them, so no route ever had a reason to go there. Asserted by `test/sim/levelScripts.test.ts`. Go and beat 2-6. |
| B3 | **Tower 2-6 and 3-1 have no saves.** 2-6 is 75 floors and unplayed; 3-1 is the only tower with orbs, which SPEC-004 §1 does not model. | The sweep covers 14 of 16 towers. 3-1 needs the orb work before a save would help; 2-6 needs only play. |

## C. Experiments — all four run and passed

C1-C4 were played on 2026-08-28 and all four confirmed the simulator. Numbers in
`RESULTS.md`; saves in `data/saves/tests/`, asserted by
`test/sim/experiments.test.ts`.

The one that changed a belief: **C4**. The Hyper Pickaxe is *not* spent in
preference to an ordinary Pickaxe on a Weak Wall — the ordinary one goes first.
The corpus had already settled it before the test was played (flipping the rule
drops the sweep to 324/326), which is worth remembering as a method: **a large
corpus of real routes is itself a discriminating oracle.**

Six further questions that once lived here are **answered by the source**. Their
answers are in `GAME_MECHANICS.md`, where game rules live (D33), and are not
restated here: one-way traversal recording, Battle Gates opened at a distance,
Shield rounding, pather fallback, whether pickup is optional, Hyper Pickaxe
consumability.

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

## F. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.
