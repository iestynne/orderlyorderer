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

## Workflow

**D23. Opus/Fable for design, specs, format reverse-engineering and
second-attempt debugging; Sonnet for implementing written specs, tests and
refactors.**

**D24. One subtask per conversation; continuity comes from the docs.**
Long threads re-send their whole history every turn, so a 40-turn conversation
costs far more per message than a 5-turn one.

**D25. Every subtask opens with a cost estimate; over ~5 tool calls, wait for
approval. If an approach fails twice, stop and report — don't try a third.**
