// The export flow's failure paths, driven against an in-memory folder.
//
// `[D]` A fake directory rather than a browser: what is worth testing here is
// what happens when the write goes wrong, and a real folder cannot be made to
// go wrong on demand. SPEC-009's harness covers the parts that need a browser.

import { describe, expect, it } from "vitest";
import { ordName } from "../../src/sav/inject";
import { parseSaveFile } from "../../src/sav/savefile";
import { BACKUP_EXT, ExportFailed, backupName, injectIntoSave } from "../../src/store/savefolder";
import { haveSaves, loadAllSaves } from "./helpers";

/** A folder that can be told to corrupt one named file as it is written. */
function fakeDir(seed: Record<string, Uint8Array>, corrupt?: (name: string, bytes: Uint8Array) => Uint8Array) {
  const files = new Map<string, Uint8Array>(Object.entries(seed));
  const handle = {
    getFileHandle: (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && opts?.create !== true) return Promise.reject(new Error(`no such file ${name}`));
      return Promise.resolve({
        getFile: () => Promise.resolve({ arrayBuffer: () => Promise.resolve(files.get(name)!.slice().buffer) }),
        createWritable: () =>
          Promise.resolve({
            write: (b: ArrayBuffer) => {
              files.set(name, corrupt ? corrupt(name, new Uint8Array(b)) : new Uint8Array(b));
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      });
    },
  };
  return { handle: handle as unknown as FileSystemDirectoryHandle, files };
}

const d = haveSaves ? describe : describe.skip;

d("injectIntoSave", () => {
  const seed = (): Record<string, Uint8Array> => {
    const { towerId, bytes } = loadAllSaves().find((s) => s.towerId === "EX-1")!;
    return { [`${towerId}.sav`]: bytes };
  };

  it("writes the backup before it touches the save, and both survive", async () => {
    const { handle, files } = fakeDir(seed());
    const before = files.get("EX-1.sav")!.slice();
    const out = await injectIntoSave(handle, "EX-1", "test", [[1, 5, 5]]);

    expect(out.records).toBe(11);
    expect(out.backup.endsWith(`.${BACKUP_EXT}`)).toBe(true);
    expect(Buffer.from(files.get(out.backup)!).equals(Buffer.from(before))).toBe(true);
    expect(out.name).toBe("ORD:test");
    expect(parseSaveFile(files.get("EX-1.sav")!).records.at(-1)!.name).toBe("ORD:test");
  });

  it("puts the file back and keeps the backup when the readback disagrees", async () => {
    // Corrupt the save as it is written -- the shape of a half-completed write.
    let first = true;
    const { handle, files } = fakeDir(seed(), (name, bytes) => {
      if (name !== "EX-1.sav" || !first) return bytes;
      first = false;
      return bytes.subarray(0, bytes.length - 200);
    });
    const before = files.get("EX-1.sav")!.slice();

    await expect(injectIntoSave(handle, "EX-1", "test", [[1, 5, 5]])).rejects.toThrow(ExportFailed);
    expect(Buffer.from(files.get("EX-1.sav")!).equals(Buffer.from(before)), "restored").toBe(true);
    expect([...files.keys()].some((k) => k.endsWith(BACKUP_EXT)), "backup kept").toBe(true);
  });

  it("steps around a name the file already holds rather than replacing it", async () => {
    const { handle, files } = fakeDir(seed());
    const first = await injectIntoSave(handle, "EX-1", "test", [[1, 5, 5]]);
    const second = await injectIntoSave(handle, "EX-1", "test", [[1, 5, 5]]);
    expect([first.name, second.name]).toEqual(["ORD:test", "ORD:test 2"]);
    const names = parseSaveFile(files.get("EX-1.sav")!).records.map((r) => r.name);
    expect(names.filter((n) => n.startsWith("ORD:"))).toEqual(["ORD:test", "ORD:test 2"]);
  });
});

describe("names", () => {
  it("backups are neither *.sav nor the game's own .bak", () => {
    const n = backupName("2-5", new Date(2026, 8, 9, 18, 30, 5));
    expect(n).toBe("2-5.2026-09-09T183005.orderly-bak");
    expect(n.endsWith(".sav"), "Steam syncs *.sav and would carry this to other devices").toBe(false);
    expect(n.endsWith(".sav.bak"), "save_manager.lua:457 owns that name").toBe(false);
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
