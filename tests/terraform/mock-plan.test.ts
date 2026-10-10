import { describe, expect, it } from "vitest";
import { scenarios } from "../scenarios/catalog.js";

describe("Terraform required case accounting", () => {
  it("declares successful and negative cases separately", () => {
    const successes = scenarios.filter((scenario) => scenario.expectedOutcome !== "error");
    const negative = scenarios.filter((scenario) => scenario.expectedOutcome === "error");
    expect(successes).toHaveLength(37);
    expect(negative).toHaveLength(7);
    expect(successes.every((scenario) => scenario.providers.length > 0)).toBe(true);
  });
});
