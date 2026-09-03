# DECISIONS.md

Current decisions only. Superseded entries are **deleted**, not struck through —
git holds the history. Each entry keeps its rationale, because the rationale is
what stops a decision being re-litigated in a fresh conversation.

---

## Conventions

**D1. Coordinates are `(x, y)`, 1-based, origin top-left. Floor index is 1-based
from the bottom of the tower.**
Matches the savegame's own convention, confirmed by locating the player's start
cell. Converting at the parser boundary only — never mid-codebase — keeps one
convention everywhere. Panel 0 of a map export is always the lowest floor, so
`save_floor = panel_index + 1`.

**D2. Docs are canonical; code is derived. Disagreement is a bug in both.**
Independent conversations need a shared source of truth that isn't the code.

**D3. `DECISIONS.md` holds current state only.**
LLMs read supersession order unreliably, and a document containing its own
obsolete contents is a trap for both agents and humans. Git is the append-only
log.

**D4. A spec is frozen once tests exist against it.**
Before that, edit freely. After that, a *behaviour* change is a new numbered
spec, and the old one gets a one-line "superseded by SPEC-00N". Carve-outs:
typos and clarifications may be fixed in place; a spec whose tests encode a real
bug is corrected in place with a note, since a new number would imply the old
behaviour was intended.

**D5. Obsolete specs and adjunct files are archived, not left in place.**
Keeps the working folders small for both a human scanning them and an agent
loading them.

## Architecture

**D6. No backend. Static hosting.**
The tool is quality-of-life for route *editing*, not route *solving*, so there's
no compute requirement. Avoids hosting cost, accounts, moderation and uptime.

**D7. The simulation engine is a pure module with no UI imports.**
Testable in isolation, reusable across towers, and portable to a Web Worker or
WASM later without touching the UI.

**D8. Routes travel in the URL fragment; the local file is the source of truth;
`localStorage` is an autosave backup.**
Fragments are never sent to a server, so sharing works on static hosting and
stays private. Not cookies — 4KB and transmitted on every request. Warn on
unload if the in-memory route differs from the last saved file.

**D9. A tower is identified by its string ID plus a content hash of its grid.**
Every tower JSON carries four header fields: `tower_id`, `game_version` (read
from the archive's `.version`, so it cannot be forgotten), `content_hash` (which
catches a tower edited *within* a version), and `generator` (which catches JSON
produced by a parser we later fixed).
IDs are `"2-1"`, `"EX-3"` etc. The hash detects "this route was made for an
older version of this tower", which will happen — the developer is still editing
towers and adding new ones.

**`content_hash` is the SHA-256 of the source `res/maps/<id>` file's exact
bytes**, lowercase hex — not a hash of our own tower JSON. The JSON shape is
deliberately unstable until a simulator exists (SPEC-002 §5), so hashing it
would change the hash on every schema edit and report a tower-content change
that did not happen. Hashing the input makes the hash track the game's data,
which is what version detection needs. Expected values for v0.7-455 are pinned
in SPEC-002 §8.2.

**Vindicated in practice.** The tower JSON schema was then rewritten wholesale
(D9a) and **not one `content_hash` changed**, across all 16 towers. Had the hash
covered our own JSON, that commit would have reported 16 towers as
content-changed and invalidated every route made against them.

**D9a. The tower JSON is one merged cell grid per floor, not a wall grid plus a
coordinate-keyed entity list.**
A consumer reads a cell by indexing it — `cells[y-1][x-1]` — and never by
scanning a list for a matching `(x, y)`. SPEC-002 §5.2.

The merge is sound only because no cell holds two things at once: 0 cells across
all 16 towers carry both a wall and an entity, and 0 carry two entities. That is
asserted per cell at parse time, throwing rather than overwriting, so a future
game version that broke the assumption fails loudly instead of silently losing
an entity.

The cost is that entity *file order* is not recoverable from the grid, so the
emitted JSON can no longer regenerate the source file. This is deliberate: the
byte-exact round-trip oracle runs over the parser's internal `ParsedFloor`,
which keeps order exactly as read, and losslessness of the merge itself is a
separate, explicit invariant. Two shapes, one parser — the faithful mirror never
leaves the tool, and the merged grid is what gets committed.

Consistent with D11: the alternative was open-coding the same merge inside the
simulator, where the correctness argument would have sat further from the data
it is about. It also made the committed artifact 30% smaller.

