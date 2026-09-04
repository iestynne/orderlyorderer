# UI.md

**What the app currently does**, in natural language. Current state only.

Read with `SPEC-007` and `SPEC-008`, which hold the numbers: constants and
interfaces there, observable behaviour here. Rules and the 150-line budget: D31.

---

## 1. Shell and loading

On first run the app is only the way in: a large **Open a save file or a route**
target that also takes a file dropped anywhere on the window. A `.sav` is
imported from; an `.ord` is reopened. The empty state names where saves live,
and carries the unofficial notice and a line saying routes live in `.ord` files
the player keeps while the browser's working copy is crash recovery, not a
backup. A working copy from a previous session is offered back with that warning again;
one that crashed *during* load is discarded instead, and the app says so.

Opening a `.sav` lists its records at once: name, timestamp where there is one,
and three figures simulated behind the list, `…` until each lands — final power,
highest floor, waypoint stops. Player-named records sort above the `AUTOSAVE_*`
ones, those names being the player's own index. A record using orbs is listed
but not openable, and says why. The tower comes from the filename; if that names
no tower we know, the app asks. An `.ord` names its own tower, and is asked
which route only when it holds more than one. Choosing one replaces the empty
state with the two panels, over a toolbar: back to the records, the route's
name, save `.ord`, export `.sav`, and a **screenshot** button writing the exact
1× frame to a PNG. Going back returns to the record list, not to the file
picker: choosing another record from the same save is the common next thing.

## 2. Timeline panel

The left panel shows the floors the route visits, each tile captioned with its
name and which visit it is. A floor earns a tile only where the player **acts**
on it; floors merely walked through get none, and the trail crosses the gap in
one dashed segment so it reads as travel.

The route is cut into **working sets**: runs whose floors all fit at once. The
panel shows one at a time and **nothing scrolls** — it jumps to the next set
when scrubbing leaves this one, so a three-floor tower never changes at all.
Working sets are a **view** device: recomputed on resize, never saved, and not
the route segments of §6. D34.

Tiles fill the panel in reading order, left to right and then down, as many as
the window and the zoom allow — and exactly that many: the count and the layout
measure the same rectangle, or a floor ends up with no tile to be drawn in. The
block is centred in whatever room is left.
Every one has a border, a gap, and a name strip under it — which is also where
the current action is summarised (§6).

## 3. The route trail

A line runs through the route's waypoints over the floors, connecting them
directly rather than following the walked path. It crosses between tiles, so
stairs read as one continuous line; those crossings are dashed as travel. Both
halves are lavender, separated only by hue: the past shifted towards blue, the
future towards red. That shift is one tunable constant, `dHue`, not yet settled.
Both carry a black outline, and both fade to nothing two stops either side of
the scrub position — a narrow reminder, not a whole-route overlay. **It says
tense, not verdict**; the slider says verdict, and a two-stop window has no room
for both. The future draws before the past and the segment at the scrub position
draws last.

## 4. Control panel

The right panel holds a fixed shape at any window size while the left panel
takes the rest: the scrub slider, the **action list** of §6, and the tower stack
out to the panel's right edge. Two lines of header sit above them — the tower's
name and Power, then the action counter and everything else the player carries.

**Scrub slider.** Vertical, running **upward**: the first action is at the
bottom, as floor 1 is in the stack beside it. It stops once per action —
disabled ones included, which keep their number and their place — plus once at
the final position. Ticks mark floor changes; a counter reads which action you
are on. The handle is an hourglass on its side, crossing the track at its waist:
wide enough to grab, pinched so it never hides its tick. **The track is the
verdict**: green the whole way from a clean load, turning red from the action an
edit has broken, with an **exclamation** on it — which clicks through to it.
The no-entry sign means something else here: *the rules refuse this*, which is
a hovered cell's answer, not the slider's.

**Tower stack.** The whole tower as a vertical stack of floors, each squashed
and raked over at **2:1**, reusing the timeline's floor images so the two agree.
The squash is filtered, not sampled: each pixel averages the pixels it stands
for. **The whole tower always fits — nothing scrolls.** Floors are spaced to
fill the panel, so a tall tower's overlap behind a 2 px outline, each showing a
band of itself; a short tower spreads to a limit of two pixels of air. Every
floor is drawn identically: the current one is marked by being drawn last, with
a lavender outline, by being the only one labelled, and by being the only one
at full contrast — the rest are pulled halfway to mid-grey, which gives the
black outline between overlapping floors something to be dark against and stops
a tall tower reading as one field of noise. Nothing moves as you scrub.

**Player status.** Along the top of the panel and down its right edge. **Power
leads, on its own line above the stack**, in full with the game's dot separators
— `1.284.900`, never `1.28M` — being the only figure that needs the width. The
rest run down a narrow column the stack is free to reach under: light keys, dark
keys, pickaxes, gold, gems, held item, each a sprite and a number of at most
four digits. Gems are an amount **spent**, which the row says on hover rather
than in a word. Dark keys, gold and the held item are absent where the game
omits them too.

A **divider** runs under the two header lines, so they read as a heading rather
than as the top of the slider.

**Help.** Behind a **?** at the top-right of the left panel: the keys, and the
two options. It draws over everything, and a click anywhere off it closes it and
does nothing else.

