import type { Rule } from "../rules/index.js";

export interface CloudProvider {
  id: "aws" | "gcp" | "azure";
  rules: Rule[];
}
