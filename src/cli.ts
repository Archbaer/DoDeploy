import { readFileSync } from "node:fs";
import { Command, Help } from "commander";
import { makeCommandResult, toCommandDiagnostic } from "./cli-result.js";
import { normalizeCompose, parseCompose } from "./compose/index.js";
import { runDoctor } from "./doctor.js";
import { generateProject } from "./generate.js";
import { ClackDriver } from "./interview/clack-driver.js";
import { providers } from "./providers/index.js";
import { applyRules } from "./rules/index.js";
import { renderBanner } from "./ui/banner.js";

const VERSION = "0.3.2";

type ProviderId = "aws" | "gcp" | "azure";

/** Help output that stays readable on narrow terminals: when the term column
 * leaves too little room for a description, the description wraps onto its own
 * indented lines instead of overflowing past the terminal width. */
class WrappingHelp extends Help {
  override commandUsage(cmd: Command): string {
    const usage = super.commandUsage(cmd);
    // The usage line is emitted raw by commander — wrap it ourselves when it
    // would exceed the terminal width, aligning continuations under the name.
    const prefix = "Usage: ".length;
    const width = (this.helpWidth ?? 80) - prefix;
    if (usage.length <= width) return usage;
    return this.boxWrap(usage, width)
      .split("\n")
      .join(`\n${" ".repeat(prefix)}`);
  }

  override formatItem(term: string, termWidth: number, description: string, helper: Help): string {
    const itemIndent = 2;
    const helpWidth = this.helpWidth ?? 80;
    if (description && helpWidth - termWidth - itemIndent - 2 < this.minWidthToWrap) {
      const wrapped = helper
        .boxWrap(description, helpWidth - itemIndent * 2)
        .split("\n")
        .map((line) => " ".repeat(itemIndent * 2) + line)
        .join("\n");
      return `${" ".repeat(itemIndent)}${term}\n${wrapped}`;
    }
    return super.formatItem(term, termWidth, description, helper);
  }
}

function printDiagnostics(diagnostics: { severity: string; message: string }[]): void {
  for (const diagnostic of diagnostics) {
    console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
  }
}

function printJson(result: ReturnType<typeof makeCommandResult>): void {
  console.log(JSON.stringify(result));
}

function cliDiagnostic(stage: string, message: string, code: string) {
  return { code, stage, severity: "error" as const, message };
}

