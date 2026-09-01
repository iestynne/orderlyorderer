// The hand-rolled digest, checked against node:crypto.
//
// `[D]` A reimplementation is only worth having if something independent
// agrees with it (D32 in miniature). Node has SHA-256 and the browser does not
// have it synchronously, so the test uses the platform the tests run on to
// judge the code that ships to the one they do not.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, sha256Text } from "../../../src/sim/route/sha256";

describe("sha256", () => {
  it("matches node:crypto at every length across the block boundaries", () => {
    const bad: number[] = [];
    for (let n = 0; n <= 300; n++) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 37 + n) & 255;
      if (sha256(b) !== createHash("sha256").update(b).digest("hex")) bad.push(n);
    }
    expect(bad).toEqual([]);
  });

  it("reproduces the FIPS 180-4 vector for \"abc\"", () => {
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches node:crypto on a payload-sized buffer", () => {
    const b = new Uint8Array(64_000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 131) & 255;
    expect(sha256(b)).toBe(createHash("sha256").update(b).digest("hex"));
  });
});
