// The Pages sub-path, derived from the remote rather than typed (D18).
//
// Diagnostic: a wrong base is the one deploy fault with no visible error —
// every asset 404s and the canvas is simply black (SPEC-007 §6.1). The cases
// are the two forms `git remote get-url` returns, plus the `.git` suffix and a
// trailing slash, each of which would otherwise land in the path.

import { describe, expect, it } from "vitest";
import { repoBase } from "../../tools/deploy";

describe("repoBase", () => {
  it.each([
    ["git@github.com:iestynne/orderlyorderer.git", "/orderlyorderer/"],
    ["https://github.com/iestynne/orderlyorderer.git", "/orderlyorderer/"],
    ["https://github.com/iestynne/orderlyorderer", "/orderlyorderer/"],
    ["https://github.com/iestynne/orderlyorderer/", "/orderlyorderer/"],
  ])("%s -> %s", (remote, base) => expect(repoBase(remote)).toBe(base));
});