**D10. The UI is pixel-exact: integer scale factors only,
`imageSmoothingEnabled = false`, the game's own keyboard shortcuts.**
Fractional scaling is what makes pixel art look wrong.

**D11. Less code is better.**
Where two implementations satisfy a contract, the significantly smaller one is
preferred, and refactoring toward it is part of the task rather than follow-up
work. A parsimonious codebase is easier for both a human and an agent to reason
about correctly. Corollary usable as a review signal: if an implementation is
much larger than its spec's algorithm description, the abstraction is probably
wrong.

**D36. Route editing is one spec, and a segment contains its actions.**

`[D]` All three editing features — add and remove actions, skippable segments,
parallel segments — bottom out in the same machinery: an action list, an edit at
index *i*, truncate-and-replay, and a report of the first step that now fails.
Three specs would freeze three copies of that contract and triplicate its
invariants (D11, D22), so there is one: `SPEC-008`. The `.ord` format is a
section of it rather than its own spec, because the format is ours and cannot
surprise us the way a reverse-engineered one can.

`[D]` **A segment contains its actions**, rather than being an index range over
one flat list. Alternatives for one span have different lengths, so every range
after a switch would shift.

`[D]` **The structure is `Route` → `Epoch` → `Segment` → `Action`, split by how
stable each level is.** `[I]` iestyn: a **Segment** — a named list of actions
plus metadata — is expected to persist long-term, while the containers above it
will be restructured repeatedly as the analysis gets richer. Keeping the durable
concept in its own type is what makes that churn cheap. An **Epoch** is one span
of the route, holding the alternative segments for it and which is live; the
default route is one epoch holding one segment. D7 is untouched: the simulator
sees only the flattened active segments, never an epoch.

`[F]` The root is `Route` and **not** `Timeline`, which is already
`src/sim/types.ts`'s result of `simulate()`, consumed by `Cursor` and three
`mapdiff` modules (D34). "Timeline" keeps its ordinary meaning in prose.

`[D]` **A Segment is inert** — a list of actions, with no selection, no fallback
and no opinion about failure. The three features are **selection policies on the
Epoch**, not three mechanisms:

| The player sees | Segments in the epoch | Active segment chosen |
|---|---|---|
| A plain segment | 1 | always |
| A skippable segment | 1, plus an implicit empty segment | automatically, iff the authored one fails |
| Parallel segments | *n*, authored | by hand |

`[D]` `skippable` therefore lives on the **Epoch**: it describes how the span
chooses, and "segment 2 is skippable" has no non-arbitrary meaning once an epoch
holds three.

`[D]` SPEC-008 invariant 5 is the diagnostic that keeps this honest (D18): a
skipped epoch and an explicitly-selected empty segment must leave the mainline in
identical states. If they ever diverge, the one-construct claim is false and the
three features really are three mechanisms.

**D42. An action is a pair of waypoints, and the live position is route-level.**

`[F]` SAVE_FORMAT §3's `2S+1` rule is **positional**: S pairs of `(from, to)`
then the player's live position. So an edit that adds or removes a single entry
mis-pairs every entry after it and the game reads a different route — which
means neither an insert nor a disable can operate on one waypoint. `[D]` The
document therefore stores pairs, and `2S+1` becomes an invariant of the
structure rather than a rule each operation has to remember.

`[F]` **Both halves are data.** SAVE_FORMAT §3's own worked example has a pair
whose `from` is not where the previous pair left the player: it is the tile they
approached from, which decides adjacency and which side of a one-way wall they
are on, and the auto-pather reproduces neither. A disabled action drops both.

`[D]` The trailing live position lives on the `Route`, not as the tail of the
last segment. It belongs to no action, so a segment holding it would be a
segment of odd length and every editing operation would need an "except the last
one" clause. `[F]` Corrects SPEC-008 draft 1, which had an action be a single
waypoint and `flatten()` drop only the `to` — an even entry list the `2S+1`
rule forbids. Oracle 2 is what would have caught it: 326 payloads reproduced
byte for byte.

**D37. On a name collision, the web app keeps the word and the tool renames.**
`[I]` iestyn: the app is where the complexity is going to be, so it takes
priority on code quality. `src/` under `sim/`, `ui/` and `store/` outranks
`tools/` and the diff harness. `[F]` Recorded after `Variant` was briefly
renamed in the *app* to avoid `src/mapdiff/verify.ts`; the restructure above
retired that clash, but the precedence is worth keeping for the next one. D34
still decides *whether* two things may share a word; this decides *who moves*.

