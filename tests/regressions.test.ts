import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "regressions", "out");
const EXP = path.join(ROOT, "regressions", "expected");

describe("real-world regression repos", () => {
  it("matches golden outputs", () => {
    execSync("node scripts/run-regressions.mjs", { stdio: "inherit" });

    const files = fs.readdirSync(OUT).filter(f => f.endsWith(".actual.json"));
    for (const f of files) {
      const base = f.replace(".actual.json", "");
      const actual = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
      const expectedPath = path.join(EXP, `${base}.expected.json`);

      if (!fs.existsSync(expectedPath)) {
        throw new Error(`Missing expected file: ${expectedPath}`);
      }

      const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
      expect(actual).toEqual(expected);
    }
  });
});
