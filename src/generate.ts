import { readFileSync } from "node:fs";
import { normalizeCompose, parseCompose } from "./compose/index.js";
import type { InterviewDriver } from "./interview/driver.js";
import { runInterview } from "./interview/interview.js";
import type { Diagnostic, ProjectIR, Recommendation } from "./ir/index.js";
import { projectIRSchema } from "./ir/index.js";
import { providers } from "./providers/index.js";
import { writeTfFileset } from "./render/index.js";
import { applyRules } from "./rules/index.js";

export interface GenerateOptions {
  /** Path to docker-compose.yaml. Omit to start from the interview. */
  composePath?: string | undefined;
  /** Target provider. Required in non-interactive mode. */
  provider?: "aws" | "gcp" | "azure" | undefined;
  projectName?: string | undefined;
  outDir: string;
  interview: boolean;
  driver?: InterviewDriver | undefined;
}

export type GenerateResult =
  | {
      ok: true;
      outDir: string;
      filesWritten: string[];
      diagnostics: Diagnostic[];
      recommendations: Recommendation[];
      deferred: string[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

const fail = (message: string): GenerateResult => ({
  ok: false,
  diagnostics: [{ stage: "compose", severity: "error", message }],
});

export async function generateProject(options: GenerateOptions): Promise<GenerateResult> {
  const diagnostics: Diagnostic[] = [];
  let ir: ProjectIR;

  if (options.composePath !== undefined) {
    let content: string;
    try {
      content = readFileSync(options.composePath, "utf8");
    } catch {
      return fail(`cannot read compose file: ${options.composePath}`);
    }
    const parsed = parseCompose(content);
    if (!parsed.ok) {
      const first = parsed.diagnostics[0];
      return fail(`invalid compose file: ${first?.message ?? "unknown parse error"}`);
    }
    const normalized = normalizeCompose(parsed.value);
    if (!normalized.ok) {
      return { ok: false, diagnostics: normalized.diagnostics };
    }
    ir = normalized.value;
    diagnostics.push(...normalized.diagnostics);
  } else {
    if (!options.interview) {
      return fail("no compose file given — drop --no-interview to answer a few questions instead");
    }
    ir = projectIRSchema.parse({
      meta: { name: options.projectName ?? "app", source: "interview" },
    });
  }

  if (options.provider !== undefined) {
    ir = { ...ir, meta: { ...ir.meta, provider: options.provider } };
  } else if (!options.interview) {
    return fail("provider required in non-interactive mode: pass --provider aws|gcp|azure");
  }

  if (options.interview) {
    if (options.driver === undefined) {
      return fail("interview requested but no interview driver is available");
    }
    const interview = await runInterview(ir, options.driver);
    if (!interview.ok) {
      return { ok: false, diagnostics: interview.diagnostics };
    }
    ir = interview.value;
    diagnostics.push(...interview.diagnostics);
  }

  const pack = providers[ir.meta.provider];
  if (pack === undefined) {
    return fail(`unknown provider: ${ir.meta.provider}`);
  }
  const rulesResult = applyRules(ir, pack.rules);
  if (!rulesResult.ok) {
    return { ok: false, diagnostics: rulesResult.diagnostics };
  }
  diagnostics.push(...rulesResult.diagnostics);

  const rendered = pack.render(rulesResult.value);
  diagnostics.push(...rendered.diagnostics);

  const writeResult = writeTfFileset(options.outDir, rendered.files);
  if (!writeResult.ok) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        { stage: "write", severity: "error", message: writeResult.message },
      ],
    };
  }

  const deferred = Object.values(rendered.files)
    .flatMap((content) => content.split("\n"))
    .filter((line) => line.includes("TODO(dodeploy)"))
    .map((line) => line.trim());

  return {
    ok: true,
    outDir: options.outDir,
    filesWritten: writeResult.written,
    diagnostics,
    recommendations: rulesResult.value.recommendations,
    deferred,
  };
}
