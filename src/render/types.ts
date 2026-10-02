import type { Diagnostic, EnrichedIR } from "../ir/index.js";

export interface RenderResult {
  files: Record<string, string>;
  diagnostics: Diagnostic[];
}

export type Renderer = (ir: EnrichedIR) => RenderResult;
