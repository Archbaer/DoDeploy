import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compose = resolve(root, "tests/compose/fixtures/web-db-redis.yaml");
const outputRoot = resolve(tmpdir(), `dodeploy-ai-cli-eval-${Date.now()}`);
const cli = ["--import", "tsx", resolve(root, "src/bin.ts")];
const providers = ["aws", "gcp", "azure"];

mkdirSync(outputRoot, { recursive: true });

function run(args) {
  const started = performance.now();
  try {
    const stdout = execFileSync(process.execPath, [...cli, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, elapsedMs: Math.round(performance.now() - started), stdout };
  } catch (error) {
    return {
      exitCode: typeof error.status === "number" ? error.status : 1,
      elapsedMs: Math.round(performance.now() - started),
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

const results = providers.map((provider) => {
  const analyzed = run(["analyze", compose, "--provider", provider]);
  const outDir = join(outputRoot, provider);
  const generated = run([
    "generate",
    compose,
    "--provider",
    provider,
    "--no-interview",
    "--out",
    outDir,
  ]);
  const files = generated.exitCode === 0 ? readdirSync(outDir).sort() : [];
  const byteCount = files.reduce((total, file) => total + statSync(join(outDir, file)).size, 0);
  const todoCount = files.reduce((total, file) => {
    const content = readFileSync(join(outDir, file), "utf8");
    return total + (content.match(/TODO\(dodeploy\)/g)?.length ?? 0);
  }, 0);
  return {
    provider,
    analyze: {
      exitCode: analyzed.exitCode,
      elapsedMs: analyzed.elapsedMs,
      recommendations: Number(analyzed.stdout.match(/Recommendations \([^)]*\): (\d+)/)?.[1] ?? 0),
      outputBytes: Buffer.byteLength(analyzed.stdout),
    },
    generate: {
      exitCode: generated.exitCode,
      elapsedMs: generated.elapsedMs,
      files,
      totalBytes: byteCount,
      deferredTodoCount: todoCount,
      outputDir: outDir,
    },
  };
});

const report = {
  fixture: "tests/compose/fixtures/web-db-redis.yaml",
  node: process.version,
  cloudCredentialsUsed: false,
  terraformValidation: "not run; install Terraform separately to validate generated HCL",
  artifacts: outputRoot,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (results.some((result) => result.analyze.exitCode !== 0 || result.generate.exitCode !== 0)) {
  process.exitCode = 1;
}
