# tools/

Standalone build-time and reverse-engineering utilities. Nothing here is a
runtime dependency of the app: tools read the game archive in `../local/`,
which git cannot see (D14d), and write derived data into `build/`
(`tools/paths.ts`), which is gitignored. The app and the simulator depend only
on that derived data, never on a tool (D14e). `deploy.ts` is the exception — it
is not a build input but the publishing step.

Run every tool from the repository root.

| Tool | Language | What it does |
|---|---|---|
| [`maps/`](maps/README.md) | TypeScript | Parses `res/maps/*` into the tower JSON in `build/`. See its README. |
| `deploy.ts` | TypeScript | `npm run deploy` — builds the site and pushes it to `gh-pages` (D47). Only iestyn runs it; it reaches the network. |
| `luajit_buffer.py` | Python 3 | Reads and writes `.sav` files: the LuaJIT `string.buffer` codec plus the Towers of Scale container. |

## `luajit_buffer.py`

A module, not a CLI — import it from a script or a REPL. It implements the
subset of the LuaJIT serialization format the game uses, and decodes every
documented tag so unexpected data is reported rather than silently misread.
The format is specified at <https://luajit.org/ext_buffer.html>.

```python
import sys; sys.path.insert(0, "tools")
import luajit_buffer as ljb

top, raw = ljb.load("data/saves/tests/1-5.SUFFICIENT-POWER.sav")
moves = ljb.entries(top["towers"]["1-5"])   # [(floor, x, y), ...]
blob  = ljb.make_blob(moves)                # back to a 'TOSSAVE\0' + zlib blob
```

- `load(path)` — parse a whole save file; asserts no trailing bytes.
- `entries(blob)` — the undo history inside one tower's blob. Entries are
  usually `(floor, x, y)` but **not always**: orb moves are 5-tuples. Never
  assume arity 3.
- `make_blob(rows)` / `emit(v)` / `parse(d, i)` — the inverse and the raw codec.

Saves are edited **structurally — parse, substitute, re-emit — never by
byte-splicing** (D17), so counts stay consistent by construction. A parse/emit
round trip reproduces every available `.sav` byte-for-byte; that round trip is
the oracle, and `docs/SAVE_FORMAT.md` is the canonical description of what the
bytes mean.
