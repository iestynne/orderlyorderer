# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**SPEC-007 slice 1 is built and has been through four rounds of visual review**
— 255 tests green (`STATUS.md`). It is an MVP by iestyn's own assessment, and
both its recorded performance faults are fixed (§A5). Next, in order:

1. **Read the perf baseline** — SPEC-007 §7, oracle 2, still `[O]`. §A5 is
   fixed, so the number now measures the renderer rather than the leak. The
   harness is built and toggled from the settings block; nobody has read it.
   It is what decides Canvas 2D versus WebGL. **Needs iestyn**: open a record,
   tick `perf test`, report the `frame` median/max against the 5 ms budget.
2. **Confirm §A5 by eye and by hand** — scrub 2-5 back and forth for a minute
   and check it does not degrade, and that opening a `.sav` shows its list at
   once. Neither is testable headless; both are what was actually wrong.
3. **Look for restated rules elsewhere.** SPEC-004 §6 is clean and D33 forbids
   the pattern, but SPEC-002/005/006 have not been checked.
4. **Build SPEC-008, route editing** — §A6. Add and remove actions, skippable
   segments, parallel segments. Specified; nothing implemented.
5. ~~Floor entry thresholds~~ — **reframed, not dropped.** SPEC-008's skippable
   segments *are* a general-purpose threshold detector, so the analysis arrives
   as a consequence of the editing work. The remaining piece is the *number*,
   which is a search over that predicate rather than a separate computation.

`[D]` Still open by eye, not blocking: `docs/UI.md` §6 — the trail's `dHue`,
the stack's size, whether overlapped floors read on a 32- or 75-floor tower,
and the deferred proposal to freeze past and future floors.

`[D]` **No browser, no network** (CLAUDE.md). Screenshots come from the app's
own capture control: press `S` or the button, share the PNG.

## A5. The two scrubber performance faults — fixed 2026-09-01

`[F]` Both faults are fixed: **four causes**, three of them behind the
scrubbing one and one behind the load. The **second** row below was not among
the hypotheses — it turned up while reading the update path for the others.
Rationale in `DECISIONS.md` D38-D41; each has a diagnostic test under
`test/ui/`, checked by reverting the fix and watching it fail.

| Fault | Was | Now |
|---|---|---|
| `willReadFrequently` never took effect, so every miniature rebuild read back from an accelerated canvas and Chrome demoted it for good | slower, then a cliff, never recovering | asked for at creation, on the floor bitmaps only (D38) |
| The stack's shear ran one `drawImage` per source row | 2 048 draw calls per scrub update on 2-5, 4 800 on 2-6 | baked into the cached miniature: one blit per floor (D39) |
| `keydown` and `resize` were left on `window` at unmount | one dead scrubber still seeking per mount ever made; two from StrictMode alone | one `AbortController`, aborted by `destroy()` (D40) |
| Opening a `.sav` simulated all 41 records before drawing the list | ~3 s of blank window | the list first, the columns behind it (D41) |

`[O]` **Unconfirmed by eye.** All four are reasoned and tested headless; none of
them has been watched in a browser, which is the only judge of whether the
degradation is actually gone (D24a). §A step 2.

`[P]` What is left of load time is `paintAll` (32 floors x 450 draws) and the
32 miniature builds, both one-off and both now off the critical path for
showing the list.

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

`[D]` The spec and `DESIGN_ROUTE_EDITING.md` are written; these are the two
questions they deliberately leave to design rather than answer.

- **Importing a route from a `.sav` into an existing `.ord`.** What makes one
  `.ord` usable for all of a player's work. Includes reconciliation: the `.ord`
  stores the payload hash of the record it came from, so a match is clean and a
  mismatch means the player has played on and the metadata must be re-anchored
  by prefix alignment.
- **Autosave behaviour for the working store.** Cadence, what counts as an edit,
  whether to request `navigator.storage.persist()`, and how the player is told
  the difference between crash recovery and a backup (D35).

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
