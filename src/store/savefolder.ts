// Writing a route into the player's own `.sav`, through the File System Access
// API. The one place this app touches a file it did not create.
//
// `[D]` A directory handle rather than a file handle, and the difference is the
// backup: a file handle can write only the file it names, so the backup would
// land in Downloads while the thing it protects lives elsewhere. One grant on
// `savestates/` lets us copy the original aside, write, and read back what we
// wrote — none of which is possible through a download.
//
// `[F]` Chromium only. Firefox and Safari have no `showDirectoryPicker`, and
// Chromium itself refuses some folders outright; `pickSaveFolder` reports both
// as `null` rather than throwing, and the caller falls back to a download.

import { injectRecord, ordName } from "../sav/inject";
import { parseSaveFile, type Entry } from "../sav/savefile";

/** `[F]` Steam syncs `*.sav` in this folder and nothing else (iestyn's tests,
 * `docs/SAVE_FORMAT.md` §8), and the game owns `<tower>.sav.bak`
 * (`save_manager.lua:457`). A backup must be neither. */
export const BACKUP_EXT = "orderly-bak";

export interface Injected {
  /** What the record ended up called, which is not always what was asked for. */
  name: string;
  backup: string;
  bytesBefore: number;
  bytesAfter: number;
  records: number;
}

export class ExportFailed extends Error {
  /** `[D]` Whether the player's file is as it was. False only if restore failed. */
  readonly restored: boolean;
  constructor(message: string, restored: boolean) {
    super(message);
    this.name = "ExportFailed";
    this.restored = restored;
  }
}

interface Dir {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

/**
 * The savestates folder, or `null` if this browser cannot ask or the player
 * declined. `[D]` `id` makes Chromium reopen where it left off, so the folder
 * is found once rather than every export.
 */
export async function pickSaveFolder(): Promise<FileSystemDirectoryHandle | null> {
  const show = (window as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (show === undefined) return null;
  try {
    return await show.call(window, { id: "tos-savestates", mode: "readwrite" });
  } catch {
    // Declined, or a folder Chromium will not hand over. Neither is an error.
    return null;
  }
}

async function read(dir: Dir, name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
}

async function write(dir: Dir, name: string, bytes: Uint8Array): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(new Uint8Array(bytes).buffer.slice(0));
  await w.close();
}

/** `<tower>.2026-09-09T1830.orderly-bak` — local time, because it is read by a
 * person deciding which one to restore. */
export function backupName(towerId: string, at = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const s = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${towerId}.${s}.${BACKUP_EXT}`;
}

/**
 * Copy the file aside, add one record, and prove afterwards that nothing else
 * moved. The order matters: the backup exists and has been read back before the
 * player's file is opened for writing.
 *
 * `[D]` **The name is `ORD:`-prefixed and made unique against this file**, so
 * `base` is a wish and `Injected.name` is what happened.
 *
 * `[D]` **A failed verification restores from memory, and never deletes the
 * backup.** The bytes we restore from are the ones we read at the start, so a
 * restore does not depend on the backup having worked — and the backup stays
 * regardless, because the case we cannot see is the one where this function
 * never returns at all.
 */
export async function injectIntoSave(
  dir: FileSystemDirectoryHandle,
  towerId: string,
  base: string,
  entries: Entry[],
  deflate?: Parameters<typeof injectRecord>[4],
): Promise<Injected> {
  const file = `${towerId}.sav`;
  const before = await read(dir as unknown as Dir, file);
  const original = parseSaveFile(before);
  // `[D]` Resolved here, because here is the only place that knows what the
  // file already holds. An earlier export of the same route is a collision the
  // player should not have to think about; a counter settles it.
  const name = ordName(base, new Set(original.records.map((r) => r.name)));

  const backup = backupName(towerId);
  await write(dir as unknown as Dir, backup, before);
  const check = await read(dir as unknown as Dir, backup);
  if (check.length !== before.length || check.some((b, i) => b !== before[i])) {
    throw new ExportFailed(`the backup ${backup} did not read back identical; nothing was written`, true);
  }

  const after = injectRecord(before, name, entries, undefined, deflate);
  await write(dir as unknown as Dir, file, after);

  // Everything below is the proof, read from disk rather than from what we
  // meant to write. A failure here has already touched the player's file.
  try {
    const written = await read(dir as unknown as Dir, file);
    const re = parseSaveFile(written);
    if (re.records.length !== original.records.length + 1) {
      throw new Error(`${re.records.length} records on disk, expected ${original.records.length + 1}`);
    }
    original.records.forEach((r, i) => {
      const got = re.records[i]!;
      if (got.name !== r.name) throw new Error(`record ${i} is now ${JSON.stringify(got.name)}, was ${JSON.stringify(r.name)}`);
      if (JSON.stringify(got.entries) !== JSON.stringify(r.entries)) throw new Error(`record ${JSON.stringify(r.name)} changed`);
    });
    if (re.records[re.records.length - 1]!.name !== name) throw new Error(`${JSON.stringify(name)} is not the last record`);
    return { name, backup, bytesBefore: before.length, bytesAfter: written.length, records: re.records.length };
  } catch (e) {
    try {
      await write(dir as unknown as Dir, file, before);
      throw new ExportFailed(`${String(e)} — ${file} has been put back as it was. ${backup} is still there.`, true);
    } catch (restoreFailure) {
      if (restoreFailure instanceof ExportFailed) throw restoreFailure;
      throw new ExportFailed(`${String(e)}, and restoring failed: ${String(restoreFailure)}. Copy ${backup} over ${file} yourself.`, false);
    }
  }
}
