# Orderlyorderer

Unofficial route-planning tool for the puzzle game *Towers of Scale*.

Start with **`docs/STATUS.md`**. New here? **`SETUP.md`** has the repo setup.

## Layout

```
docs/     canonical. Mutable, current state only. Code is derived from these.
specs/    SPEC-NNN-slug.md. Frozen once tests exist against them.
tools/    standalone utilities
data/     captured game data. Immutable; version-stamped by path.
src/ test/   (not yet created)
```

## Not in this repository, by licence

Towers of Scale is **not** open source. Its source and assets are used with the
developer's permission for this tool only and must never be committed here or
redistributed. They live in `../local/game/`, outside this repository, where git
cannot reach them.

Derived data we generate — tower JSON, sprite hashes, mechanics documentation in
our own words — is published here.

## Current state

No application code yet. Everything here is reverse-engineering, mechanics
documentation and savegame test fixtures.

Next task: **SPEC-002**, parsing `res/maps/*` into tower JSON. Not yet written.
