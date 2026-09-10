# DESIGN: Route Editing

Draft 7, 2026-09-01. Rationale and behaviour for the three editing features.
Built: `docs/UI.md` §6 is now the description of what exists.
The testable contract is `specs/SPEC-008-route-editing.md`; the two must not
overlap (D30). Depends on SPEC-004.

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

---

## 1. The problem

A route is a long list of moves recorded by the game. The player wants to *edit
the middle of it* and see immediately whether the rest still works — and if it
doesn't, exactly where and why it breaks.

`[I]` Adding or removing a single action early in a run is **the most common way
a score is improved**, and by hand it is enormous, error-prone busywork. Towers
1-6, 1-5 and 2-1 are where iestyn feels this most.

`[D]` The tool **never solves a route.** `[I]` It makes the player's own solving
faster; it does not do it for them. That is why there is no automatic repair
when an edit breaks the tail — diagnosis only. `[I]` Tightly constrained
generators may appear later (a greedy algorithm for a short segment), but they
are not the shape of the tool.

---

## 2. Persistence

`[D]` **`.ord` is the document. `.sav` is import and export only** — two verbs,
never conflated. `[D]` JSON, because a route is small and a text document is
diffable, greppable and repairable by hand, which is the right insurance for an
artefact worth fifty hours. `[D]` **Self-contained**: it carries the actions,
the tower, and the identity and hash of the `.sav` record it came from, so the
player may overwrite or delete their `.sav` and lose nothing. That is what makes
it a document rather than a sidecar, whose failure mode is silent breakage when
the pair comes apart.

`[D]` **How many `.ord` files to keep is the player's decision.** One for
everything, one per tower, one per experiment — the app neither assumes an
organisation nor manages one.

### 2.1 Why nothing is injected into the `.sav`

`[D]` Rejected on function before risk, and worth keeping because the reasoning
generalises.

`[F]` **The game rewrites the whole `.sav` on every in-game save**, so injected
metadata dies at the player's next save. Injection survives only where the
player stops using the file — exactly where a separate file would have cost
nothing. `[F]` Every site is unsafe anyway: the top level is save-name → record,
so an extra key shows up in the game's own load menu; the payload is positional
under the `2S+1` rule, so appended entries replay as moves; orb tuples already
vary in arity, so extra values are read as orb parameters. `[F]` And we cannot
write byte-exact `.sav` from TypeScript regardless (B1), so every export is
already a new file.

`[D]` The general rule: **never put your own data in the artefact whose only job
is to be accepted by someone else's parser.** The upside is one fewer file; the
downside is an export that can brick a fifty-hour save on a game update we do
not control.

### 2.2 The working store

`[F]` The app has no backend and a browser cannot quietly write to disk, so
between saves the player's edits exist only in memory.

`[D]` A **working store** — browser-local, written on every edit — holds the
session so reopening resumes it. It keeps the **document** and the **view**, and
recomputes everything derived, because the simulation is a pure function of the
tower and the action list and a cache would only be something to invalidate.

`[D]` **It is crash recovery, not a backup.** It lives in one browser on one
machine, and clearing site data, private browsing or quota eviction each discard
it. `[D]` **Restoring from it warns**, saying what was restored and when, that
this is not a backup, and offering to save. `[I]` The player must be left in no
doubt that managing their `.ord` files is theirs to do.

`[D]` **The unsaved-changes marker is also the crash detector**, so there is no
separate one. A clean-exit flag would have to be written from `beforeunload` or
`visibilitychange`, neither of which reliably fires, so its absence would mean
"probably crashed" — a guess. The marker is not a guess: it names the thing that
matters, **work that is in no `.ord` file**. A crash with nothing unsaved needs
no warning. `[D]` For the same reason the store is **not** cleared on a clean
exit; that would discard the resume behaviour to answer a question already
answered.

`[D]` One flag is kept for a different failure: **"load completed"**, so that a
document which crashes the app *during* load cannot trap the player in a loop.

### 2.3 The unsaved-changes marker

`[I]` Large and unmissable, in the browser tab title as well as in the app.

`[D]` **The marker tracks the document, not the view** — the same division the
working store uses, so no list of triggering actions has to be maintained.
Scrubbing, Z/Y, mode buttons, option toggles and selection are all view.
Inserting, disabling, splitting, renaming, reordering and switching which
segment is active are all document.

`[D]` It is a **comparison against the saved document**, not a sticky flag,
because toggling an action off and back on must clear it. `[D]` This is the
opposite call to `inserted` in §3, and the distinction is worth keeping: there a
flag answered the question exactly; here a flag *cannot*, since "does the
current state equal the saved state" is not derivable from a set-on-edit
boolean.

