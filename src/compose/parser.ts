import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Result } from "../ir/index.js";
import { err, ok } from "../ir/index.js";
import type { ComposeFile } from "./schema.js";
import { composeFileSchema } from "./schema.js";

export function parseCompose(content: string): Result<ComposeFile> {
  let document: unknown;
  try {
    document = parseYaml(content);
  } catch (error) {
    return err({
      stage: "parse",
      severity: "error",
      message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const result = composeFileSchema.safeParse(document);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return err({
      stage: "parse",
      severity: "error",
      message: `not a valid compose file — ${details}`,
    });
  }
  return ok(result.data);
}

export function parseComposeFile(path: URL): Result<ComposeFile> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return err({
      stage: "parse",
      severity: "error",
      message: `cannot read compose file at ${path.pathname}`,
    });
  }
  return parseCompose(content);
}
