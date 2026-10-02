import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { providers } from "../../src/providers/index.js";
import { writeTfFileset } from "../../src/render/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR } from "../providers/fixtures.js";

const terraformAvailable = (() => {
  try {
    execSync("terraform version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!terraformAvailable)("terraform validate (integration)", () => {
  for (const [id, provider] of Object.entries(providers)) {
    it(`${id}: generated fileset passes terraform fmt, init and validate`, () => {
      const rulesResult = applyRules(dbIR, provider.rules);
      if (!rulesResult.ok) throw new Error("rules failed");
      const { files } = provider.render(rulesResult.value);

      const dir = mkdtempSync(join(tmpdir(), `dodeploy-${id}-`));
      writeTfFileset(dir, files);

      execFileSync("terraform", ["fmt", dir], { stdio: "pipe" });
      execFileSync("terraform", [`-chdir=${dir}`, "init", "-backend=false"], { stdio: "pipe" });
      execFileSync("terraform", [`-chdir=${dir}`, "validate"], { stdio: "pipe" });
      expect(true).toBe(true);
    });
  }
});
