import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectIR } from "../../src/ir/index.js";
import { providers } from "../../src/providers/index.js";
import { writeTfFileset } from "../../src/render/index.js";
import { applyRules } from "../../src/rules/index.js";
import { awsAppRunnerIR, awsEc2IR, awsMixedTargetIR, dbIR } from "../providers/fixtures.js";

const terraformAvailable = (() => {
  try {
    execSync("terraform version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

type Scenario = { name: string; input: ProjectIR; providers?: string[] };

const baseScenarios: Scenario[] = [
  { name: "PostgreSQL + Redis", input: dbIR },
  {
    name: "MySQL",
    input: {
      ...dbIR,
      datastores: [
        {
          name: "db",
          engine: "mysql" as const,
          version: "8.0.36-oraclelinux8",
          detected: true,
        },
      ],
      network: {
        ...dbIR.network,
        securityGroupRules: [{ from: "api", to: "db", port: 3306 }],
      },
    },
  },
];

const awsTargetScenarios: Scenario[] = [
  { name: "AWS EC2 target", input: awsEc2IR, providers: ["aws"] },
  { name: "AWS App Runner target", input: awsAppRunnerIR, providers: ["aws"] },
  { name: "AWS mixed Fargate + App Runner targets", input: awsMixedTargetIR, providers: ["aws"] },
];

describe.skipIf(!terraformAvailable)("terraform validate (integration)", () => {
  for (const [id, provider] of Object.entries(providers)) {
    const scenarios = [
      ...baseScenarios,
      ...awsTargetScenarios.filter((s) => s.providers === undefined || s.providers.includes(id)),
    ];
    for (const scenario of scenarios) {
      it(`${id} — ${scenario.name}: generated fileset passes terraform fmt, init and validate`, {
        timeout: 180_000,
      }, () => {
        const rulesResult = applyRules(scenario.input, provider.rules);
        if (!rulesResult.ok) throw new Error("rules failed");
        const { files } = provider.render(rulesResult.value);

        const dir = mkdtempSync(join(tmpdir(), `dodeploy-${id}-`));
        writeTfFileset(dir, files);

        execFileSync("terraform", ["fmt", dir], { stdio: "pipe" });
        execFileSync("terraform", [`-chdir=${dir}`, "init", "-backend=false"], { stdio: "pipe" });
        const validation = execFileSync("terraform", [`-chdir=${dir}`, "validate", "-json"], {
          encoding: "utf8",
        });
        expect(JSON.parse(validation).valid).toBe(true);
      });
    }
  }
});
