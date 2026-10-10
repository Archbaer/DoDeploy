import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderId } from "../../src/providers/types.js";

export type TerraformCheckResult = {
  provider: ProviderId;
  version: string;
  logPaths: Record<"formatting" | "initialization" | "validation" | "mockPlan", string>;
  formatting: { passed: boolean; exitCode: number };
  initialization: { passed: boolean; exitCode: number };
  validation: { passed: boolean; exitCode: number; result: unknown };
  mockPlan: { passed: boolean; exitCode: number };
};

export function verifyTerraform(
  dir: string,
  options: { provider: ProviderId; strict: true },
): TerraformCheckResult {
  let version: string;
  try {
    version = execFileSync("terraform", ["version", "-json"], {
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch (error) {
    throw new Error(
      "Terraform required for strict verification. Install Terraform 1.9.8 and rerun.",
      { cause: error },
    );
  }
  const versionObject = JSON.parse(version) as { terraform_version?: string };
  if (!versionObject.terraform_version)
    throw new Error("terraform version -json returned invalid JSON");
  if (versionObject.terraform_version !== "1.9.8") {
    throw new Error(
      `Terraform 1.9.8 required for strict verification; found ${versionObject.terraform_version}`,
    );
  }
  const run = (args: string[], encoding?: "utf8") => {
    const result = spawnSync("terraform", args, {
      encoding,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0" },
    });
    if (result.error)
      throw new Error(`terraform ${args.at(-1)} failed to execute: ${result.error.message}`);
    if (result.signal)
      throw new Error(`terraform ${args.at(-1)} timed out or was terminated: ${result.signal}`);
    return {
      code: result.status ?? 1,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  };
  const formatted = run([`-chdir=${dir}`, "fmt", "-check", "-diff", "-recursive"]);
  const logPaths = {
    formatting: join(dir, "terraform-format.log"),
    initialization: join(dir, "terraform-init.log"),
    validation: join(dir, "terraform-validation.json"),
    mockPlan: join(dir, "terraform-test.log"),
  };
  writeFileSync(logPaths.formatting, `${formatted.stdout}\n${formatted.stderr}`);
  if (formatted.code !== 0)
    throw new Error(
      `terraform fmt failed (${formatted.code}): ${formatted.stdout}\n${formatted.stderr}`,
    );
  const initialized = run([`-chdir=${dir}`, "init", "-backend=false", "-input=false", "-no-color"]);
  writeFileSync(logPaths.initialization, `${initialized.stdout}\n${initialized.stderr}`);
  if (initialized.code !== 0)
    throw new Error(
      `terraform init failed (${initialized.code}): ${initialized.stdout}\n${initialized.stderr}`,
    );
  const validationRun = run([`-chdir=${dir}`, "validate", "-json"], "utf8");
  writeFileSync(logPaths.validation, validationRun.stdout);
  let validation: { valid?: boolean; error_count?: number };
  try {
    validation = JSON.parse(validationRun.stdout) as typeof validation;
  } catch {
    throw new Error(
      `terraform validate returned invalid JSON: ${validationRun.stdout}\n${validationRun.stderr}`,
    );
  }
  if (validationRun.code !== 0 || validation.valid !== true || validation.error_count !== 0) {
    throw new Error(
      `terraform validate failed: ${JSON.stringify(validation)}\n${validationRun.stderr}`,
    );
  }
  const providerName = { aws: "aws", gcp: "google", azure: "azurerm" }[options.provider];
  // Computed data-source values are read during planning. Supply realistic values
  // where Terraform's random mock strings and empty lists violate their contract.
  const mockData =
    options.provider === "aws"
      ? `
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_ami" {
    defaults = { id = "ami-0123456789abcdef0" }
  }
`
      : "";
  const contract = `mock_provider "${providerName}" {${mockData}}\nrun "catalog_mock_plan" {\n  command = plan\n}\n`;
  const testPath = join(dir, "catalog.tftest.hcl");
  const varsPath = join(dir, "catalog.auto.tfvars.json");
  const variableSource = existsSync(join(dir, "variables.tf"))
    ? readFileSync(join(dir, "variables.tf"), "utf8")
    : "";
  const names = [...variableSource.matchAll(/variable\s+"([^"]+)"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  const region = { aws: "us-east-1", gcp: "us-central1", azure: "eastus" }[options.provider];
  const values = Object.fromEntries(
    names.map((name) => [
      name,
      name.endsWith("_image")
        ? "registry.example.test/synthetic:1.0"
        : name === "region"
          ? region
          : name === "project_name"
            ? "dodeploy-test"
            : name === "vpc_cidr"
              ? "10.0.0.0/16"
              : name.endsWith("_password")
                ? "Synthetic-Test-Password-123!"
                : "synthetic-test-value",
    ]),
  );
  writeFileSync(testPath, contract);
  writeFileSync(varsPath, JSON.stringify(values, null, 2));
  // Test-only files are deliberately retained for failure artifact inspection.
  const plan = run([`-chdir=${dir}`, "test", "-no-color"]);
  writeFileSync(logPaths.mockPlan, `${plan.stdout}\n${plan.stderr}`);
  if (plan.code !== 0)
    throw new Error(
      `terraform test mock plan failed (${plan.code}): ${plan.stdout}\n${plan.stderr}`,
    );
  return {
    provider: options.provider,
    version: versionObject.terraform_version,
    logPaths,
    formatting: { passed: true, exitCode: formatted.code },
    initialization: { passed: true, exitCode: initialized.code },
    validation: { passed: true, exitCode: validationRun.code, result: validation },
    mockPlan: { passed: true, exitCode: 0 },
  };
}
