import type { Renderer } from "../render/types.js";
import type { Rule } from "../rules/index.js";

export interface CloudProvider {
  id: "aws" | "gcp" | "azure";
  rules: Rule[];
  render: Renderer;
}
