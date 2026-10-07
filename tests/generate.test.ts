import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateProject } from "../src/generate.js";
import type { InterviewDriver } from "../src/interview/driver.js";
import { ScriptedDriver } from "../src/interview/index.js";

const FIXTURES = join(process.cwd(), "tests/compose/fixtures");
const WEB_DB_REDIS = join(FIXTURES, "web-db-redis.yaml");
const WEB_WORKER_DB_VOLUME = join(FIXTURES, "web-worker-db-volume.yaml");

const GENERATED_FILES = [
  "providers.tf",
  "variables.tf",
  "network.tf",
  "compute.tf",
  "data.tf",
  "outputs.tf",
];

describe("generateProject", async () => {
  it.each([
    ["gcp", "europe-west1", "google_cloud_run_v2_service"],
    ["azure", "westeurope", "azurerm_container_app"],
  ] as const)(
    "preserves explicit %s provider and skips provider interview",
    async (provider, region, marker) => {
      const out = mkdtempSync(join(tmpdir(), "dd-gen-provider-"));
      const driver = new ScriptedDriver([
        "balanced",
        region,
        "containers",
        "api",
        "web",
        false,
        false,
      ]);
      const interviewDriver: InterviewDriver = driver;
      const select = interviewDriver.select.bind(driver);
      const prompts = vi
        .spyOn(interviewDriver, "select")
        .mockImplementation((message, options) =>
          message === "Target cloud provider?"
            ? Promise.resolve("aws" as never)
            : select(message, options),
        );
      const result = await generateProject({ provider, outDir: out, interview: true, driver });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain(marker);
      expect(driver.exhausted()).toBe(true);
      expect(prompts.mock.calls.some(([message]) => message === "Target cloud provider?")).toBe(
        false,
      );
    },
  );

  it.each(["", "   "])(
    "rejects an empty/whitespace project name without a stack trace (issue #42)",
    async (projectName) => {
      const out = mkdtempSync(join(tmpdir(), "dd-gen-empty-name-"));
      const result = await generateProject({
        projectName,
        outDir: out,
        interview: true,
        driver: new ScriptedDriver([]),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.message).toContain("project name must not be empty");
    },
  );

  it("runs compose → rules → render for AWS and writes the fileset", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-aws-"));
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      provider: "aws",
      outDir: out,
      interview: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const file of GENERATED_FILES) {
      expect(existsSync(join(out, file))).toBe(true);
    }
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain("aws_ecs_cluster");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it.each([
    ["gcp", "google_cloud_run_v2_service"],
    ["azure", "azurerm_container_app"],
  ] as const)("generates %s with its compute resources", async (provider, marker) => {
    const out = mkdtempSync(join(tmpdir(), `dd-gen-${provider}-`));
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      provider,
      outDir: out,
      interview: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain(marker);
  });

  it("fails cleanly when the compose file is missing", async () => {
    const result = await generateProject({
      composePath: join(FIXTURES, "does-not-exist.yaml"),
      provider: "aws",
      outDir: "unused",
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.stage === "compose")).toBe(true);
  });

  it("fails cleanly for invalid compose YAML", async () => {
    const result = await generateProject({
      composePath: join(FIXTURES, "bad-yaml.yaml"),
      provider: "aws",
      outDir: "unused",
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.stage === "compose")).toBe(true);
  });

  it("fails without provider in non-interactive mode", async () => {
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      outDir: "unused",
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.message.includes("provider"))).toBe(true);
  });

  it("fails without compose in non-interactive mode", async () => {
    const result = await generateProject({
      provider: "aws",
      outDir: "unused",
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.message.includes("interview"))).toBe(true);
  });

  it("interview-only path: scripted driver fills all gaps end-to-end", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-interview-"));
    const driver = new ScriptedDriver([
      "aws", // provider (source === "interview")
      "balanced", // budget
      "us-east-1", // region
      "containers", // workload type
      "api, worker", // service names
      "web", // kind
      "fargate", // target for api
      "fargate", // target for worker
      true, // needs a database
      "postgres", // engine
      false, // static assets / uploads
    ]);
    const result = await generateProject({
      projectName: "demo",
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain("aws_ecs_cluster");
    expect(readFileSync(join(out, "data.tf"), "utf8")).toContain("aws_db_instance");
    expect(driver.exhausted()).toBe(true);
  });

  it("fails cleanly when the output directory cannot be created", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-gen-outfile-"));
    const out = join(dir, "outfile");
    writeFileSync(out, "not a directory");
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      provider: "aws",
      outDir: out,
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.stage === "write")).toBe(true);
  });

  it("fails cleanly on a partial write", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-partial-"));
    mkdirSync(join(out, "providers.tf"));
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      provider: "aws",
      outDir: out,
      interview: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.stage === "write")).toBe(true);
  });

  it("passes --budget through so the interview skips the budget question", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-budget-"));
    const driver = new ScriptedDriver([
      "us-east-1", // region (provider+budget given)
      "containers",
      "api",
      "web",
      "fargate", // target for api
      false,
      false,
    ]);
    const result = await generateProject({
      provider: "aws",
      budget: "production",
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(driver.exhausted()).toBe(true);
  });

  it("journey: interview-only cheapest renders an EC2 box", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-cheapest-"));
    const driver = new ScriptedDriver([
      "aws",
      "cheapest",
      "us-east-1",
      "containers",
      "web",
      "web",
      "ec2",
      false,
      false,
    ]);
    const result = await generateProject({
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(out, "ec2.tf"))).toBe(true);
    expect(readFileSync(join(out, "compute.tf"), "utf8")).not.toContain("aws_ecs_cluster");
  });

  it("journey: interview-only production renders Fargate", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-production-"));
    const driver = new ScriptedDriver([
      "aws",
      "production",
      "us-east-1",
      "containers",
      "web",
      "web",
      "fargate",
      false,
      false,
    ]);
    const result = await generateProject({
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(out, "ec2.tf"))).toBe(false);
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain("aws_ecs_cluster");
  });

  it("journey: compose balanced renders App Runner and Fargate", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-balanced-"));
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "apprunner", // target for web
      "fargate", // target for worker
      true, // keep public ports
      true, // manage postgres
      true, // keep named volume
    ]);
    const result = await generateProject({
      composePath: WEB_WORKER_DB_VOLUME,
      provider: "aws",
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(out, "apprunner.tf"))).toBe(true);
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain("aws_ecs_cluster");
    expect(readFileSync(join(out, "data.tf"), "utf8")).toContain("aws_db_instance");
  });

  it("journey: compose cheapest declines managed DBs and renders one EC2 box", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-cheapest-compose-"));
    const driver = new ScriptedDriver([
      "cheapest",
      "us-east-1",
      "ec2", // target for web
      "ec2", // target for worker
      true, // keep public ports
      false, // decline managed postgres
      true, // keep named volume
    ]);
    const result = await generateProject({
      composePath: WEB_WORKER_DB_VOLUME,
      provider: "aws",
      outDir: out,
      interview: true,
      driver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(out, "ec2.tf"))).toBe(true);
    expect(readFileSync(join(out, "data.tf"), "utf8")).not.toContain("aws_db_instance");
    expect(result.diagnostics.some((d) => d.message.includes("db"))).toBe(true);
  });

  it("journey: non-interactive --budget cheapest keeps targets as Fargate", async () => {
    const out = mkdtempSync(join(tmpdir(), "dd-gen-noninteractive-budget-"));
    const result = await generateProject({
      composePath: WEB_DB_REDIS,
      provider: "aws",
      budget: "cheapest",
      outDir: out,
      interview: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(out, "compute.tf"), "utf8")).toContain("aws_ecs_cluster");
  });
});
