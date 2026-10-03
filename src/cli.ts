import { readFileSync } from "node:fs";
import { Command } from "commander";
import { normalizeCompose, parseCompose } from "./compose/index.js";
import { runDoctor } from "./doctor.js";
import { generateProject } from "./generate.js";
import { ClackDriver } from "./interview/clack-driver.js";
import { providers } from "./providers/index.js";
import { applyRules } from "./rules/index.js";
import { renderBanner } from "./ui/banner.js";

const VERSION = "0.2.0";

type ProviderId = "aws" | "gcp" | "azure";

function printDiagnostics(diagnostics: { severity: string; message: string }[]): void {
  for (const diagnostic of diagnostics) {
    console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
  }
}

const analyzeCommand = new Command("analyze")
  .description("Parse a compose file and report findings + recommendations")
  .argument("[path]", "path to docker-compose.yaml")
  .option("--provider <id>", "target provider (aws|gcp|azure)", "aws")
  .action((path: string | undefined, options: { provider: string }) => {
    const pack = providers[options.provider as ProviderId];
    if (pack === undefined) {
      console.error(`unknown provider: ${options.provider} (expected aws|gcp|azure)`);
      process.exitCode = 1;
      return;
    }
    if (path === undefined) {
      console.error("analyze: pass a compose file path (or use `dodeploy generate` without one)");
      process.exitCode = 1;
      return;
    }
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      console.error(`cannot read compose file: ${path}`);
      process.exitCode = 1;
      return;
    }
    const parsed = parseCompose(content);
    if (!parsed.ok) {
      printDiagnostics(parsed.diagnostics);
      process.exitCode = 1;
      return;
    }
    const normalized = normalizeCompose(parsed.value);
    if (!normalized.ok) {
      printDiagnostics(normalized.diagnostics);
      process.exitCode = 1;
      return;
    }
    const rulesResult = applyRules(normalized.value, pack.rules);
    if (!rulesResult.ok) {
      printDiagnostics(rulesResult.diagnostics);
      process.exitCode = 1;
      return;
    }

    console.log(`\n=== dodeploy analyze: ${path} (provider: ${pack.id}) ===`);
    if (normalized.diagnostics.length > 0) {
      console.log("\nFindings:");
      for (const finding of normalized.diagnostics) {
        console.log(`  [${finding.severity}] ${finding.message}`);
      }
    }
    const { recommendations } = rulesResult.value;
    console.log(`\nRecommendations (${pack.id}): ${recommendations.length}`);
    for (const rec of recommendations) {
      console.log(`  [${rec.costTier}] ${rec.message}`);
      console.log(`      ${rec.rationale}`);
    }
    if (rulesResult.diagnostics.length > 0) {
      console.log("\nRule diagnostics:");
      printDiagnostics(rulesResult.diagnostics);
    }
  });

const generateCommand = new Command("generate")
  .description("Compose (or interview) → rules → Terraform fileset on disk")
  .argument("[path]", "path to docker-compose.yaml (omit to use the interview)")
  .option("--provider <id>", "target provider (aws|gcp|azure)")
  .option("-o, --out <dir>", "output directory", "dodeploy-infra")
  .option("--name <name>", "project name (interview-only mode)")
  .option("--no-interview", "skip the interactive interview")
  .action(
    async (
      path: string | undefined,
      options: { provider?: string; out: string; name?: string; interview: boolean },
    ) => {
      const provider = options.provider as ProviderId | undefined;
      if (provider !== undefined && providers[provider] === undefined) {
        console.error(`unknown provider: ${options.provider} (expected aws|gcp|azure)`);
        process.exitCode = 1;
        return;
      }
      const result = await generateProject({
        composePath: path,
        provider,
        projectName: options.name,
        outDir: options.out,
        interview: options.interview,
        driver: options.interview ? new ClackDriver() : undefined,
      });
      if (!result.ok) {
        printDiagnostics(result.diagnostics);
        process.exitCode = 1;
        return;
      }
      console.log(`\nWritten ${result.filesWritten.length} files to ${result.outDir}/`);
      for (const file of result.filesWritten) {
        console.log(`  ${file}`);
      }
      console.log(`\n${result.recommendations.length} recommendations (see \`dodeploy analyze\`).`);
      if (result.diagnostics.length > 0) {
        console.log(`\n${result.diagnostics.length} note(s) from generation:`);
        printDiagnostics(result.diagnostics);
      }
      if (result.deferred.length > 0) {
        console.log(`\n${result.deferred.length} item(s) were deferred:`);
        for (const item of result.deferred) {
          console.log(`  • ${item}`);
        }
        console.log("\nReview the TODO items before running terraform apply.");
      }
      console.log(`\nNext: cd ${result.outDir} && terraform init && terraform plan`);
    },
  );

const doctorCommand = new Command("doctor")
  .description("Check your environment (terraform, runtime, compose file)")
  .argument("[path]", "path to docker-compose.yaml")
  .action((path: string | undefined) => {
    const checks = runDoctor({ composePath: path });
    for (const check of checks) {
      const mark = check.ok ? "✓" : check.critical ? "✗" : "⚠";
      console.log(`${mark} ${check.label}: ${check.detail}`);
    }
    if (checks.some((check) => check.critical && !check.ok)) {
      process.exitCode = 1;
    }
  });

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("dodeploy")
    .description("Turn a docker-compose.yaml into deployable Terraform for AWS, GCP and Azure")
    .version(VERSION);

  program.addCommand(analyzeCommand);
  program.addCommand(generateCommand);
  program.addCommand(doctorCommand);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  if (argv.length <= 2) {
    console.log(renderBanner());
    program.outputHelp();
    return;
  }
  await program.parseAsync(argv);
}
