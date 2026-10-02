import type { Diagnostic, EnrichedIR, ProjectIR, Recommendation } from "../ir/index.js";
import { enrichedIRSchema, recommendationSchema } from "../ir/schema.js";
import type { Rule, RuleOutput } from "./types.js";

export type RulesResult =
  | { ok: true; value: EnrichedIR; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

const ruleOutputSchema = recommendationSchema.omit({ ruleId: true });

export function applyRules(ir: ProjectIR, rules: Rule[]): RulesResult {
  const recommendations: Recommendation[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    let outputs: RuleOutput[];
    try {
      outputs = rule.run(ir);
    } catch (error) {
      diagnostics.push({
        stage: "rules",
        severity: "warning",
        message: `rule "${rule.id}" threw: ${error instanceof Error ? error.message : String(error)}`,
        ruleId: rule.id,
      });
      continue;
    }

    for (const output of outputs) {
      const valid = ruleOutputSchema.safeParse(output);
      if (!valid.success) {
        diagnostics.push({
          stage: "rules",
          severity: "warning",
          message: `rule "${rule.id}" produced invalid output: ${valid.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          ruleId: rule.id,
        });
        continue;
      }
      recommendations.push({ ruleId: rule.id, ...valid.data });
    }
  }

  const enriched = enrichedIRSchema.safeParse({ ...ir, recommendations });
  if (!enriched.success) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        {
          stage: "rules",
          severity: "error",
          message: `enriched IR failed validation: ${enriched.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        },
      ],
    };
  }

  return { ok: true, value: enriched.data, diagnostics };
}
