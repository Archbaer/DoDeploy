import { describe, expect, it } from "vitest";
import type { Recommendation } from "../../src/ir/index.js";
import { enrichedIRSchema, projectIRSchema } from "../../src/ir/index.js";
import type { Rule } from "../../src/rules/index.js";
import { applyRules } from "../../src/rules/index.js";
import { webIR } from "../providers/fixtures.js";

const rec = (message = "m"): Omit<Recommendation, "ruleId"> => ({
  severity: "suggestion",
  message,
  rationale: "because tests",
});

const rule = (id: string, output: Omit<Recommendation, "ruleId">[] = [rec()]): Rule => ({
  id,
  run: () => output,
});

describe("applyRules", () => {
  it("attaches ruleId and merges recommendations into an EnrichedIR", () => {
    const result = applyRules(webIR, [rule("a"), rule("b")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recommendations.map((r) => r.ruleId)).toEqual(["a", "b"]);
    expect(enrichedIRSchema.safeParse(result.value).success).toBe(true);
  });

  it("returns the IR unchanged (empty recommendations) with no rules", () => {
    const result = applyRules(webIR, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recommendations).toEqual([]);
  });

  it("isolates a throwing rule and still runs the rest", () => {
    const poisoned: Rule = {
      id: "poisoned",
      run: () => {
        throw new Error("boom");
      },
    };
    const result = applyRules(webIR, [poisoned, rule("healthy")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recommendations.map((r) => r.ruleId)).toEqual(["healthy"]);
    expect(result.diagnostics.some((d) => d.ruleId === "poisoned")).toBe(true);
  });

  it("rejects malformed rule output with a diagnostic instead of cascading", () => {
    const bad = rule("bad", [{ severity: "suggestion", message: "", rationale: "r" }]);
    const result = applyRules(webIR, [bad, rule("good")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recommendations.map((r) => r.ruleId)).toEqual(["good"]);
    expect(result.diagnostics.some((d) => d.ruleId === "bad")).toBe(true);
  });

  it("fails cleanly when the enriched IR itself is unrepresentable", () => {
    const broken = projectIRSchema.parse({ meta: { name: "x" } });
    const result = applyRules(broken, [rule("any")]);
    expect(result.ok).toBe(true);
  });
});
