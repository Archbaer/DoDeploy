import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { providers } from "../../src/providers/index.js";
import type { ProviderId } from "../../src/providers/types.js";
import { writeTfFileset } from "../../src/render/index.js";
import { applyRules } from "../../src/rules/index.js";
import { verifyTerraform } from "../helpers/terraform.js";
import { awsAppRunnerIR, awsEc2IR, awsMixedTargetIR, dbIR } from "../providers/fixtures.js";

const selected = process.env.DODEPLOY_TEST_PROVIDER as ProviderId | undefined;
const mysqlIR = {
  ...dbIR,
  datastores: [
    { name: "db", engine: "mysql" as const, version: "8.0.36-oraclelinux8", detected: true },
  ],
  network: { ...dbIR.network, securityGroupRules: [{ from: "api", to: "db", port: 3306 }] },
};
const cases = [
  { name: "PostgreSQL and Redis", input: dbIR, providers: ["aws", "gcp", "azure"] as const },
  { name: "MySQL", input: mysqlIR, providers: ["aws", "gcp", "azure"] as const },
  { name: "AWS EC2 target", input: awsEc2IR, providers: ["aws"] as const },
  { name: "AWS App Runner target", input: awsAppRunnerIR, providers: ["aws"] as const },
  { name: "AWS mixed targets", input: awsMixedTargetIR, providers: ["aws"] as const },
];

describe("legacy Terraform integration cases", () => {
  for (const scenario of cases) {
    for (const providerId of scenario.providers.filter((id) => !selected || id === selected)) {
      it(`${scenario.name} (${providerId})`, () => {
        const provider = providers[providerId];
        if (!provider) throw new Error(`provider ${providerId} missing from registry`);
        const rules = applyRules(scenario.input, provider.rules);
        if (!rules.ok) throw new Error(`${scenario.name}: provider rules failed`);
        const rendered = provider.render(rules.value);
        const dir = mkdtempSync(join(tmpdir(), `dodeploy-legacy-${providerId}-`));
        writeTfFileset(dir, rendered.files);
        expect(verifyTerraform(dir, { provider: providerId, strict: true }).validation.passed).toBe(
          true,
        );
      }, 600_000);
    }
  }
});
