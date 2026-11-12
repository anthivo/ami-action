import { describe, expect, it } from "vitest";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// GitHub runs the Action's dist/ as it's committed, never building it: it must be exactly what the sources compile to.

const root = fileURLToPath(new URL("..", import.meta.url));

describe("dist/", () => {
  it("is what the sources build to, file for file", () => {
    const out = mkdtempSync(join(tmpdir(), "ami-action-dist-"));
    try {
      const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
      const built = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--outDir", out], {
        cwd: root,
        encoding: "utf8",
      });
      expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
      const names = readdirSync(out).sort();
      expect(readdirSync(join(root, "dist")).sort()).toEqual(names);
      for (const name of names) {
        expect(readFileSync(join(root, "dist", name), "utf8"), name).toBe(readFileSync(join(out, name), "utf8"));
      }
      expect(names).toContain("main.js");
      expect(names.some((name) => name.includes(".test."))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