**D40. Every listener a UI object registers goes on one `AbortController`, and
teardown aborts it.**
`[F]` `keydown` and `resize` were on `window`, which outlives the canvas, and
nothing ever removed them: an unmounted scrubber stayed alive holding its whole
`FloorCache` and went on seeking on every arrow key — once per mount ever made,
and two before the player had touched anything, because StrictMode
double-invokes effects. `[D]` A signal cannot miss a listener the way a matching
`removeEventListener` can, and it covers listeners added on any target. `[D]`
The method is `destroy`, not `stop`: it does not restart, and a name that
suggests it might invites a caller to try.

## Data handling

**D12. Cells hidden by tutorial overlays are recorded as Strong Wall, not
Empty.**
Strong Walls cannot be interacted with, broken or bypassed by any mechanic, so
this cannot introduce a phantom pathway. Empty would be the unsafe default.

**D13. The canonical cell hash is `md5(cell[2:11, :])` — rows 2..10.**
Number badges occupy rows 11–15 of a cell and rows 0–1 of the cell below.
Measured, not assumed: within a 132-cell cluster whose badges all differ, rows
2..10 are invariant.

**D14. Map images are transferred inside a ZIP.**
A bare `.png` upload was silently transcoded to JPEG, which destroys exact
hashing while looking fine.

**D13a. Tower data comes from the game's own `res/maps/*` files, not from map
images.**
The source files are authoritative and lossless. Map images lose information the
source keeps: exact values above 999, the cell beneath the player, and every
cell beneath a tutorial overlay. Image extraction is retained only for the
final-state diff oracle.

**D14a. A map export used as initial tower state must be captured immediately
after restarting the tower, and the tower JSON records that provenance.**
Exports can be taken at any point in a run and nothing in the image marks which.
A mid-run export yields a silently wrong tower, and every route validated
against it would be wrong the same way — so the error is invisible to our own
tests. The player marker also hides its own cell, which is empty only at the
start.

**D14b. Towers of Scale is NOT open source. Its source and assets must never be
committed to a public repository or redistributed.**
Stated directly by the developer in `FOR_MODDERS_AND_DATAMINERS.txt`. The only
exceptions are assets listed in `credits.txt` as CC-0 or CC-BY, and the **EX-1
stage**, which came from the open-source game-jam version.

Derived artifacts we generate — tower JSON, sprite hashes, mechanics
documentation in our own words — are ours to publish. The originals are not.

Tower JSON is committed and public. It is a text summary of what any player sees
in game, its diff history is genuinely useful when a tower is edited, and the
audience for the tool has already played these towers. Spoiler risk is not a
real concern. Confirmation from the developer is still outstanding as a
courtesy — see `TODO.md` C2 — but this is the working assumption.

The game archive lives outside the repository entirely (D14d); `.gitignore`
alone is not a sufficient guard against an agent that writes files.

**D14b-1. Sprite use in the app is permitted; the permission is narrow.**
The developer's wording: fine with using Towers of Scale sprites *for tooling
meant to be used for the game*, explicitly **not** a broad permission to use them
anywhere. He has also asked that the tool carry a note saying it is unofficial.

What follows:

- **Assets may ship inside the app.** That is the tooling the permission covers.
- **The app must display an "unofficial" notice**, visible without hunting for
  it — About screen and footer.
- **Do not provide any feature that hands the assets out**: no sprite download,
  no asset pack, no atlas endpoint documented for third-party use. Distributing
  them *as* assets is outside the permission even though shipping them *in* the
  app is inside it.
- **Do not commit raw game assets to a public repository.** A public repo
  publishes them outside the tool, which is the boundary the permission draws.
  Keep them in a local, gitignored asset directory and have the build pull from
  it; deploy the built bundle. If a public repo containing sprites would be more
  convenient, ask first — do not assume.
- The renderer stays behind an interface anyway, so a placeholder set can be
  swapped in for development and for anyone building from source without the
  game.

Proposed notice wording, to be checked with the developer rather than treated as
settled — neither party here is a lawyer:

> Orderlyorderer is an unofficial fan-made tool for Towers of Scale. It is not
> affiliated with or endorsed by the developer of Towers of Scale. Game sprites
> and fonts are used with permission and remain the property of their creator.

**D14d. Two trees. The git repository root is `git/`; everything not for
publication lives in a sibling `local/`.**

```
orderlyorderer/        <- launch the agent here
  git/                 <- the repository. This is what reaches GitHub.
  local/game/v0.7-455/ <- readable by every tool, invisible to git
  local/scratch/
```

