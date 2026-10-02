import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderBanner } from "../src/ui/banner.js";

const runCli = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "src/bin.ts", ...args],
      { cwd: process.cwd() },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });

describe("banner", () => {
  it("renders the figlet title and tagline", () => {
    const banner = renderBanner();
    expect(banner).toContain("docker compose");
    expect(banner.split("\n").length).toBeGreaterThan(3);
  });

  it("renders a custom title in uppercase ASCII art", () => {
    const banner = renderBanner("TEST");
    expect(banner).toContain("____");
  });
});

describe("cli", () => {
  it("--help exits 0 and lists the commands", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: dodeploy");
    expect(stdout).toContain("analyze");
    expect(stdout).toContain("generate");
    expect(stdout).toContain("doctor");
  });

  it("bare invocation prints the banner and help, exits 0", async () => {
    const { code, stdout } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain("docker compose");
    expect(stdout).toContain("Usage: dodeploy");
  });

  it("--version prints the package version", async () => {
    const pkg = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ),
    ) as { version: string };
    const { code, stdout } = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });
});

describe("commands", () => {
  it("analyze reports findings and recommendations for a provider", async () => {
    const { code, stdout } = await runCli([
      "analyze",
      "tests/compose/fixtures/web-db-redis.yaml",
      "--provider",
      "aws",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Recommendations");
    expect(stdout).toContain("aws");
  });

  it("analyze exits 1 for a missing compose file", async () => {
    const { code, stdout, stderr } = await runCli(["analyze", "tests/compose/fixtures/nope.yaml"]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain("compose");
  });

  it("generate --no-interview writes a Terraform fileset", async () => {
    const { mkdtempSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const out = mkdtempSync(join(tmpdir(), "dd-cli-gen-"));
    const { code, stdout } = await runCli([
      "generate",
      "tests/compose/fixtures/web-db-redis.yaml",
      "--provider",
      "gcp",
      "--out",
      out,
      "--no-interview",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("providers.tf");
    expect(existsSync(join(out, "compute.tf"))).toBe(true);
  });

  it("generate exits 1 without --provider in non-interactive mode", async () => {
    const { code, stdout, stderr } = await runCli([
      "generate",
      "tests/compose/fixtures/web-db-redis.yaml",
      "--no-interview",
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain("provider");
  });

  it("doctor exits 0 on a valid compose file (terraform check is advisory)", async () => {
    const { code, stdout } = await runCli(["doctor", "tests/compose/fixtures/web-db-redis.yaml"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Terraform CLI");
    expect(stdout).toContain("Compose file");
  });
});
