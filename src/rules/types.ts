import type { ProjectIR, Recommendation } from "../ir/index.js";

export type RuleOutput = Omit<Recommendation, "ruleId">;

export interface Rule {
  id: string;
  run: (ir: ProjectIR) => RuleOutput[];
}