Git cannot see above its own root, so `local/` is unreachable rather than
merely ignored. That is a structural guarantee, not a rule that can be edited,
overridden with `git add -f`, or bypassed with `--no-verify`. The `.gitignore`
is retained as a second line of defence in case assets are ever copied inward.

**D14e. The game archive is a build-time input, never a runtime dependency.**
The map parser runs once locally and its output — tower JSON — is committed.
The simulator, tests and app depend only on committed derived data. The archive
is needed to *regenerate* tower JSON, not to run or test anything. This keeps a
large binary out of the hot path, makes tower changes reviewable as diffs, and
means a fresh clone is immediately useful.

**D14c-1. The game archive is version-stamped by the `.version` file at its
root** (`v0.7-455`), and the save directory is `towers_of_scale` from
`conf.lua`'s `t.identity`. Use `.version` for provenance rather than asking —
it is unambiguous and machine-readable.

**D14c. Players use tower states curated and verified by the maintainer.**
Importing a self-supplied map export is a power-user escape hatch — useful when
a tower is updated and the maintainer is unavailable — and carries an explicit
caveat in the UI. This keeps the mid-run export hazard (D14a) off the default
path, where it would corrupt data silently.

**D15. Captured game data is immutable and version-stamped by path.**
`data/maps/v0.7-455/...`. Never edit a capture in place; a new game version gets
a sibling folder so the two can be diffed.

**D16. Save-file variants are named `<tower>.<TEST>.sav` with a paired
`<tower>.<TEST>.md`.**
The game requires an exact filename at the point of use, so the variant is
copied over the canonical name temporarily. Never deliver a modified save under
the same name as an original — that risks overwriting real saves.

**D17. Savegame files are edited structurally, never by byte-splicing.**
Parse the file, substitute the entry in the top-level table, re-emit. Every
count stays consistent by construction.

**D35. `.ord` is the document; `.sav` is import and export only.**

The app's own format holds the route and its editing metadata. The game's save
file is read on import and written on an explicit export, never used as storage.
`[D]` JSON, because a route is small — 1 773 waypoints is the corpus maximum —
and a text document is diffable, greppable and repairable by hand, which is the
right insurance for an artefact worth fifty hours of play. `[D]` **Self-contained**:
it carries the actions, the tower, and the identity and payload hash of the
`.sav` record it came from, so the player may overwrite or delete their `.sav`
and lose nothing. That is what makes it a document rather than a sidecar, whose
failure mode is silent breakage when the pair comes apart. `[I]` How many `.ord`
files to keep is the player's decision; the app neither assumes an organisation
nor manages one.

**Nothing is injected into the `.sav`.** Rejected on function before risk:

- `[F]` The game rewrites the whole file on every in-game save, so injected
  metadata dies at the player's next save. Injection survives only where the
  player stops using the file — exactly where a separate file costs nothing.
- `[F]` Every site is unsafe anyway. The top level is save-name → record, so an
  extra key appears in the game's own load menu; the payload is positional under
  the `2S+1` rule, so appended entries replay as moves; orb tuples already vary
  in arity, so extra values are read as orb parameters.
- `[F]` We cannot write byte-exact `.sav` from TypeScript regardless (B1), so
  every export is already a new file. The metadata never had a host to ride in.

`[D]` The rule worth keeping: **never put your own data in the artefact whose
only job is to be accepted by someone else's parser.** The upside is one fewer
file; the downside is an export that can brick a fifty-hour save on a game
update we do not control.

`[D]` A **working store** (IndexedDB) holds the document and the view
continuously and recomputes everything derived, so a closed tab loses nothing.
It is **crash recovery, not a backup** — one browser, one machine, discarded by
clearing site data — so restoring from it warns and says exactly that. `[D]` The
unsaved-changes marker doubles as the crash detector: a clean-exit flag would
have to be written from `beforeunload`, which does not reliably fire, so its
absence would mean "probably crashed", a guess. The marker is not a guess — it
names the thing that matters, work that is in no `.ord` file. For the same
reason the store is **not** cleared on exit.

SPEC-008 §2, §6; `DESIGN_ROUTE_EDITING.md` §2.

## Verification

**D18. A change to a canonical doc requires a *diagnostic* test — one whose
outcome would differ if the change were wrong.**
"This made more things match" is not diagnostic. This rule exists because a
confirmatory test was used to justify a wrong change to the hash band, and it
was written into a canonical document before being measured.

