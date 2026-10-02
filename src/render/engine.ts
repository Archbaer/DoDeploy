import type { Diagnostic } from "../ir/index.js";

export type SectionBuilder<C> = (ctx: C) => string;

export interface Section<C> {
  name: string;
  builder: SectionBuilder<C>;
}

export interface SectionResult {
  content: string;
  diagnostics: Diagnostic[];
}

export function renderSections<C>(sections: Section<C>[], ctx: C): SectionResult {
  const chunks: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { name, builder } of sections) {
    try {
      chunks.push(builder(ctx));
    } catch (error) {
      diagnostics.push({
        stage: "render",
        severity: "warning",
        message: `section "${name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      chunks.push(`# TODO(dodeploy): section "${name}" failed to render`);
    }
  }
  return { content: chunks.filter((c) => c.trim().length > 0).join("\n"), diagnostics };
}
