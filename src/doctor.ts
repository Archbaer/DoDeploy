import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { normalizeCompose, parseCompose } from "./compose/index.js";

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Critical failures make `dodeploy doctor` exit non-zero. */
  critical: boolean;
  detail: string;
}

export interface DoctorOptions {
  composePath?: string | undefined;
}

export function runDoctor(options: DoctorOptions): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  let terraformOk = false;
  let terraformDetail =
    "not found — install it to apply the generated HCL (advisory for generation)";
  try {
    const output = execSync("terraform version", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const match = /Terraform v(\S+)/.exec(output);
    terraformOk = true;
    terraformDetail = `found (v${match?.[1] ?? "unknown"})`;
  } catch {
    // advisory — generation does not require terraform
  }
  checks.push({
    id: "terraform",
    label: "Terraform CLI",
    ok: terraformOk,
    critical: false,
    detail: terraformDetail,
  });

  checks.push({
    id: "node",
    label: "Node.js runtime",
    ok: true,
    critical: false,
    detail: process.version,
  });

  if (options.composePath !== undefined) {
    let content: string;
    try {
      content = readFileSync(options.composePath, "utf8");
    } catch {
      checks.push({
        id: "compose",
        label: "Compose file",
        ok: false,
        critical: true,
        detail: `cannot read ${options.composePath}`,
      });
      return checks;
    }
    const parsed = parseCompose(content);
    if (!parsed.ok) {
      const first = parsed.diagnostics[0];
      checks.push({
        id: "compose",
        label: "Compose file",
        ok: false,
        critical: true,
        detail: `invalid: ${first?.message ?? "unknown parse error"}`,
      });
      return checks;
    }
    const normalized = normalizeCompose(parsed.value);
    if (!normalized.ok) {
      const error = normalized.diagnostics.find((diagnostic) => diagnostic.severity === "error");
      checks.push({
        id: "compose",
        label: "Compose file",
        ok: false,
        critical: true,
        detail: `invalid: ${error?.message ?? "unknown normalization error"}`,
      });
      return checks;
    }
    const services = Object.keys(parsed.value.services ?? {}).length;
    checks.push({
      id: "compose",
      label: "Compose file",
      ok: true,
      critical: false,
      detail: `${options.composePath} — ${services} services, valid`,
    });
  }

  return checks;
}