**D19. A successful save load proves legality, not equivalence.**
The game accepts more than one encoding of the same route. Encoding questions
are settled by **diffing generated triples against a hand-played save**, not by
whether the game accepted the file.

**D20. Reference saves are stored as a triple:** `.manual.sav` (hand-played),
`.expected.json` (extracted triples), `.md` (route description and mechanics
exercised).
Tests assert against the JSON so they never parse a `.sav` to learn the right
answer — a parser regression can't hide by breaking both sides identically. In
addition, the generated and manual saves are compared **byte-for-byte at the
serialized key-value level**, which incrementally validates the serializer
itself, not just the triples.

**D21. Verification is on the contract's output, not by reading the code.**
Specs end with a Verification Contract naming exact expected values. A
higher-tier model reviews the pass/fail table, diff stat and out-of-scope file
list; it reads code only when something fails, the diff is unexpectedly large,
scope was violated, or the module is architecturally load-bearing.

**D22. Invariants are few and carefully chosen.**
Current set: `undo(do(s)) == s`; replay determinism; blocked moves change
nothing; **no player field is ever negative** (an assertion, never a clamp — if
the simulator needs to clamp it has already diverged); monotonicity of
irreversible tower-state changes within a route; a gold ledger that reconciles
(`final == sum(gains) - sum(spends)` computed independently from the event
log). Critical-path logic touching none of these is
a signal the invariant set has a hole.

**D32. The reimplementation test: build a module twice from the docs alone, and
diff the two against the corpus.**
`[P]` Open method, first trial scheduled for `Cursor` (`TODO.md` §A2 stage 1).

The question it answers is whether the docs actually **determine** the code, or
merely describe one implementation of it. Nothing else asks this: the suite
checks that the code is self-consistent, never that a reader starting from the
docs would arrive at the same place. `[I]` iestyn: a fresh Claude context and a
new team member are the same kind of reader, and both are misled identically.

Divergences sort into three classes, and only the third is interesting:

1. **The docs constrain it and the two differ** — an ordinary bug, in the code
   or in the doc.
2. **The docs deliberately leave it free** — correct. That is the latitude the
   doc granted on purpose.
3. **The docs should constrain it but silently do not** — the divergence *is*
   the finding. It has located an assumption that existed only in the code and
   in our heads.

`[D]` Each class-3 finding is then either written down, or **explicitly declared
free**. The second is as valuable as the first and cheaper: a doc that says a
thing is unconstrained stops the question being reopened.

`[D]` Trial on a **module, not the app** — full reimplementation is too
expensive to be a habit. `Cursor` is the right first subject: small, pure,
specified with named invariants, and two implementations can be differentially
tested against each other over all 326 corpus records. Agreement means the spec
determined the behaviour; disagreement isolates class 3 exactly. The invariants
that make the comparison possible already exist, so the experiment is close to
free.

`[O]` What to do if the two agree but both are wrong is not addressed here. The
corpus oracles are the guard against that, not this test.

## Presentation

**D26. Towers of Scale is monochrome, so every hue is available to us.**
`[F]` Light sprites on black, cyan for the player alone — `data/reference/ui/`.
Consequences: overlay colour (route trail, beatable/unbeatable tint, threshold
highlighting) can never collide with the game's own presentation; a tint is one
composite pass rather than a recoloured sprite. SPEC-007 §5.2 requires the
renderer to take a per-cell tint override from the start, unused in slice 1, so
the threshold analysis drops in without restructuring.

**D27. The app mirrors the game's presentation exactly: 1x logical canvas,
integer upscale, nearest filtering.**
`[F]` `main.lua` renders to 426x248 and scales by `min(w/426, h/248)`, flooring
to an integer only under the `pixel_perfect` setting; `linear_filter` selects
the upscale filter separately. We mirror both settings — two booleans for exact
parity with however the user has the game configured. `[I]` iestyn: familiarity
is what makes a tower state parseable at a glance after dozens of hours.

**D27a. The game's status panel is exactly 186 logical pixels wide** — 426
minus one 240px floor — and its layout coordinates are read from
`game.lua:1995-2031`. Our status column reuses both, so the block is
pixel-identical to the one the player already reads. SPEC-007 §8.1.

**D28. Visual mocks are snapshots, never canonical.**
Every dimension a mock shows is restated in the spec as a number, because
numbers are testable and pictures are not; where they disagree the spec wins.
A mock is kept only until the app renders the same view, then deleted.

