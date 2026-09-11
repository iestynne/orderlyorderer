// Writing the export, through the File System Access API.
//
// `[F]` **Chromium refuses `%APPDATA%`** — "can't open this folder because it
// contains system files" — so the savestates folder cannot be reached from a
// browser at all, and this app never sees the file the game reads. Verified by
// iestyn, 2026-09-09.
//
// `[D]` So the app writes only into folders it created, and the player copies
// files across themselves — copies, never moves: the source is the reference
// they fall back to. No instruction here names a platform; the game ships for
// one, but nothing in this module depends on which file manager the player has.
//
// `[I]` iestyn: filesystem operations are more reliable than any code either of
// us would write for this, and a copy he performs is one he can see. That
// removes the backup, the verify-and-restore and the writing-into-someone-
// else's-file, and what is left cannot damage a save because it never opens one
// for writing.
//
// The shape:
//
//   tos_backups/                          the player picks this
//     savestates-2026-09-10/              their own copy, made by hand
//     savestates-2026-09-10-ORD_EXPORT/   ours, named for the copy it came from
//
// `[D]` The export folder is a **sibling** of the snapshot, never inside it. The
// API cannot reach a picked folder's parent, which is why the player picks the
// container rather than the copy — and `[F]` a directory inside `savestates`
// becomes a 1-byte `.sav` of the same name once Steam Cloud sees it
// (`SAVE_FORMAT.md` §8) — Steam Cloud corrupts any folder placed in there — so
// a nested export folder would plant a broken save on the next restore.
//
// `[D]` **Only the towers actually exported are copied in.** Every file in the
// export folder is then one the player deliberately put there, so copying the
// folder across cannot roll back a tower they only played. `[I]` iestyn.
//
// `[D]` **No staleness detection.** The app cannot see the master folder, so any
// check it ran would prove less than it implied — and an over-promised safety
// property is worse than an absent one. The protocol is offered; following it is
// the player's. `[I]` iestyn, 2026-09-10: anticipating how others will want to
// use this is a fool's errand short of handing it out and asking them.

import { InjectRefused, injectRecord, ordName } from "../sav/inject";
import { parseSaveFile, type Entry } from "../sav/savefile";

/** `[I]` A suffix, not a prefix, so a snapshot and its export sort together. */
const SUFFIX = "-ORD_EXPORT";

/**
 * `[D]` A date in the snapshot's folder name is required, not suggested. It is
 * the whole difference between a backup and a second copy of the thing about to
 * change, and the player is the only one who can tell them apart later.
 *
 * `[F]` Both orders, because there is no universal one: a four-digit year with
 * two shorter groups after it, or two shorter groups before it, separated by
 * any single non-digit or by nothing. `2026-09-10`, `10-09-2026`, `09/10/2026`
 * and `20260910` all pass; a bare `2026` does not, since a year is not a date.
 * `[D]` It is only ever about being identifiable later — the *ordering* comes
 * from the files' own timestamps (`Backup.modified`), never from the name.
 */
export const STAMPED = /\d{4}\D?\d{1,2}\D?\d{1,2}|\d{1,2}\D?\d{1,2}\D?\d{4}/;

/**
 * `[D]` The export folder is **named for the snapshot it was built from**, so
 * which is which survives being looked at a week later, and a new snapshot
 * starts a new export folder rather than quietly joining an old one. `[I]`
 * iestyn: it also pushes towards taking snapshots often, which is the protocol.
 */
export const exportDirFor = (snapshot: string): string => `${snapshot}${SUFFIX}`;

export interface Backup {
  name: string;
  handle: FileSystemDirectoryHandle;
  /** Tower ids, from `<id>.sav`. Sorted; empty for a folder holding none. */
  towers: string[];
  stamped: boolean;
  /**
   * When this snapshot's newest save was last written, or `null` if it holds
   * none. `[D]` The authority on which copy is most recent — a folder *name*
   * cannot be, since `10-09-2026` and `2026-09-10` sort differently and mean
   * the same day. The name rule stays, because it is what makes a backup
   * identifiable to the player months later; it just is not the clock.
   */
  modified: number | null;
  /** Holds the most recently written save here. A newer one means the game ran. */
  newest: boolean;
}

