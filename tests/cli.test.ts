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
  it("--help exits 0 and lists the stub commands", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: dodeploy");
    expect(stdout).toContain("analyze");
    expect(stdout).toContain("generate");
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
