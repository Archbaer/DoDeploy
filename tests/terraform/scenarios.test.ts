import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateProject } from "../../src/generate.js";
import type { ProviderId } from "../../src/providers/types.js";
import { verifyTerraform } from "../helpers/terraform.js";
import { scenariosFor } from "../scenarios/catalog.js";

const selected = (process.env.DODEPLOY_TEST_PROVIDER ?? "").trim() as ProviderId | "";
const providers: readonly ProviderId[] = selected ? [selected] : ["aws", "gcp", "azure"];
const validCases = scenariosFor((selected || "aws") as ProviderId).filter(
  (scenario) => scenario.expectedOutcome !== "error",
);
const invalidCases = scenariosFor((selected || "aws") as ProviderId).filter(
  (scenario) => scenario.expectedOutcome === "error",
);

describe("required Terraform scenario integration", () => {
  it("runs every required provider case without skips", () => {
    if (process.env.DODEPLOY_REQUIRE_TERRAFORM !== "1") {
      throw new Error(
        "Strict suite requires DODEPLOY_REQUIRE_TERRAFORM=1; run npm run test:terraform",
      );
    }
    expect(providers.length).toBeGreaterThan(0);
    expect(validCases).toHaveLength(37);
    expect(invalidCases).toHaveLength(7);
  });
  for (const provider of providers) {
    for (const scenario of scenariosFor(provider).filter(
      (item) => item.expectedOutcome !== "error",
    )) {
      it(`${scenario.id} ${provider}: fmt, init, validate, mocked plan`, async () => {
        const outDir = mkdtempSync(join(tmpdir(), `dodeploy-${scenario.id}-${provider}-`));
        const generated = await generateProject({
          composePath: join(process.cwd(), "tests/compose/fixtures", scenario.fixture ?? ""),
          provider,
          outDir,
          interview: false,
        });
        if (!generated.ok)
          throw new Error(
            `${scenario.id} generation failed: ${JSON.stringify(generated.diagnostics)}`,
          );
        const check = verifyTerraform(outDir, { provider, strict: true });
        expect(check).toMatchObject({
          formatting: { passed: true },
          initialization: { passed: true },
          validation: { passed: true },
          mockPlan: { passed: true },
        });
      }, 600_000);
    }
  }
  for (const provider of providers) {
    for (const scenario of scenariosFor(provider).filter(
      (item) => item.expectedOutcome === "error",
    )) {
      it(`${scenario.id} ${provider}: fails with expected diagnostic and no partial output`, async () => {
        const temp = mkdtempSync(join(tmpdir(), `dodeploy-${scenario.id}-${provider}-`));
        const outDir =
          scenario.failure === "unwritable-output"
            ? join(temp, "not-a-directory")
            : join(temp, "out");
        if (scenario.failure === "unwritable-output") writeFileSync(outDir, "preserve-me");
        if (!scenario.fixture && scenario.failure !== "unreadable-input") {
          throw new Error(`${scenario.id} missing Compose fixture`);
        }
        const composePath =
          scenario.failure === "unreadable-input"
            ? join(temp, "missing-compose.yaml")
            : join(process.cwd(), "tests/compose/fixtures", scenario.fixture ?? "");
        const result = await generateProject({ composePath, provider, outDir, interview: false });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        for (const expected of scenario.expectedDiagnostics) {
          expect(
            result.diagnostics.some((diagnostic) => diagnostic.message.includes(expected)),
          ).toBe(true);
        }
        expect(readdirSync(temp).sort()).toEqual(
          scenario.failure === "unwritable-output" ? ["not-a-directory"] : [],
        );
        if (scenario.failure === "unwritable-output")
          expect(readFileSync(outDir, "utf8")).toBe("preserve-me");
      }, 30_000);
    }
  }
});