const analyzeCommand = new Command("analyze")
  .description("Parse a compose file and report findings + recommendations")
  .argument("[path]", "path to docker-compose.yaml")
  .option("--provider <id>", "target provider (aws|gcp|azure)", "aws")
  .option("--json", "write structured JSON result")
  .action((path: string | undefined, options: { provider: string; json?: boolean }) => {
    const pack = providers[options.provider as ProviderId];
    if (!Object.hasOwn(providers, options.provider) || pack === undefined) {
      const message = `unknown provider: ${options.provider} (expected aws|gcp|azure)`;
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            diagnostics: [cliDiagnostic("input", message, "provider.unknown")],
          }),
        );
      else console.error(message);
      process.exitCode = 1;
      return;
    }
    if (path === undefined) {
      const message = "analyze: pass a compose file path (or use `dodeploy generate` without one)";
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            diagnostics: [cliDiagnostic("input", message, "input.required")],
          }),
        );
      else console.error(message);
      process.exitCode = 1;
      return;
    }
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      const message = `cannot read compose file: ${path}`;
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            provider: pack.id,
            diagnostics: [cliDiagnostic("compose", message, "input.unreadable")],
          }),
        );
      else console.error(message);
      process.exitCode = 1;
      return;
    }
    const parsed = parseCompose(content);
    if (!parsed.ok) {
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            provider: pack.id,
            diagnostics: parsed.diagnostics.map(toCommandDiagnostic),
          }),
        );
      else printDiagnostics(parsed.diagnostics);
      process.exitCode = 1;
      return;
    }
    const normalized = normalizeCompose(parsed.value);
    if (!normalized.ok) {
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            provider: pack.id,
            diagnostics: normalized.diagnostics.map(toCommandDiagnostic),
          }),
        );
      else printDiagnostics(normalized.diagnostics);
      process.exitCode = 1;
      return;
    }
    const rulesResult = applyRules(normalized.value, pack.rules);
    if (!rulesResult.ok) {
      if (options.json)
        printJson(
          makeCommandResult({
            command: "analyze",
            status: "error",
            provider: pack.id,
            diagnostics: rulesResult.diagnostics.map(toCommandDiagnostic),
          }),
        );
      else printDiagnostics(rulesResult.diagnostics);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      printJson(
        makeCommandResult({
          command: "analyze",
          status: "success",
          provider: pack.id,
          diagnostics: [...normalized.diagnostics, ...rulesResult.diagnostics].map(
            toCommandDiagnostic,
          ),
          recommendations: rulesResult.value.recommendations,
        }),
      );
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
  .option("--budget <level>", "budget priority (cheapest, balanced or production)")
  .option("-o, --out <dir>", "output directory", "dodeploy-infra")
  .option("--name <name>", "project name (interview-only mode)")
  .option("--no-interview", "skip the interactive interview")
  .option("--json", "write structured JSON result")
  .action(
    async (
      path: string | undefined,
      options: {
        provider?: string;
        budget?: string;
        out: string;
        name?: string;
        interview: boolean;
        json?: boolean;
      },
    ) => {
      const provider = options.provider as ProviderId | undefined;
      if (provider !== undefined && !Object.hasOwn(providers, provider)) {
        const message = `unknown provider: ${options.provider} (expected aws|gcp|azure)`;
        if (options.json)
          printJson(
            makeCommandResult({
              command: "generate",
              status: "error",
              diagnostics: [cliDiagnostic("input", message, "provider.unknown")],
            }),
          );
        else console.error(message);
        process.exitCode = 1;
        return;
      }
      const budget = options.budget as "cheapest" | "balanced" | "production" | undefined;
      if (
        budget !== undefined &&
        budget !== "cheapest" &&
        budget !== "balanced" &&
        budget !== "production"
      ) {
        const message = `unknown budget: ${options.budget} (expected cheapest|balanced|production)`;
        if (options.json)
          printJson(
            makeCommandResult({
              command: "generate",
              status: "error",
              diagnostics: [cliDiagnostic("input", message, "budget.unknown")],
            }),
          );
        else console.error(message);
        process.exitCode = 1;
        return;
      }
      if (options.json && options.interview) {
        const message =
          "--json requires --no-interview; pass --no-interview with explicit --provider/--budget/--name";
        printJson(
          makeCommandResult({
            command: "generate",
            status: "error",
            diagnostics: [cliDiagnostic("interview", message, "interview.json_unsupported")],
          }),
        );
        process.exitCode = 1;
        return;
      }
      if (options.interview && !process.stdin.isTTY) {
        const message =
          "interactive interview requires a terminal (stdin is not a TTY) — " +
          "re-run with --no-interview and pass --provider/--budget/--name explicitly";
        if (options.json)
          printJson(
            makeCommandResult({
              command: "generate",
              status: "error",
              diagnostics: [cliDiagnostic("interview", message, "interview.tty_required")],
            }),
          );
        else console.error(message);
        process.exitCode = 1;
        return;
      }
      const result = await generateProject({
        composePath: path,
        provider,
        budget,
        projectName: options.name,
        outDir: options.out,
        interview: options.interview,
        driver: options.interview ? new ClackDriver() : undefined,
      });
      if (!result.ok) {
        if (options.json)
          printJson(
            makeCommandResult({
              command: "generate",
              status: "error",
              provider,
              diagnostics: result.diagnostics.map(toCommandDiagnostic),
            }),
          );
        else printDiagnostics(result.diagnostics);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        printJson(
          makeCommandResult({
            command: "generate",
            status: result.deferred.length > 0 ? "deferred" : "success",
            provider,
            diagnostics: result.diagnostics.map(toCommandDiagnostic),
            recommendations: result.recommendations,
            files: result.filesWritten,
            deferred: result.deferred,
          }),
        );
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
  .option("--json", "write structured JSON result")
  .action((path: string | undefined, options: { json?: boolean }) => {
    const checks = runDoctor({ composePath: path });
    if (options.json) {
      const failed = checks.some((check) => check.critical && !check.ok);
      printJson(
        makeCommandResult({
          command: "doctor",
          status: failed ? "error" : "success",
          diagnostics: [],
          checks,
        }),
      );
      if (failed) process.exitCode = 1;
      return;
    }
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

  // Wrap help rows on narrow terminals: commander's default minWidthToWrap
  // (40) disables wrapping entirely at or below 40 columns. COLUMNS is honored
  // for non-TTY output where process.stdout.columns is undefined.
  const helpConfig = {
    helpWidth: Number(process.env.COLUMNS) || process.stdout.columns || 80,
    minWidthToWrap: 16,
  };
  for (const command of [program, analyzeCommand, generateCommand, doctorCommand]) {
    command.createHelp = () => Object.assign(new WrappingHelp(), helpConfig);
  }

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
  const command = argv[2];
  const jsonCommand =
    argv.includes("--json") &&
    (command === "analyze" || command === "generate" || command === "doctor");
  for (const command of [program, ...program.commands]) {
    command.configureOutput({
      writeErr: (message) => {
        if (!jsonCommand) process.stderr.write(message);
      },
      outputError: (message, write) => {
        if (!jsonCommand) write(message);
      },
    });
    command.exitOverride();
  }
  try {
    await program.parseAsync(argv);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "commander.helpDisplayed" || code === "commander.version") return;
    if (!jsonCommand) throw error;
    printJson(
      makeCommandResult({
        command: command as "analyze" | "generate" | "doctor",
        status: "error",
        diagnostics: [
          {
            code: "cli.usage_error",
            stage: "cli",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      }),
    );
    process.exitCode = 1;
  }
}
