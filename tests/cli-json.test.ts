import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandResultSchema } from "../src/cli-result.js";

const runCli = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "src/bin.ts", ...args],
      { cwd: process.cwd(), timeout: 15000 },
      (error, stdout, stderr) => {
        resolve({
          code:
            error && typeof (error as { code?: number }).code === "number"
              ? (error as { code: number }).code
              : 0,
          stdout,
          stderr,
        });
      },
    );
  });

const parseOutput = (stdout: string) => {
  expect(stdout.trim()).not.toBe("");
  expect(stdout.trim().split("\n")).toHaveLength(1);
  return commandResultSchema.parse(JSON.parse(stdout));
};

describe("CLI JSON contract", () => {
  it("returns analyze success and recommendations", async () => {
    const result = await runCli([
      "analyze",
      "tests/compose/fixtures/web-db-redis.yaml",
      "--provider",
      "aws",
      "--json",
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const output = parseOutput(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: "1.0",
      command: "analyze",
      status: "success",
      provider: "aws",
    });
    expect(output.recommendations.length).toBeGreaterThan(0);
  });

  it("returns stable diagnostic on unreadable input", async () => {
    const result = await runCli(["analyze", "missing-compose.yaml", "--json"]);
    expect(result.code).toBe(1);
    const output = parseOutput(result.stdout);
    expect(output.status).toBe("error");
    expect(output.diagnostics[0]).toMatchObject({ code: "input.unreadable", severity: "error" });
  });

  it("returns generation files and deferred status", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-json-gen-"));
    const result = await runCli([
      "generate",
      "tests/compose/fixtures/build-only.yaml",
      "--provider",
      "aws",
      "--no-interview",
      "--json",
      "--out",
      out,
    ]);
    expect(result.code).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.status).toBe("deferred");
    expect(output.files).toContain("providers.tf");
    expect(output.deferred.length).toBeGreaterThan(0);
  });

  it("returns unknown provider error as JSON", async () => {
    const result = await runCli([
      "generate",
      "--provider",
      "digitalocean",
      "--json",
      "--no-interview",
    ]);
    expect(result.code).toBe(1);
    const output = parseOutput(result.stdout);
    expect(output.diagnostics[0]?.code).toBe("provider.unknown");
  });

  it("returns unknown budget error as JSON", async () => {
    const result = await runCli([
      "generate",
      "tests/compose/fixtures/web-db-redis.yaml",
      "--provider",
      "aws",
      "--budget",
      "unlimited",
      "--json",
      "--no-interview",
    ]);
    expect(result.code).toBe(1);
    const output = parseOutput(result.stdout);
    expect(output.diagnostics[0]?.code).toBe("budget.unknown");
  });

  it("rejects JSON interview with actionable JSON error", async () => {
    const result = await runCli(["generate", "--json"]);
    expect(result.code).toBe(1);
    const output = parseOutput(result.stdout);
    expect(output.diagnostics[0]).toMatchObject({ code: "interview.json_unsupported" });
    expect(output.diagnostics[0]?.message).toContain("--no-interview");
  });

  it("returns doctor checks and keeps missing Terraform advisory", async () => {
    const result = await runCli(["doctor", "tests/compose/fixtures/web-db-redis.yaml", "--json"]);
    expect(result.code).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.command).toBe("doctor");
    expect(output.checks?.find((check) => check.id === "terraform")?.critical).toBe(false);
    expect(output.checks?.find((check) => check.id === "compose")?.ok).toBe(true);
  });

  it("rejects unsupported schema versions in consumers", () => {
    expect(() =>
      commandResultSchema.parse({
        schemaVersion: "2.0",
        command: "doctor",
        status: "success",
        diagnostics: [],
      }),
    ).toThrow();
  });

  it("returns malformed command usage as JSON", async () => {
    const result = await runCli(["generate", "--json", "--budget"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const output = parseOutput(result.stdout);
    expect(output.diagnostics[0]).toMatchObject({ code: "cli.usage_error", severity: "error" });
  });
});
