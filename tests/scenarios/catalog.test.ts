import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scenarios, scenariosFor } from "./catalog.js";

const fixtureRoot = join(process.cwd(), "tests/compose/fixtures");

describe("scenario catalog", () => {
  it("has unique IDs and a fixture for every case", () => {
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);
    for (const scenario of scenarios) {
      if (scenario.fixture)
        expect(existsSync(join(fixtureRoot, scenario.fixture)), scenario.id).toBe(true);
      expect(scenario.providers.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.expectedOutcome).toBeDefined();
      expect(scenario.expectedFiles).toBeDefined();
      expect(scenario.expectedDiagnostics).toBeDefined();
      expect(
        scenario.expectedDeferred.every((provider) => scenario.providers.includes(provider)),
      ).toBe(true);
      if (scenario.expectedOutcome === "error") {
        expect(scenario.expectedFiles, scenario.id).toEqual([]);
        expect(scenario.expectedDiagnostics.length, scenario.id).toBeGreaterThan(0);
      } else {
        expect(scenario.expectedFiles.slice().sort(), scenario.id).toEqual(
          [
            "providers.tf",
            "variables.tf",
            "network.tf",
            "compute.tf",
            "data.tf",
            "outputs.tf",
          ].sort(),
        );
      }
    }
  });

  it("contains full standard and edge manifests for each provider", () => {
    expect(scenarios.filter((scenario) => scenario.id.startsWith("C"))).toHaveLength(20);
    expect(scenarios.filter((scenario) => scenario.id.startsWith("E"))).toHaveLength(24);
    for (const provider of ["aws", "gcp", "azure"] as const) {
      expect(scenariosFor(provider)).toHaveLength(44);
    }
  });
});