export interface Container {
  backups: Backup[];
  /**
   * The picked folder holds `.sav` files itself, so it is a snapshot rather
   * than the folder snapshots live in. `[I]` iestyn walked into this on the
   * first run, and the message he got was about the folder being empty.
   */
  isSnapshot: boolean;
}

export interface Exported {
  folder: string;
  from: string;
  /** What the record ended up called, which is not always what was asked for. */
  name: string;
  /** True when the route joined a file this folder already held. */
  accumulated: boolean;
  /** Tower ids now in the export folder. */
  towers: string[];
  records: number;
}

export class ExportFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailed";
  }
}

export const canPickFolder = (): boolean => "showDirectoryPicker" in window;

/**
 * The `tos_backups` container, or `null` if this browser cannot ask or the
 * player declined. Neither is an error.
 */
export async function pickBackupRoot(): Promise<FileSystemDirectoryHandle | null> {
  const show = (window as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (show === undefined) return null;
  try {
    return await show.call(window, { id: "tos-backups", mode: "readwrite" });
  } catch {
    return null;
  }
}

interface Dir {
  entries: () => AsyncIterable<[string, { kind: string }]>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
}

const as = (d: FileSystemDirectoryHandle): Dir => d as unknown as Dir;

async function savesIn(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of as(dir).entries()) {
    if (h.kind === "file" && name.endsWith(".sav")) out.push(name.slice(0, -4));
  }
  return out.sort();
}

/**
 * When the newest `.sav` in here was last written.
 *
 * `[O]` Costs one `getFile` per save — metadata, not a read — so a container of
 * 100 snapshots is ~1 400 of them, on a list the player opens by hand. Not
 * measured on a real folder that size. If it ever bites, the lever is statting
 * one save per folder rather than all of them: the whole point is ranking
 * folders against each other, and within a snapshot they were all written at
 * once.
 */
async function newestSaveIn(dir: FileSystemDirectoryHandle, towers: string[]): Promise<number | null> {
  let at: number | null = null;
  for (const id of towers) {
    const { lastModified } = await (await as(dir).getFileHandle(`${id}.sav`)).getFile();
    if (at === null || lastModified > at) at = lastModified;
  }
  return at;
}

async function read(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await (await as(dir).getFileHandle(name)).getFile()).arrayBuffer());
}

async function write(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const w = await (await as(dir).getFileHandle(name, { create: true })).createWritable();
  await w.write(new Uint8Array(bytes).buffer.slice(0));
  await w.close();
}

async function subdir(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  for await (const [n, h] of as(root).entries()) {
    if (n === name && h.kind === "directory") return h as unknown as FileSystemDirectoryHandle;
  }
  return null;
}

/**
 * What is in the picked folder: every subfolder that is not one of our own
 * exports, and whether the player picked a snapshot by mistake.
 *
 * `[D]` **Every candidate is listed, including the empty and the undated.** A
 * folder missing from the list explains nothing; a folder present with the
 * reason beside it explains itself. `[I]` iestyn: the rules should guide
 * without being frustrating or misleading, and a silent omission is both.
 */
