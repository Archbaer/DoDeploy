import type { InterviewDriver } from "./interview/driver.js";
import type { Diagnostic, Recommendation } from "./ir/index.js";
import { projectIRSchema } from "./ir/index.js";

export interface GenerateOptions {
  /** Path to docker-compose.yaml. Omit to start from the interview. */
  composePath?: string;
  /** Target provider. Required in non-interactive mode. */
  provider?: "aws" | "gcp" | "azure";
  projectName?: string;
  outDir: string;
  interview: boolean;
  driver?: InterviewDriver;
}

export type GenerateResult =
  | {
      ok: true;
      outDir: string;
      filesWritten: string[];
      diagnostics: Diagnostic[];
      recommendations: Recommendation[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

export async function generateProject(_options: GenerateOptions): Promise<GenerateResult> {
  throw new Error("not implemented");
}

export { projectIRSchema };