`[F]` **Carried out 2026-09-01.** `docs/reference/tower-scrubber-mock.html` was
the mock that settled the SPEC-007 layout. The app now renders that view and
`[I]` iestyn judges it better in every respect, so the mock is deleted rather
than left to rot into a second, wrong description of the UI. Its numbers live in
SPEC-007 §5, which is where they were always meant to be. Nothing referenced it
but the three notes saying it could go.

**D29. No placeholder tileset in slice 1; the repo does not build standalone.**
D14b-1 anticipates a placeholder set so that anyone without the game archive can
build. It is deferred, not dropped: until it exists, a build requires
`../local/game/`. Recorded because it is a real limitation of the published
repo, not an oversight.

**D43. The work-tree topic name is the assignment. A session does that task and
leaves the rest of `TODO.md` §A alone.**
`[F]` On 2026-09-01 two sessions fixed §A5 within the hour, from the same
`main`, in separate worktrees, neither aware of the other: `8a2fb00` and
`6e6c79d`. Both diagnosed the ignored `willReadFrequently` correctly and
diverged on the remedy — one routed readbacks through a shared scratch canvas
to keep the floors accelerated, the other made the floors CPU-backed. `[F]` The
merge was **clean**: the second rewrote the file the first had edited, so git
kept one approach whole and dropped the other. No conflict, no warning, and an
hour of work gone.

`[F]` **Visibility was not the problem, and a branch check does not fix it.**
The session that duplicated the work ran exactly that check at 15:58 and saw
`session-route-edit-implementation` sitting on `main` with **no commits** and a
name that said route editing; `8a2fb00` landed three minutes later. The
information did not exist at the only moment the check was free.

`[D]` **The cause was the list.** §A read "Next, in order: 1. Fix the two
performance faults in §A5 … 4. Build SPEC-008", and both sessions started at
item 1 — one of them having been given route editing as its topic. The
assignment and the shared list disagreed, and the list won. `[I]` iestyn: the
name was always meant to be inferred from; the doc never said so. It does now,
in `CLAUDE.md` step 1, **including that a session unsure which task the name
means asks rather than picking**.

`[I]` What this does not solve: nothing makes a claim visible *before* the
work, and `TODO.md` is the only shared surface — but it is also the thing being
edited, so claiming in it is itself a merge conflict. Left open deliberately;
scoping each session is the cheaper half and it is enough for now.

`[F]` This entry was itself numbered **D42** twice over, colliding with the
waypoint-pair decision landed the same day by the other session — the same
failure one layer down, and the reason it now carries the next free number
rather than the one that looked free from inside a worktree.

**D38. A canvas that is read back is created `willReadFrequently`. Nothing else
is.**
`[F]` A canvas hands out the 2D context it already holds and **ignores the
attributes of every later `getContext`** — so the flag asked for at the
`getImageData`, which is where it reads naturally, never took effect once. Chrome
warned about it in the console twice and the warning was read as advice rather
than as a report. `[F]` Repeated readbacks demote an accelerated canvas to
software and it is never promoted back, which is the shape of "slower and
slower, then a cliff, and never recovers". `[D]` So the flag is asked for at the
one place a context is created, and only for the bitmaps actually read back —
the 240x240 floors, not the atlas, which is drawn from and never read.

**D39. A projection that never changes is baked into the cached bitmap, not
applied per draw.**
`[F]` The tower stack sheared each floor a source row at a time: 64 `drawImage`
calls per floor, **2 048 per scrub update** on 2-5's 32 floors and 4 800 on the
75-floor tower — for offsets identical in every frame, over a bitmap that
changes only when a seek edits that floor. `[D]` The shear is whole pixels, so
moving it into the miniature copies the same pixels to the same places: the
frame is identical and a floor is one blit. Worth generalising — **anything
constant per frame belongs in the thing that is already cached per frame.**

**D41. Nothing on screen waits for a number that nothing on screen needs.**
`[F]` Opening a `.sav` simulated every record before drawing the list — 2-5 is
41 records and 156 546 steps, about three seconds of blank window — to fill
three columns beside a name the player is choosing the record by. `[D]` The list
is shown at once and the columns fill in behind it, a macrotask apart so the
browser paints between rows. The order is a function of the names alone, so no
row moves once it is on screen. `…` says a number is still coming; `—` says
there is not going to be one.

## Workflow

