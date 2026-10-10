import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Recipe {
  provider: "aws" | "gcp" | "azure";
  budget?: "cheapest" | "balanced" | "production";
  services?: string[];
  roles?: string[];
  images?: string[];
  datastores?: string[];
  datastore_names?: string[];
  versions?: string[];
  dependencies?: string[];
  ports?: string[];
  public?: boolean[];
  omitFlags?: boolean;
  imageKinds?: string[];
  managed?: boolean[];
  persistent?: boolean[];
  volumeNames?: string[];
  storageAssets?: boolean;
  storageChoice?: "static-assets" | "uploads" | "both";
}

function runPty(recipe: Recipe, options: { cancelAt?: string } = {}) {
  const out = mkdtempSync(join(tmpdir(), "dodeploy-pty-"));
  const command = [process.execPath, "--import", "tsx", "src/bin.ts", "generate"];
  if (!recipe.omitFlags)
    command.push("--provider", recipe.provider, "--budget", recipe.budget ?? "balanced");
  command.push("--name", `pty-${recipe.provider}`, "--out", out);
  const payload = JSON.stringify({
    command,
    ...recipe,
    ...(options.cancelAt ? { cancelAt: options.cancelAt } : {}),
  });
  const raw = execFileSync("python3", ["tests/helpers/cli-pty.py", payload], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 2_000_000,
  });
  return {
    out,
    result: JSON.parse(raw) as { status: number; output: string; counts: Record<string, number> },
  };
}

const appDbCache: Recipe = {
  provider: "aws",
  services: ["api", "worker"],
  roles: ["web", "worker"],
  images: ["ghcr.io/example/api:1.0", "ghcr.io/example/worker:1.0"],
  datastores: ["postgres", "redis"],
  datastore_names: ["db", "cache"],
  versions: ["16", "7"],
  dependencies: ["db, cache", "db, cache"],
};

describe("actual CLI interview PTY journeys", () => {
  it.each(["aws", "gcp", "azure"] as const)(
    "completes web + PostgreSQL + Redis on %s",
    (provider) => {
      const { out, result } = runPty({ ...appDbCache, provider });
      expect(result.status, result.output).toBe(0);
      expect(readdirSync(out)).toContain("compute.tf");
      expect(readFileSync(join(out, "data.tf"), "utf8")).toMatch(/postgres|mysql|redis/i);
      if (provider === "gcp") expect(result.output).toContain("Cloud Run job");
    },
  );

  it("asks provider and budget when flags omitted", () => {
    const { result } = runPty({
      ...appDbCache,
      provider: "gcp",
      budget: "production",
      omitFlags: true,
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Target cloud provider?");
    expect(result.output).toContain("What matters most for this deployment?");
    expect(result.output).toContain("us-central1");
  });

  it("selects AWS cheapest compatible EC2 target", () => {
    const { out, result } = runPty({
      provider: "aws",
      budget: "cheapest",
      services: ["web"],
      roles: ["web"],
      images: ["public.ecr.aws/example/web:1"],
      public: [true],
    });
    expect(result.status, result.output).toBe(0);
    expect(readdirSync(out)).toContain("ec2.tf");
  });

  it("selects AWS App Runner for compatible public ECR image", () => {
    const { out, result } = runPty({
      provider: "aws",
      budget: "balanced",
      services: ["web"],
      roles: ["web"],
      images: ["public.ecr.aws/example/web:1"],
      public: [true],
    });
    expect(result.status, result.output).toBe(0);
    expect(readdirSync(out)).toContain("apprunner.tf");
  });

  it("preserves different API and worker roles", () => {
    const { out, result } = runPty({
      provider: "aws",
      services: ["api", "worker"],
      roles: ["web", "worker"],
      images: ["ghcr.io/example/api:1", "ghcr.io/example/worker:1"],
      public: [true],
    });
    expect(result.status, result.output).toBe(0);
    const compute = readFileSync(join(out, "compute.tf"), "utf8");
    expect(compute).toContain("api");
    expect(compute).toContain("worker");
  });

  it("records external datastore choice without creating managed DB resource", () => {
    const { out, result } = runPty({
      provider: "aws",
      services: ["api"],
      roles: ["web"],
      images: ["ghcr.io/example/api:1"],
      datastores: ["postgres"],
      datastore_names: ["external-db"],
      versions: ["16"],
      managed: [false],
      dependencies: ["external-db"],
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("is external");
    expect(readFileSync(join(out, "data.tf"), "utf8")).not.toContain("aws_db_instance");
  });

  it("keeps persistent volume request explicitly deferred", () => {
    const { result } = runPty({
      provider: "aws",
      services: ["api"],
      roles: ["worker"],
      images: ["ghcr.io/example/api:1"],
      persistent: [true],
      volumeNames: ["uploads"],
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("no managed mount is emitted");
  });

  it("collects static and upload object storage separately", () => {
    const { out, result } = runPty({
      provider: "aws",
      services: ["api"],
      roles: ["worker"],
      images: ["ghcr.io/example/api:1"],
      storageAssets: true,
      storageChoice: "both",
    });
    expect(result.status, result.output).toBe(0);
    expect(readFileSync(join(out, "data.tf"), "utf8")).toContain("aws_s3_bucket");
  });

  it("recovers from duplicate service name and preserves build context + dependencies", () => {
    const { out, result } = runPty({
      provider: "aws",
      services: ["api", "api", "worker"],
      roles: ["web", "worker"],
      imageKinds: ["build", "pushed"],
      images: ["./api", "ghcr.io/example/worker:1"],
      dependencies: ["worker", "api"],
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Name already used");
    expect(result.output).toContain("image build/push");
    expect(readFileSync(join(out, "variables.tf"), "utf8")).toContain("api_image");
  });

  it("retries invalid port answer in terminal", () => {
    const { result } = runPty({
      provider: "aws",
      services: ["api"],
      roles: ["web"],
      images: ["ghcr.io/example/api:1"],
      ports: ["bad", "8080"],
    });
    expect(result.status, result.output).toBe(0);
  });

  it("cancels cleanly without writing when user presses Escape", () => {
    const { result, out } = runPty({ provider: "aws" }, { cancelAt: "Service name?" });
    expect(result.status, result.output).toBe(130);
    expect(readdirSync(out)).toEqual([]);
  });
});
