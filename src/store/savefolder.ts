// Writing the export, through the File System Access API.
//
// `[F]` **Chromium refuses `%APPDATA%`** — "can't open this folder because it
// contains system files" — so the savestates folder cannot be reached from a
// browser at all, and this app never sees the file the game reads. Verified by
// iestyn, 2026-09-09.
//
// `[D]` So the app writes only into folders it created, and the player copies
// files with Explorer -- copies, never moves: the source is the reference the
// player falls back to. `[I]` iestyn: filesystem operations are more reliable
// than any code either of us would write for this, and a copy he performs is
// one he can see. That removes the backup, the verify-and-restore and the
// writing-into-someone-else's-file, and what is left cannot damage a save
// because it never opens one for writing.
//
// The shape:
//
//   tos_backups/                        <- the player picks this
//     savestates_2026-09-09T2314/       <- their own copy, made in Explorer
//     savestates_ORD_EXPORT/            <- ours: every .sav, one with the route
//
// `[D]` The export folder is a **sibling** of the backup, never inside it. The
// API cannot reach a picked folder's parent, which is why the player picks the
// container rather than the copy — and `[F]` a directory inside `savestates`
// becomes a 1-byte `.sav` of the same name once Steam Cloud sees it
// (`SAVE_FORMAT.md` §8), so a nested export folder would plant a junk save on
// the next restore.

import { injectRecord, ordName } from "../sav/inject";
import { parseSaveFile, type Entry } from "../sav/savefile";

export const EXPORT_DIR = "savestates_ORD_EXPORT";

/**
 * `[D]` A date in the folder name is required, not suggested. It is the whole
 * difference between a backup and a second copy of the thing you are about to
 * change, and the player is the only one who can tell them apart later.
 */
export const STAMPED = /\d{4}.?\d{2}.?\d{2}|\d{8,}/;

export interface Backup {
  name: string;
  handle: FileSystemDirectoryHandle;
  /** Tower ids, from `<id>.sav`. Sorted. */
  towers: string[];
  stamped: boolean;
}

export interface Exported {
  folder: string;
  from: string;
  /** What the record ended up called, which is not always what was asked for. */
  name: string;
  copied: number;
  records: number;
  bytesBefore: number;
  bytesAfter: number;
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
  removeEntry: (name: string) => Promise<void>;
}

const as = (d: FileSystemDirectoryHandle): Dir => d as unknown as Dir;

async function savesIn(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, h] of as(dir).entries()) {
    if (h.kind === "file" && name.endsWith(".sav")) out.push(name.slice(0, -4));
  }
  return out.sort();
}

async function read(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await (await as(dir).getFileHandle(name)).getFile()).arrayBuffer());
}

async function write(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const w = await (await as(dir).getFileHandle(name, { create: true })).createWritable();
  await w.write(new Uint8Array(bytes).buffer.slice(0));
  await w.close();
}

/**
 * What is already sitting in `savestates_ORD_EXPORT`, or `null` if it is not
 * there. `[D]` Read before the export screen offers to write, because the
 * player is the only one who knows whether they have copied it across yet.
 */
export async function existingExport(root: FileSystemDirectoryHandle): Promise<string[] | null> {
  for await (const [name, h] of as(root).entries()) {
    if (name === EXPORT_DIR && h.kind === "directory") {
      return (await savesIn(h as unknown as FileSystemDirectoryHandle)).map((t) => `${t}.sav`);
    }
  }
  return null;
}

/**
 * Every subfolder of the container that holds `.sav` files, each flagged for
 * whether its name carries a date.
 *
 * `[D]` Unstamped candidates are listed rather than hidden, so the rule can be
 * shown to the player rather than only enforced against them.
 */
export async function listBackups(root: FileSystemDirectoryHandle): Promise<Backup[]> {
  const out: Backup[] = [];
  for await (const [name, h] of as(root).entries()) {
    if (h.kind !== "directory" || name === EXPORT_DIR) continue;
    const handle = h as unknown as FileSystemDirectoryHandle;
    const towers = await savesIn(handle);
    if (towers.length > 0) out.push({ name, handle, towers, stamped: STAMPED.test(name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy every `.sav` in `from` into a fresh `savestates_ORD_EXPORT` beside it,
 * with one record added to the one named for `towerId`.
 *
 * `[D]` **Every save is copied, not only the edited one**, so the player copies
 * a whole folder's contents across in one action rather than picking one file
 * out of it. The copies are byte-identical; the target file differs only by its
 * record count and one appended record.
 *
 * `[D]` **Refuses when the export folder already exists, unless `replace`.** That
 * state means a previous export has not been copied across yet, and rebuilding
 * the folder from the backup would discard it — this export starts from the
 * backup, so a route added last time is not in it. The caller sets `replace`
 * only after saying that to the player.
 *
 * `[O]` The alternative is to accumulate: inject into the export folder's own
 * copy when it already holds the tower, so several routes pile up and cross in
 * one action. `[D]` Not built — safe and less convenient first (iestyn,
 * 2026-09-10), with the risk noted that inconvenience invites shortcuts.
 */
export async function exportInto(
  root: FileSystemDirectoryHandle,
  from: Backup,
  towerId: string,
  base: string,
  entries: Entry[],
  opts: { replace?: boolean; deflate?: Parameters<typeof injectRecord>[4] } = {},
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
  const already = await existingExport(root);
  if (already !== null && opts.replace !== true) {
    throw new ExportFailed(
      `${EXPORT_DIR} already holds ${already.length} files. Copy them into your savestates folder first — ` +
        "this export is built from your backup, so a route added last time is not in it.",
    );
  }

  const before = await read(from.handle, `${towerId}.sav`);
  const original = parseSaveFile(before);
  // `[D]` Resolved here, because here is the only place that knows what the
  // file already holds. An earlier export of the same route is a collision the
  // player should not have to think about; a counter settles it.
  const name = ordName(base, new Set(original.records.map((r) => r.name)));
  const after = injectRecord(before, name, entries, undefined, opts.deflate);

  const out = await as(root).getDirectoryHandle(EXPORT_DIR, { create: true });
  // `[D]` Emptied rather than written over: a save left behind from a previous
  // export would look like part of this one and would not be.
  for (const stale of already ?? []) await as(out).removeEntry(stale);
  for (const id of from.towers) {
    await write(out, `${id}.sav`, id === towerId ? after : await read(from.handle, `${id}.sav`));
  }

  // The proof, read from disk rather than from what we meant to write. Nothing
  // here can have harmed a save — every file named is one just created — so a
  // failure is reported and the folder left alone for inspection.
  const written = await read(out, `${towerId}.sav`);
  const re = parseSaveFile(written);
  if (re.records.length !== original.records.length + 1) {
    throw new ExportFailed(
      `${EXPORT_DIR}/${towerId}.sav has ${re.records.length} records, expected ${original.records.length + 1}`,
    );
  }
  original.records.forEach((r, i) => {
    const got = re.records[i]!;
    if (got.name !== r.name || JSON.stringify(got.entries) !== JSON.stringify(r.entries)) {
      throw new ExportFailed(`${EXPORT_DIR}/${towerId}.sav lost or altered ${JSON.stringify(r.name)}`);
    }
  });
  if (re.records[re.records.length - 1]!.name !== name) {
    throw new ExportFailed(`${JSON.stringify(name)} is not the last record of ${EXPORT_DIR}/${towerId}.sav`);
  }
  return {
    folder: EXPORT_DIR,
    from: from.name,
    name,
    copied: from.towers.length,
    records: re.records.length,
    bytesBefore: before.length,
    bytesAfter: written.length,
  };
}