**D23. Opus/Fable for design, specs, format reverse-engineering and
second-attempt debugging; Sonnet for implementing written specs, tests and
refactors.**

**D24. One subtask per conversation; continuity comes from the docs.**
Long threads re-send their whole history every turn, so a 40-turn conversation
costs far more per message than a 5-turn one.

**D24a. UI iteration runs inside one conversation, contra D24.**
D24 is right for implementation and wrong here. On the fourth round of "the
trail is still too busy", the context that matters is the three things just
rejected — chat state, not doc state. Reloading from docs each round loses it
and costs more. The doc is updated once, at the end, when the shape has settled.
`[I]` Rejected options still get recorded here when the reason is worth
keeping, as everywhere else in this file.

**D25. Every subtask opens with a cost estimate; over ~5 tool calls, wait for
approval. If an approach fails twice, stop and report — don't try a third.**

**D30. UI is specified in two documents, split by testability.**
The spec-first discipline was built for reverse-engineering, where the facts
precede both spec and code and freezing is therefore safe. UI inverts that: the
artefact precedes the judgement, so a frozen UI spec freezes a guess.

- `specs/SPEC-NNN` holds only what is **numerically testable** — constants,
  measured facts, interfaces, invariants, the Verification Contract. It freezes.
- `docs/UI.md` describes **current behaviour in natural language**. It is
  mutable and current-state-only, like every other file in `docs/`.

The test for which one a statement belongs in: *would it change because you
looked at the screen and disliked it?* If yes it is behaviour, not contract.
The two must not overlap. `[I]` A green suite must never be mistaken for a
working UI, so the contract says so explicitly.

**D31. Design docs are bounded, and shrink as often as they grow.**
`[I]` iestyn: accumulating documentation is a default-nervous thing to do,
because nothing tells you when a doc lies, and both a new team member and a
fresh Claude context are misled by the same stale sentence. Drift is hard to
avoid by discipline alone, so the rules are structural:

1. **Only what can be verified by looking.** A sentence that cannot be checked
   against the running app in under a minute is a decision (→ here) or
   speculation (→ delete).
2. **No implementation detail** in a design doc — no module names, no data
   flow, no algorithms. Those are what drift; the spec and the code own them.
3. **A change that makes a sentence false deletes it in the same edit.**
4. **A line budget**, so the doc stays short enough to actually re-verify in one
   pass. `docs/UI.md`, `STATUS.md`, `TODO.md`: **150 lines** each.

5. **Minimal complete description: every sentence must change what a reader
   would build.** If deleting it leaves the same artefact, delete it. Three
   habits this rules out, all of them Claude's: saying a thing in summary and
   again in detail; explaining *why* where a decision already holds the why
   (D33, generalised from rules to reasoning); and arguing for a choice the
   reader has no power to reject.
6. **A compression pass names what it cut and where the content went.**
   "Deleted §A4 — done, and D33 holds the finding" is a compression. "Tightened
   the prose" is not: same content, denser. That is how a doc loses fidelity
   silently while staying under budget.

`[I]` Over budget is first a signal to **think harder, not to split** — a design
that will not compress is usually not understood yet, and usually reads as a
cluttered UI too. `[F]` 150 is achievable, not aspirational: `SPEC-006` fully
specifies the `.sav` codec in **146 lines**, and that codec round-trips 326/326
records exactly.

`[D]` **But over budget with nothing left to name is the escalation trigger**,
not licence to compress again. Escalate by raising the budget and recording the
new number, or by splitting on a real axis — one doc per surface. `[I]` Dodging
a budget and having genuinely two subjects are different moves; only the first
is forbidden. `[F]` The trigger was earned: of four compressions in the session
that wrote D35-D37, two deleted duplicated content and two only made prose
denser, and nothing at the time distinguished them.

`[O]` **What counts as minimal is not yet shared understanding.** `[I]` iestyn
finds Claude's documentation verbose in general; rule 5 is a first attempt at the
test, not a settled one. `[F]` The gap is measurable — SPEC-008 specifies route
editing in ~437 lines against SPEC-006's 146 for a whole codec.

`[F]` **One attempt was made and did not converge**, 2026-09-01. Rule 5 applied
to SPEC-008 §3-§4 cut 80 lines to 65 — and `[I]` iestyn's verdict on the result
was that *both* versions are hard to parse, which is the finding: the problem is
not length alone, so cutting words is the wrong axis to optimise. `[F]` Also
learned, from measuring: 77 of the spec's lines are inside code fences, and the
prose weight is concentrated in §9 and §2, not spread evenly. The abandoned
candidate is `local/scratch/SPEC-008-candidate.md`. Resume from *legibility*,
not from a line target.

