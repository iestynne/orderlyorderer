// The export flow, driven against an in-memory folder tree.
//
// `[D]` A fake tree rather than a browser: what is worth testing is the
// refusals, and a real folder cannot be made to be wrong on demand. SPEC-009's
// harness covers what needs a browser.
//
// `[F]` Nothing here can damage a save. The app cannot reach the savestates
// folder at all (Chromium refuses `%APPDATA%`), so every file it opens for
// writing is one it just created.

import { describe, expect, it } from "vitest";
import { InjectRefused, injectRecord, ordName } from "../../src/sav/inject";
import { parseSaveFile } from "../../src/sav/savefile";
import { ExportFailed, STAMPED, exportDirFor, exportInto, exportedSoFar, listBackups } from "../../src/store/savefolder";
import { haveSaves, loadAllSaves } from "./helpers";

/** A directory tree of `Uint8Array` leaves, shaped like the real handles. */
function fakeTree(seed: Record<string, Record<string, Uint8Array>>) {
  const dirs = new Map<string, Map<string, Uint8Array>>(
    Object.entries(seed).map(([d, files]) => [d, new Map(Object.entries(files))]),
  );
  const dirHandle = (self: string): unknown => ({
    entries: async function* () {
      if (self === "") {
        for (const name of dirs.keys()) yield [name, { kind: "directory", ...(dirHandle(name) as object) }];
      } else {
        for (const name of dirs.get(self)!.keys()) yield [name, { kind: "file" }];
      }
    },
    getDirectoryHandle: (name: string, opts?: { create?: boolean }) => {
      if (!dirs.has(name)) {
        if (opts?.create !== true) return Promise.reject(new Error(`no such directory ${name}`));
        dirs.set(name, new Map());
      }
      return Promise.resolve(dirHandle(name));
    },
    removeEntry: (name: string) => {
      dirs.get(self)!.delete(name);
      return Promise.resolve();
    },
    getFileHandle: (name: string, opts?: { create?: boolean }) => {
      const files = dirs.get(self)!;
      if (!files.has(name) && opts?.create !== true) return Promise.reject(new Error(`no such file ${name}`));
      return Promise.resolve({
        getFile: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(files.get(name)!.slice().buffer) }),
        createWritable: () =>
          Promise.resolve({
            write: (b: ArrayBuffer) => {
              files.set(name, new Uint8Array(b));
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      });
    },
  });
  return { root: dirHandle("") as FileSystemDirectoryHandle, dirs };
}

const d = haveSaves ? describe : describe.skip;

d("exportInto", () => {
  const all = (): { id: string; bytes: Uint8Array }[] =>
    loadAllSaves().slice(0, 3).map((s2) => ({ id: s2.towerId, bytes: s2.bytes }));
  const snapshot = (): Record<string, Uint8Array> =>
    Object.fromEntries(all().map((t) => [`${t.id}.sav`, t.bytes]));
  const DIR = exportDirFor("savestates_2026-09-10");

  it("brings in only the tower being exported, and names the folder for its source", async () => {
    const { root, dirs } = fakeTree({ "savestates_2026-09-10": snapshot() });
    const [backup] = await listBackups(root);
    const target = all()[0]!;
    const out = await exportInto(root, backup!, target.id, "my route", [[1, 5, 5]]);

    expect(out.folder).toBe(DIR);
    expect(out.name).toBe("ORD:my route");
    expect(out.accumulated).toBe(false);
    // Only the exported tower is there: copying this folder across cannot roll
    // back a tower the player merely played.
    expect([...dirs.get(DIR)!.keys()]).toEqual([`${target.id}.sav`]);

    const re = parseSaveFile(dirs.get(DIR)!.get(`${target.id}.sav`)!);
    expect(re.records.length).toBe(parseSaveFile(target.bytes).records.length + 1);
    expect(re.records.at(-1)!.name).toBe("ORD:my route");
  });

  it("gathers later routes into the same file rather than rebuilding from the snapshot", async () => {
    const { root, dirs } = fakeTree({ "savestates_2026-09-10": snapshot() });
    const [backup] = await listBackups(root);
    const target = all()[0]!;
    const base = parseSaveFile(target.bytes).records.length;

    const first = await exportInto(root, backup!, target.id, "one", [[1, 5, 5]]);
    const second = await exportInto(root, backup!, target.id, "two", [[1, 6, 6]]);
    expect([first.accumulated, second.accumulated]).toEqual([false, true]);
    expect(second.records).toBe(base + 2);

    const names = parseSaveFile(dirs.get(DIR)!.get(`${target.id}.sav`)!).records.map((r) => r.name);
    expect(names.slice(-2)).toEqual(["ORD:one", "ORD:two"]);
  });

  it("adds a second tower beside the first without disturbing it", async () => {
    const { root, dirs } = fakeTree({ "savestates_2026-09-10": snapshot() });
    const [backup] = await listBackups(root);
    await exportInto(root, backup!, all()[0]!.id, "one", [[1, 5, 5]]);
    const out = await exportInto(root, backup!, all()[1]!.id, "two", [[1, 5, 5]]);

    expect(out.accumulated).toBe(false);
    expect(out.towers).toEqual([all()[0]!.id, all()[1]!.id].sort());
    expect(parseSaveFile(dirs.get(DIR)!.get(`${all()[0]!.id}.sav`)!).records.at(-1)!.name).toBe("ORD:one");
  });

  it("steps around its own earlier export, and cannot collide with the game's", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": snapshot() });
    const [backup] = await listBackups(root);
    const id = all()[0]!.id;
    expect((await exportInto(root, backup!, id, "dup", [[1, 5, 5]])).name).toBe("ORD:dup");
    expect((await exportInto(root, backup!, id, "dup", [[1, 5, 5]])).name).toBe("ORD:dup 2");

    // Asking for a name the game already wrote does not replace it: the ORD:
    // prefix puts the result in a namespace the game's keyboard cannot reach.
    const taken = parseSaveFile(all()[0]!.bytes).records[0]!.name;
    const out = await exportInto(root, backup!, id, taken, [[1, 5, 5]]);
    expect(out.name).not.toBe(taken);
    expect(out.name.startsWith("ORD:")).toBe(true);
  });

  it("refuses rather than replaces if a duplicate ever reaches the container", () => {
    // The guard that matters, at the level where a silent replacement would
    // happen. Unreachable through exportInto by construction; asserted here so
    // it stays true of injectRecord itself.
    const bytes = all()[0]!.bytes;
    const taken = parseSaveFile(bytes).records[0]!.name;
    expect(() => injectRecord(bytes, taken, [[1, 5, 5]])).toThrow(InjectRefused);
  });

  it("refuses a snapshot with no date in its name, and writes nothing", async () => {
    const { root, dirs } = fakeTree({ savestates_copy: snapshot() });
    const [backup] = await listBackups(root);
    expect(backup!.stamped).toBe(false);
    await expect(exportInto(root, backup!, all()[0]!.id, "r", [[1, 5, 5]])).rejects.toThrow(ExportFailed);
    expect(dirs.has(exportDirFor("savestates_copy"))).toBe(false);
  });

  it("refuses a snapshot that does not hold the tower being exported", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": { "EX-2.sav": all()[0]!.bytes } });
    const [backup] = await listBackups(root);
    await expect(exportInto(root, backup!, "2-5", "r", [[1, 5, 5]])).rejects.toThrow(/holds no 2-5.sav/);
  });

  it("flags only the most recent dated snapshot as newest, and never lists its own folders", async () => {
    const { root } = fakeTree({
      "savestates_2026-09-08": snapshot(),
      "savestates_2026-09-10": snapshot(),
      savestates_undated: snapshot(),
      [DIR]: snapshot(),
      empty: {},
    });
    const found = await listBackups(root);
    expect(found.map((b) => b.name)).toEqual(["savestates_2026-09-08", "savestates_2026-09-10", "savestates_undated"]);
    expect(found.map((b) => b.newest)).toEqual([false, true, false]);
  });

  it("reports what a snapshot has already had exported", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": snapshot() });
    expect(await exportedSoFar(root, "savestates_2026-09-10")).toBeNull();
    const [backup] = await listBackups(root);
    await exportInto(root, backup!, all()[0]!.id, "r", [[1, 5, 5]]);
    expect(await exportedSoFar(root, "savestates_2026-09-10")).toEqual([all()[0]!.id]);
  });
});

describe("names", () => {
  it("wants a date in a backup folder name, in the shapes a person writes one", () => {
    for (const ok of ["savestates_2026-09-10", "savestates 20260910", "backup.2026.09.10", "sav_20260910T2314"]) {
      expect(STAMPED.test(ok), ok).toBe(true);
    }
    for (const no of ["savestates", "savestates_copy", "backup", "saves v2"]) {
      expect(STAMPED.test(no), no).toBe(false);
    }
  });

  it("fits ORD: names into the game's 24 and breaks collisions with a counter", () => {
    expect(ordName("98.3M win H [A]", new Set())).toBe("ORD:98.3M win H [A]");
    expect(ordName("a route name far longer than the game allows", new Set()).length).toBe(24);
    expect(ordName("dup", new Set(["ORD:dup"]))).toBe("ORD:dup 2");
    expect(ordName("dup", new Set(["ORD:dup", "ORD:dup 2"]))).toBe("ORD:dup 3");
    // A colon cannot come from a route name, so it cannot be doubled.
    expect(ordName("ORD:already", new Set())).toBe("ORD:ORDalready");
  });
});