`[D]` **It never runs on the frame path**, so it cannot cost frames: scrubbing
is the only thing at frame rate and it touches nothing in the document. Edits
happen at the speed of a click, so the hash is computed on edit, synchronously.
A periodic background pass would be worse on both counts — work when nothing
changed, and a stale marker.

`[D]` **App-level undo uses the same rule**: document changes are undoable, view
changes are not. `[I]` iestyn will refine this from real use.

### 2.4 Export

`[D]` **Export never overwrites anything at all.** It writes a folder of its
own, holding a copy of every save the player gave it, one of which has gained an
`ORD:`-named record and kept every other byte (`SAVE_FORMAT.md` §8). Copying
that into place is the player's, in Explorer, because Windows will not let a
browser near the folder the game reads. `[I]` Every instruction says **copy**:
a move leaves the player with one of something they wanted two of. A download of a fresh, uniquely-named
one-record file is still offered beside it.

`[D]` **There is a full-screen gate, and it is instruction before it is
warning.** The earlier decision — removing the destructive operation beats
warning about it — still holds, and the destructive step *has* been removed: the
app cannot reach a save file. What is left is a hand-off, and the player has to
have made `tos_backups` before the folder dialog opens or there is nothing to
select. `[I]` iestyn, 2026-09-09 and 2026-09-10, asked for the warning and
supplied the protocol on it.

`[D]` The gate is kept from becoming wallpaper by what is behind it rather than
by its wording: a checkbox naming two preconditions the player must actually
have met, and a screen they reach only when they chose to write to their save.
The download route is never gated. `[O]` If it does start being clicked
through, that is a signal the injection needs to be rarer, not that the modal
needs to be louder.

`[D]` **Export refuses a failing route.** `[F]` The game's loader would refuse it
anyway by re-simulation, so this only decides that we say so, clearly, first.

---

## 3. Feature 1 — add and remove actions

`[I]` The big bang-for-buck feature, and what makes the app immediately useful
to other players. An existing action can be **disabled**; a new one can be
**inserted**.

`[D]` **`disabled` is intrinsic and persists forever.** `[I]` The player wants
reminders of the actions they eliminated, and to toggle them back while
permuting. `[D]` **`inserted` is session state, never written to the `.ord`.**
It means "new since the last save", has exactly two transitions — set on insert,
cleared on save — and both are ours, so it cannot drift. Nothing is ever
modified or moved, only inserted or toggled, so a baseline diff would cost more
and say no more.

### 3.1 Behaviour — for `docs/UI.md`

`[I]` **The timeline is green where the route passes and red where it fails**,
so a change's consequence is visible at a glance. For simple adds and removes
this is a green prefix and a red suffix; features 2 and 3 make it richer.

`[I]` **Added actions** carry a `+` badge with a drop shadow. **Disabled
actions** are subtler: a *no entry* badge marks the tile that would have been
affected, and it stays on the floor rather than on the slider, the route that
ran no longer containing that action. `[F]` An action is a recorded *pair*
(D36), so disabling it removes the approach with it. `[P]` An outline with a
drop shadow around both tiles, possibly around live actions too for consistency.
`[O]` Built; not yet judged by eye.

`[I]` **Three mutually-exclusive mode buttons** at the top-right of the left
panel — a play icon for scrubbing, minus for toggling, plus for inserting.
iestyn supplies game-congruent pixel art.

`[I]` **Z and Y single-step the history**, mirroring the game's own undo and
redo, because a slider cannot pick one step out of thousands. Slider, Z and Y
are live in all three modes.

`[I]` **In add mode**, left-click paths the player to the clicked tile and
performs whatever action is implied, exactly as the game does; a click implying
no action is ignored. `[O]` Possibly move the player icon anyway, so the player
is not left wondering. `[I]` **In delete mode**, left-click toggles the clicked
action — an argument for the outline above, since an action should look raised
and clickable.

---

## 4. Feature 2 — skippable segments

`[I]` The history is divided into user-named **segments**, simulated in order.
On their own they are UI only. `[I]` A **skippable** segment behaves
differently: if any action in it fails, the simulation rewinds to its start and
skips it entirely, marking it red while what follows continues.

### 4.1 This is the threshold detector

`[I]` The target is rooms like those in 2-5 *The Orderly Order*, where one room
has several entry tiers — enter with 1k power and you clear ten enemies, with
10k and you clear twenty. Give the room one skippable segment per tier, and
edits made earlier show directly which tiers light up.