`DECISIONS.md` is exempt from a line cap — it is a ledger and legitimately
grows — but not from deletion: a superseded decision is **removed**, not struck
through. Specs are exempt because they freeze and their size is set by the
subject, not by neglect.

`[D]` Panels stay sections of one file rather than separate files, so loading
context is predictable rather than a guess about which subset a task needs.
Revisit if a section outgrows the budget on its own.

**D33. A game rule has exactly one home, and it is `GAME_MECHANICS.md`. Specs
cite it; they never restate it.**

`[F]` Prompted by a real bug found on 2026-08-31. The Pop-Up Wall life cycle was
stated in three places. `GAME_MECHANICS.md` §3 had it right. `SPEC-004` §4.2 had
it right. `SPEC-004` §9 invariant 3 and `SPEC-007` §4.4 had it **backwards** —
`Original → Reinforced → Gone` where the game does `entity → empty → wall` — and
the wrong pair had been read, implemented against and reviewed without anyone
noticing, because each copy is locally plausible.

`[I]` iestyn: we should not have game rules, or other critical app logic, listed
in multiple places; there is a reference doc for this, so reference it.

The failure mode is specific and worth naming: **a paraphrase of a rule reads as
an independent confirmation of it.** Three statements looked like corroboration
and were actually one source plus two guesses. The corpus could not catch it
either, because the simulator only ever ran one of the encodings.

`[D]` So:

1. **`GAME_MECHANICS.md` is the only place a game rule is stated.** If a rule is
   not in there, put it there first.
2. **A spec may state the app's *encoding* of a rule** — `CellState`, an
   interface, an invariant's exact form — because that is ours, not the game's.
   It cites the rule it encodes and does not re-derive it.
3. **A spec that needs a consequence cites the consequence, not the rule.**
   SPEC-007 §4.4 wanted "at most three edits per cell"; it had no business
   restating why.
4. `[D]` **When you catch yourself explaining a game rule in a spec, that is the
   signal.** Move it to `GAME_MECHANICS.md` and leave a pointer.

`[D]` This extends D18: a change to a canonical doc needs a diagnostic test.
The diagnostic for a *rule* is a test that names the rule's content — the edit
bound alone passed happily against the inverted chain, and only asserting the
chains by name caught it (`test/sim/cursor.test.ts`, invariant 4).

**D34. A scroll unit is a view device; a route segment is simulation state.
They share no code, no layer and — deliberately — no word.**

`[I]` iestyn: segments are lower level, they affect save state and simulation;
the scroll-related sub-sequences are UI only.

`[F]` This began as a name collision. The timeline strip grew a `Segment` type
for laying out a working set of floors, while `DESIGN_ROUTE_EDITING.md` §4 and
`SPEC-008` already owned "segment" for the user-named, skippable divisions of a
route. Two concepts, one word, and the second one was being drafted in another
session at the same time — so nothing in either place would have caught it.

`[D]` The two are kept apart by layer, not by care:

| | Route segment | Scroll unit |
|---|---|---|
| Owns | `SPEC-008`, `src/sim/` | `docs/UI.md`, `src/ui/render/` |
| Made of | route waypoints the player groups and names | floors that happen to fit the strip |
| Lifetime | persists; affects save state and simulation | recomputed whenever the window resizes |
| Survives a resize | yes | no, and that is the point |

`[D]` Invariant 5 already forbids `src/sim/` from importing the UI, so the
dependency cannot run the wrong way. What that does not catch is the *word*
leaking back down, so a test asserts `src/sim/` never mentions `ScrollUnit`.

**The finding worth keeping.** `UI.md` §6 deferred smart layout for wanting a
tuning parameter — "how much oscillation should count" — and that parameter
turned out not to exist. The honest threshold is **how many tiles fit on the
screen**, which is not a number anyone has to choose: it is already determined
by the layout, and it adapts to the window instead of being guessed once.

`[I]` Confirmed by iestyn: the threshold for the working set is the number of
fully visible tiles.

`[D]` Worth generalising, carefully: **a parameter that resists being chosen is
sometimes a parameter that is already determined by something else.** Before
adding a knob, look for the quantity the system already knows. This is not a
licence to eliminate every parameter — `dHue` and the stack's dimensions are
genuinely matters of taste and stay tunable — but it earned its keep once.
