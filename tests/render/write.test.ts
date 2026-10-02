import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeTfFileset } from "../../src/render/write.js";

describe("writeTfFileset", () => {
  it("writes all files and reports success", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-write-"));
    const result = writeTfFileset(dir, { "a.tf": "a", "b.tf": "b" });
    expect(result.ok).toBe(true);
    expect(result.written).toEqual(["a.tf", "b.tf"]);
    expect(result.failures).toEqual([]);
  });

  it("fails when the output path is an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-write-file-"));
    const file = join(dir, "outfile");
    writeFileSync(file, "not a directory");
    const result = writeTfFileset(file, { "a.tf": "a" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("cannot create output directory");
  });

  it("reports a partial failure when one file collides with a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-write-partial-"));
    mkdirSync(join(dir, "a.tf"));
    const result = writeTfFileset(dir, { "a.tf": "a", "b.tf": "b" });
    expect(result.ok).toBe(false);
    expect(result.written).toEqual(["b.tf"]);
    expect(result.failures.map((f) => f.name)).toContain("a.tf");
    expect(result.message).toContain("a.tf");
  });
});
