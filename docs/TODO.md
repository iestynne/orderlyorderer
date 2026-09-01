# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**SPEC-007 and SPEC-008 are both built** — 281 tests green (`STATUS.md`). The
scrubber has had four rounds of visual review; **the editing UI has had none.**
Next, in order:

1. **Look at the editing UI.** D24a is its only judge and it has not been used
   on it yet. Three of `docs/UI.md` §7's questions are new and resolve only by
   looking: whether the outline around edited actions reads well, whether live
   actions should carry one too, and whether an ignored click in add mode should
   still move the player icon.
2. **Set the perf baseline** — SPEC-007 §7, oracle 2, still `[O]`. The harness
   is built and toggled from the settings block; nobody has read the number.
   It is what decides Canvas 2D versus WebGL. §A5 is fixed, so a reading taken
   now measures the renderer rather than the leak.
3. **Floor entry thresholds — the *number*.** SPEC-008's skippable segments are
   the predicate, built and working; what is left is a search over it.
4. **The two open pieces of editing UX** — §A6.
5. **Look for restated rules elsewhere.** SPEC-004 §6 is clean and D33 forbids
   the pattern, but SPEC-002/005/006 have not been checked.

`[D]` Still open by eye, not blocking: the rest of `docs/UI.md` §7 — the
trail's `dHue`, the stack's size, whether overlapped floors read on a 32- or
75-floor tower, and the deferred proposal to freeze past and future floors.

`[D]` **No browser, no network** (CLAUDE.md). Screenshots come from the app's
own capture control: press `S` or the button, share the PNG.

## A5. Scrubber performance

`[F]` **Both faults found on 2026-09-01 are fixed.** Scrubbing degraded until
the app was unusable, and the cause was that a canvas has exactly one context:
`FloorCache.makeCanvas` created it without `willReadFrequently`, so
`boxDownscale` asking the same canvas for the flag was ignored and Chrome
demoted each floor to software after repeated `getImageData`, permanently.
Readbacks now go through one shared scratch canvas that carries the flag.
Second: `Scrubber.bindInput` leaked its `keydown` and `resize` listeners on
every remount — StrictMode double-invokes effects, so there were two from the
first mount — and `stop_()` now removes them.

`[O]` **The perf baseline is still unread** — SPEC-007 §7 oracle 2. The harness
is built and toggled from the settings block; nobody has looked at the number,
and it is what decides Canvas 2D versus WebGL.

`[F]` **Loading is slow, and the cause is measured.** 2-5.sav takes ~3 s.
Opening a `.sav` simulates **every** record just to fill the list's power, floor
and stop columns: 41 records, **156 546 steps**, 1 144 ms in node alone. Fixes,
cheapest first: simulate lazily per row, cache by record, or show the list at
once and fill those columns in as they compute. `[P]` The rest is `paintAll`
(32 floors x 450 draws) and 32 `boxDownscale` calls, both one-off.

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

## F. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.
