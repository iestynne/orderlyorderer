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
import { ordName } from "../../src/sav/inject";
import { parseSaveFile } from "../../src/sav/savefile";
import { EXPORT_DIR, ExportFailed, STAMPED, existingExport, exportInto, listBackups } from "../../src/store/savefolder";
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
  const corpus = (): Record<string, Uint8Array> => {
    const out: Record<string, Uint8Array> = {};
    for (const { towerId, bytes } of loadAllSaves().slice(0, 3)) out[`${towerId}.sav`] = bytes;
    return out;
  };
  const towers = (): string[] => loadAllSaves().slice(0, 3).map((s) => s.towerId);

  it("copies every save into a new folder, with the route added to one", async () => {
    const { root, dirs } = fakeTree({ "savestates_2026-09-10": corpus() });
    const [backup] = await listBackups(root);
    const target = towers()[0]!;
    const out = await exportInto(root, backup!, target, "my route", [[1, 5, 5]]);

    expect(out.folder).toBe(EXPORT_DIR);
    expect(out.copied).toBe(towers().length);
    expect(out.name).toBe("ORD:my route");

    const written = dirs.get(EXPORT_DIR)!;
    expect([...written.keys()].sort()).toEqual(towers().map((t) => `${t}.sav`).sort());
    // Untouched towers are byte-identical; the target gained exactly one record.
    for (const t of towers().slice(1)) {
      expect(Buffer.from(written.get(`${t}.sav`)!).equals(Buffer.from(corpus()[`${t}.sav`]!)), t).toBe(true);
    }
    const re = parseSaveFile(written.get(`${target}.sav`)!);
    expect(re.records.length).toBe(parseSaveFile(corpus()[`${target}.sav`]!).records.length + 1);
    expect(re.records.at(-1)!.name).toBe("ORD:my route");
  });

  it("refuses a backup folder with no date in its name, and writes nothing", async () => {
    const { root, dirs } = fakeTree({ savestates_copy: corpus() });
    const [backup] = await listBackups(root);
    expect(backup!.stamped).toBe(false);
    await expect(exportInto(root, backup!, towers()[0]!, "r", [[1, 5, 5]])).rejects.toThrow(ExportFailed);
    expect(dirs.has(EXPORT_DIR)).toBe(false);
  });

  it("refuses a previous export that has not been copied across, unless told to replace", async () => {
    const stale = { "1-1.sav": corpus()[`${towers()[0]!}.sav`]!, "9-9.sav": corpus()[`${towers()[0]!}.sav`]! };
    const { root, dirs } = fakeTree({ "savestates_2026-09-10": corpus(), [EXPORT_DIR]: stale });
    const backup = (await listBackups(root)).find((b) => b.name !== EXPORT_DIR)!;

    await expect(exportInto(root, backup, towers()[0]!, "r", [[1, 5, 5]])).rejects.toThrow(/already holds 2 files/);
    expect([...dirs.get(EXPORT_DIR)!.keys()].sort()).toEqual(["1-1.sav", "9-9.sav"]);

    await exportInto(root, backup, towers()[0]!, "r", [[1, 5, 5]], { replace: true });
    // Emptied, not written over: 9-9.sav was not in the backup and must be gone,
    // or it would read as part of this export and is not.
    expect([...dirs.get(EXPORT_DIR)!.keys()].sort()).toEqual(towers().map((t) => `${t}.sav`).sort());
  });

  it("reports what is already in the export folder, before offering to write", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": corpus() });
    expect(await existingExport(root)).toBeNull();
    const { root: root2 } = fakeTree({ "savestates_2026-09-10": corpus(), [EXPORT_DIR]: corpus() });
    expect((await existingExport(root2))!.sort()).toEqual(towers().map((t) => `${t}.sav`).sort());
  });

  it("refuses a backup that does not hold the tower being exported", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": { "EX-2.sav": corpus()[`${towers()[0]!}.sav`]! } });
    const [backup] = await listBackups(root);
    await expect(exportInto(root, backup!, "2-5", "r", [[1, 5, 5]])).rejects.toThrow(/holds no 2-5\.sav/);
  });

  it("lists the export folder as a candidate never, and empty folders never", async () => {
    const { root } = fakeTree({ "savestates_2026-09-10": corpus(), [EXPORT_DIR]: corpus(), empty: {} });
    expect((await listBackups(root)).map((b) => b.name)).toEqual(["savestates_2026-09-10"]);
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
