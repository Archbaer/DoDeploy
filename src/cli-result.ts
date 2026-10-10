import { z } from "zod";

export const commandDiagnosticSchema = z.object({
  code: z.string().min(1),
  stage: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  location: z.string().optional(),
});

export const commandCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  critical: z.boolean(),
  detail: z.string(),
});

export const commandResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  command: z.enum(["analyze", "generate", "doctor"]),
  status: z.enum(["success", "deferred", "error"]),
  provider: z.enum(["aws", "gcp", "azure"]).optional(),
  diagnostics: z.array(commandDiagnosticSchema),
  recommendations: z.array(z.unknown()).default([]),
  files: z.array(z.string()).default([]),
  deferred: z.array(z.string()).default([]),
  checks: z.array(commandCheckSchema).optional(),
});

export type CommandResult = z.infer<typeof commandResultSchema>;
export type CommandDiagnostic = z.infer<typeof commandDiagnosticSchema>;

export function diagnosticCode(stage: string): string {
  switch (stage) {
    case "compose":
    case "parse":
    case "normalize":
      return "input.invalid";
    case "write":
      return "output.write_failed";
    case "render":
      return "render.failed";
    case "interview":
      return "interview.failed";
    default:
      return `${stage}.failed`;
  }
}

export function toCommandDiagnostic(diagnostic: {
  stage: string;
  severity: "info" | "warning" | "error";
  message: string;
  ruleId?: string | undefined;
}): CommandDiagnostic {
  return {
    code: diagnostic.ruleId ? `rule.${diagnostic.ruleId}` : diagnosticCode(diagnostic.stage),
    stage: diagnostic.stage,
    severity: diagnostic.severity,
    message: diagnostic.message,
  };
}

export function makeCommandResult(
  input: Omit<z.input<typeof commandResultSchema>, "schemaVersion">,
): CommandResult {
  return commandResultSchema.parse({ schemaVersion: "1.0", ...input });
}