## 5. Presentation

Everything is drawn as the game draws it — the same tiles, the same bitmap
fonts, whole-number scaling, no smoothing, so pixels stay square at any window
size. The game's pixel-perfect and filtered-upscale settings are mirrored here,
but zoom is the app's own, on `+` / `-` with `0` for automatic. The game is
monochrome apart from the player, and so are we: the player carries the game's
own cyan tint. Every other colour is ours, and belongs to what the game does not
draw — the trail and the editing marks now, the overlays later.

## 6. Editing

A route acts on the same cell more than once — walking a spike tile twice,
back through a one-way — so a badge on the floor cannot say *which* of those
actions it means. The **action list**, right of the slider, is what makes an
edit unambiguous: a window of the route centred on the current action, which
wears a thin lavender outline. Time runs upward, as it does on the slider.

A row is what the action **did**, not where, in fixed columns so the list reads
down: its number, what it **spent**, what it **acted on** with its own value
badge, the gold it moved stamped on a bag — negative at a Money Gate, the only
thing that takes gold away — and last what it was **carrying** that changed the
outcome without being used up. Spent comes first because that is what a failure
is usually about. An added action wears a `+` beside its checkbox, at full
strength even when switched off. Hovering a row highlights it on the timeline;
the wheel moves the selection from anywhere on screen, so the pointer can
already be over the tile you mean to click.

**Every edit happens at the current action**, which is why there are no modes.
The route's name sits in the toolbar and can be edited there: what was imported
is named for a save slot, and what the player builds is theirs to name.

- A row's checkbox switches its action off. Unticked it fills dim red, so a
  disabled action can be found by scanning the column; the row greys out but
  keeps its number and its place on the slider, and scrubs through unchanged.
- **Inserting is a click on a floor cell**, and it lands directly after the
  current action. Hovering a cell shows the `+` badge on it and a preview row
  offset up and to the right of the current one — where it would land — outlined
  in the **blue** that means *the player added this*, green being taken by *the
  route passes*. A cell that implies no action shows nothing at all; one the
  rules would refuse shows the **no-entry sign**.
- `Z` and `Y` undo and redo insertions, as the game's own undo and redo do.
  They reach back over the current run of them and no further: insert four
  here, scrub away, insert four there, and `Z` takes back four.
- Clicking a row moves to it and **that row does not move**: the list shifts
  around it. Dragging on from there holds the rows still and **keeps the current
  action under the cursor**, so the row being aimed at is the row landed on.

The current action is drawn as an **action**, not as a position. The player
stands where it acts *from*, so the affected tile is visible — that being the
square the auto-pather leaves them on, **adjacent to the target**, and not
wherever the previous action ended, which for an inserted action is usually a
different square and often a different floor. **One box covers both squares** —
the one stood on and the one acted on, so neither wears a second frame — and
the target is knocked askew, as though shoved aside. Its row is repeated at the right of that
floor's name strip, joined to the player by a thick line: a display, not a
control, in the strip rather than over the grid so it never covers a cell worth
clicking, and without its number, which the list already carries.

**Where it fails**, the target is left square and whole — it has not been
knocked anywhere — and the player ring, the connecting line, the summary's frame
and the floor's own frame all turn red. The row is outlined red too, whether or
not it is the one being looked at, and its **spent** column says what it was
short of: a bag reading **-21** for gold in red ink — the digits themselves,
not a red block behind them — the player with a power deficit to four figures, a
boxed key or pickaxe where there is no number to give, an arrow where the square
cannot be reached at all. The whole failing stretch is outlined
as well as banded — the band has to stay faint enough to read through, and faint
is not enough to say where the stretch begins.

**Past** a failure everything is drawn as usual but in grey: those actions
*would* happen and cannot. The floors keep coming, so the route can be scrubbed
to its end — the document knows every action's target whether the simulator
reached it or not. Those rows carry a faint red band and their icons say what
they would have done; after a break the numbers are guesses, and drawing nothing
would say less than drawing the intent.

An action that finds its work already done — inserted before one that kills the
same enemy — says nothing but its number, and is not exported.

Anything that changes the document sets the **unsaved-changes marker**, in the
toolbar and the tab title; scrubbing and the option toggles do neither. **Save
`.ord`** clears it. **Export `.sav`** writes a fresh, uniquely named file, never
an overwrite, and refuses a route that fails. Segments have their own
affordances — split, merge, alternatives, skippable — and they are **off**
while adding and removing actions is the thing being learned.

## 7. Open questions

Answered ones move out — to `DECISIONS.md` if the reasoning matters, else above.

- **The trail is anti-aliased and the stack filtered**, where the game is not.
- **The toolbar is wider than it needs to be.** It stops at the left panel now;
  what is in it could move, and then it need not be a strip at all.
- **How big the stack should be**, and whether overlapped floors stay legible on
  a 32- or 75-floor tower.
- **Freezing past and future floors** as you scrub: the past at its final state,
  the future at its initial one.
- **Whether a scroll unit should ever be narrower than the screen.**
- **How a disabled action should be ghosted**, in the list and on the floor.
- **How wide the action list wants to be**, and how many rows it shows.