`[D]` The consequence is the strongest argument for the design: **this is a
general-purpose threshold detector, and no threshold algorithm gets written.**
The predicate "can this tier be cleared from here?" is answered by the simulator,
so it accounts for every rule at once — power, keys, gold, pickaxes,
reachability, held items — rather than the subset a bespoke analysis would have
remembered. D11.

`[P]` It also supplies the hard half of §7: a tier's *number* is a search over
this predicate, not a separate computation. `[P]` That inverts the order
`STATUS.md` assumes — floor entry thresholds now arrive as a consequence of the
editing work rather than ahead of it.

### 4.2 The segmentation is the player's experiment

`[D]` **What a skip discards is the player's decision.** They choose where the
boundaries fall and what goes in each segment, so if a skip throws away a prefix
worth more than the skip, or leaves a later segment unreachable, that is the
experiment they chose and the result they are entitled to see. `[I]` The app
does not second-guess a segmentation.

`[D]` **A failing non-skippable segment stops the whole route.** Skippable is
the exception, not the default.

`[O]` `[I]` Whether the skippable flag is needed at all — every segment being
skippable may be fine. Resolves by use, not by argument.

### 4.3 Selection, and reading a failure — for `docs/UI.md`

`[I]` The player must be able to build a segment that fails — assembling its
actions is how the experiment gets made — and then step through it to see why.
So a failed segment cannot be hidden.

`[I]` **Selection resolves this.** By default scrubbing traverses only the green
mainline; clicking a red segment selects it, and scrubbing then moves inside
that partially-failed side history. The two never interleave, because the player
is explicitly in one or the other. `[D]` Scrubbing a selected segment **clamps**
at its own end, and a failed one at its failing action — never falling out into
the mainline. Leaving is deselecting.

`[I]` **The current segment is marked with a bracket** over its portion of the
timeline. By default the whole timeline is one segment, and an affordance splits
it; scrubbing auto-selects when nothing is selected manually.

`[I]` **Editing requires a selected segment**, which dissolves the question of
which segment a boundary insertion joins rather than answering it.

`[D]` Selection is not a special case for failures — it is the same affordance
feature 3 needs to choose between parallel segments. Build it once.

`[F]` **The failure report already has its content**: SPEC-004 §7's `SimError`
carries 16 error codes plus `have` and `need`, so a message can say *4 000
short* rather than *too weak*, and it already separates `NEED_PICKAXE` from
`NEED_HYPER_PICKAXE` because telling a player to find a pickaxe for a Reinforced
Wall is actively misleading. `[I]` Overlay it below the failing action in the
left panel, and on the timeline on hover with the segment name.

---

## 5. Feature 3 — parallel segments

`[I]` A chunk of the timeline may have two or more segments defined, and the
player picks the active one by clicking. The main branch runs the active ones;
the inactive alternatives are simulated too, so the player sees which would pass
if switched to.

`[I]` The point is rapid permutation with instant feedback: switch 5F from a
segment that kills enemies for a Light Key to one that skips them, then switch a
complementary segment on 7F that takes a Light Key there instead, and the
cascading colours say immediately whether the combination works.

### 5.1 The structure this needs

`[D]` **Segments contain their actions.** Alternatives for one span have
different lengths, so a segment cannot be an index range over a flat list —
every range after a switch would shift. This reverses an earlier decision that
was right for features 1 and 2.

`[D]` **`Route` → `Epoch` → `Segment` → `Action`, split by how stable each level
is.** `[I]` A **Segment** — a named list of actions plus metadata — is expected
to outlive everything above it, while the containers get restructured repeatedly
as the analysis gets richer; keeping the durable concept in its own type is what
makes that churn cheap. An **Epoch** is one span of the route, holding the
alternative segments for it and which is live. The default route is one epoch
holding one segment. D7 is untouched: the sim sees only the flattened active
segments, never an epoch.

`[F]` The root is `Route` and not `Timeline` because `Timeline` is already the
simulator's result type. "Timeline" keeps its ordinary meaning in prose — the
strip the player scrubs.

`[D]` **A Segment is inert**, and all three features are selection policies on
the Epoch: one always-active segment; one segment plus an implicit empty one
chosen automatically when it fails; or *n* segments chosen by hand. That unifies
features 2 and 3 instead of stacking them, and is the strongest argument for a
single spec. It also puts `skippable` on the Epoch, where "this span may resolve
to nothing" is exact, rather than on a segment where it would be ambiguous as
soon as there were two.

### 5.2 What gets simulated

`[D]` **An inactive segment is forked from the mainline's prefix, not simulated
in isolation** — its outcome depends on the state the mainline reaches there,
which is cheap because that state already exists. `[D]` **A fork runs to its own
end and no further**, answering *would this pass from here* in linear total
work; the active combination already answers *would the whole thing still work*
for free the moment the player switches. `[I]` The route may become a full tree
later; walk before running.

