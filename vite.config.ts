import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No backend (CLAUDE.md). build/ holds the game art and is gitignored; the
// atlas is imported with ?inline so it lands in the bundle rather than being
// emitted as a fetchable asset (SPEC-007 §6.1, D14b-1).
//
// The `.sav` codec is SPEC-006's, written for Node and byte-exact against the
// shipped saves. It is frozen, so the browser build aliases node:zlib to a
// synchronous shim rather than reshaping it. See src/sav/zlib-browser.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^node:zlib$/, replacement: fileURLToPath(new URL("./src/sav/zlib-browser.ts", import.meta.url)) }],
  },
  build: { assetsInlineLimit: 1024 * 1024, target: "es2022" },
});