export async function readContainer(root: FileSystemDirectoryHandle): Promise<Container> {
  const backups: Omit<Backup, "newest">[] = [];
  let isSnapshot = false;
  for await (const [name, h] of as(root).entries()) {
    if (h.kind === "file") {
      isSnapshot ||= name.endsWith(".sav");
      continue;
    }
    if (name.endsWith(SUFFIX)) continue;
    const handle = h as unknown as FileSystemDirectoryHandle;
    const towers = await savesIn(handle);
    backups.push({ name, handle, towers, stamped: STAMPED.test(name), modified: await newestSaveIn(handle, towers) });
  }
  // `[D]` Newest first, which is the one the player almost always wants, with
  // the saveless folders last. `[F]` Compared by code unit rather than
  // `localeCompare`: the tie-break has to be the same everywhere, and a locale
  // that sorts `-` and `_` differently would otherwise reorder the list.
  backups.sort((a, b) => (b.modified ?? -1) - (a.modified ?? -1) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const latest = backups[0]?.modified ?? null;
  return { isSnapshot, backups: backups.map((b) => ({ ...b, newest: b.modified !== null && b.modified === latest })) };
}

/**
 * Add this route to the export folder for `from`, creating it if needed and
 * bringing in `towerId`'s save the first time that tower is exported.
 *
 * `[D]` **A second route joins the file already there** rather than rebuilding
 * from the snapshot, which would have dropped the first. So several routes may
 * be exported in a sitting and copied across in one action — sound exactly as
 * long as the game has not run since the snapshot was taken, which is what the
 * newest-snapshot flag is for.
 *
 * `[D]` **A name already in the target file refuses.** `ordName` steps around
 * an earlier export of the same route with a counter, so reaching the refusal
 * means the name came from somewhere else and replacing it would lose a route.
 */
export async function exportInto(
  root: FileSystemDirectoryHandle,
  from: Backup,
  towerId: string,
  base: string,
  entries: Entry[],
  deflate?: Parameters<typeof injectRecord>[4],
): Promise<Exported> {
  if (!from.stamped) {
    throw new ExportFailed(
      `${JSON.stringify(from.name)} has no date in its name, so nothing will tell it from any other copy later. ` +
        "Rename it with today's date and pick it again.",
    );
  }
  if (!from.towers.includes(towerId)) {
    throw new ExportFailed(`${from.name} holds no ${towerId}.sav — it has ${from.towers.join(", ") || "no saves"}.`);
  }

  const folder = exportDirFor(from.name);
  const existing = await subdir(root, folder);
  const out = existing ?? (await as(root).getDirectoryHandle(folder, { create: true }));
  const held = existing === null ? [] : await savesIn(existing);

  // The first route for a tower starts from the snapshot; later ones join what
  // is already here, so nothing exported earlier is dropped.
  const accumulated = held.includes(towerId);
  const before = await read(accumulated ? out : from.handle, `${towerId}.sav`);
  const original = parseSaveFile(before);
  // `[F]` This cannot collide, and both halves are load-bearing: `ordName` steps
  // around every name already in the file, and the `ORD:` prefix is unreachable
  // from the game's keyboard, so a game-written name is not one it has to step
  // around. `injectRecord` refuses a duplicate anyway, at the container level,
  // which is where a silent replacement would actually happen.
  const name = ordName(base, new Set(original.records.map((r) => r.name)));
  await write(out, `${towerId}.sav`, injectRecord(before, name, entries, undefined, deflate));

  // The proof, read from disk rather than from what we meant to write. Nothing
  // here can have harmed a save — every file named is one we created — so a
  // failure is reported and the folder left alone for inspection.
  const re = parseSaveFile(await read(out, `${towerId}.sav`));
  if (re.records.length !== original.records.length + 1) {
    throw new ExportFailed(`${folder}/${towerId}.sav has ${re.records.length} records, expected ${original.records.length + 1}`);
  }
  original.records.forEach((r, i) => {
    const got = re.records[i]!;
    if (got.name !== r.name || JSON.stringify(got.entries) !== JSON.stringify(r.entries)) {
      throw new ExportFailed(`${folder}/${towerId}.sav lost or altered ${JSON.stringify(r.name)}`);
    }
  });
  if (re.records.at(-1)!.name !== name) {
    throw new ExportFailed(`${JSON.stringify(name)} is not the last record of ${folder}/${towerId}.sav`);
  }
  return { folder, from: from.name, name, accumulated, towers: await savesIn(out), records: re.records.length };
}