`[D]` **Combinations are never enumerated.** With *k* epochs of *m* segments
there are *m^k* routes; the app simulates the current one plus one fork per
segment. It is a feedback loop for a human permuting choices, not a search.

---

## 6. How a route is represented

`[D]` Moves are stored as absolute coordinates, matching the `.sav` format, not
as directions. `[I]` Teleport semantics are exactly what is wanted: a replayed
segment reproduces its original absolute positions verbatim and the sim
re-validates every step against the new state. A direction-relative replay would
translate a segment sideways after any inserted detour, which is never the
intent.

`[I]` Segments are **order-portable but not spatially portable** — swapping
A-B-C to B-A-C is meaningful, relocating a segment to another floor never is.
That settles the coordinate question, since reordering preserves absolute
positions. `[I]` Segments are **persisted**: they are the mnemonic structure by
which the player conceives a strategy, so names and boundaries survive sessions.

The canonical route is a list of **state-changing actions**, not moves. Passive
walking between them is reconstructed by the pathfinder (SPEC-004 §5), which
also validates reachability. Editing at index *i* truncates and replays forward,
valid because the sim is deterministic, and costs the length of the tail.

**Worked examples.** `[I]` *Additive at the head*: the player earns gems on
another tower and inserts moves at the start to open Gem Gates; everything after
replays verbatim. *Additive mid-route*: insert moves to acquire a Light Key, and
later to spend it on a Light Gate; the route either side replays verbatim.
`[D]` Both are additive, and **must not be special-cased** — validation stays
always-on, and the performance answer is to make full re-simulation fast enough
for the hard cases. *Non-additive substitution*: trading a Light Key for a Dark
Key changes power at every subsequent step, so a downstream attack may fail and
repairing it shifts power again. `[P]` Feature 3 is the tractable form of this —
two segments of one epoch, switched and compared, rather than an edit made blind.

---

## 7. The power graph — a later spec

`[I]` Where route optimisation actually happens, and probably the highest-value
analysis in the app. Not part of the editing spec: it computes over a *valid*
route, where the green/red picture validates an *edited* one. `[P]` And §4.1
shrinks it — the threshold half now arrives as a search over feature 2's
predicate.

`[I]` **Thresholds**: with the curve drawn and thresholds marked, the player
sees whether an edit lifted or dropped it at each one, and which have slack.
`[I]` **Half Gates** invert the usual intuition — power gained before one is
halved by it, so the ideal is to arrive at minimum power and defer gain until
after; on the graph a Half Gate is a visible cliff. `[P]` **Margin**: record how
close each passing step came, `[I]` drawn as columns beneath the curve, so a
column touching the curve is the next thing that will break. `[I]` Cutting
margins deliberately is a strategy — getting by with 4k less somewhere may free
the Light Key spent to earn it. `[I]` **The Keysmasher** is where the tool earns
its keep most sharply: its bonus is `lightKeys × darkKeys` (or `lightKeys²` on
`negative_keys` towers), so spending a key changes damage output, not just
access, and the whole curve after it pivots on one upstream purchase.

`[F]` The data is already retained — SPEC-004 §8 keeps `Step.requirement`, and
power per step is a contiguous `Float64Array` read (`MAX_POWER` is
999 999 999 999, so Int32 would wrap).

---

## 8. Open questions

1. `[O]` **Re-import reconciliation.** A `.ord` records the hash of the `.sav`
   record it came from; a matching hash on re-import is clean, a differing one
   means the player has played on and metadata must be re-anchored by prefix
   alignment. Tractable, but real design work.
2. `[O]` What gets auto-marked on the power graph, and against which metrics.
   Power is not the only threshold resource — keys, pickaxes and gold gate
   progress too, as do resource-limited modifiers like the Vorpal Blade.
3. `[O]` Whether segments can be moved between epochs, or only created and
   deleted in place. `[F]` Merging, which was open here, is specified and built:
   two adjacent one-segment epochs become one, and invariant 3 asserts it undoes
   a split.
4. `[O]` Two in §3.1 and one in §4.2, built and awaiting an eye rather than an
   argument.

---

The decisions here are settled in `DECISIONS.md` **D35** (persistence) and
**D36** (one spec, segments contain their actions); the open UX work is
`TODO.md` §A6. The behaviour in §3.1, §4.3 and §5 moves into `docs/UI.md` as
part of implementing the spec — **SPEC-008 §8** carries that list, because
`UI.md` is current-state only and would lie if it described unbuilt behaviour.
