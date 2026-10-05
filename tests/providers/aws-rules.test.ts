import { describe, expect, it } from "vitest";
import type { ProjectIR } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";
import { awsRulePack } from "../../src/providers/aws/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR, expectRec, webIR } from "./fixtures.js";

const runAws = (ir: ProjectIR) => {
  const result = applyRules(ir, awsRulePack.rules);
  if (!result.ok) throw new Error("applyRules failed");
  return result;
};

describe("aws rule pack", () => {
  it("recommends Fargate + ALB for a public web service", () => {
    const { value } = runAws(webIR);
    const fargate = expectRec(value.recommendations, "aws.compute.web-fargate");
    expect(fargate.costTier).toBe("medium");
    expect(fargate.message).toContain("ECS Fargate");
    expect(fargate.rationale.length).toBeGreaterThan(0);
  });

  it("recommends Fargate without ALB for workers", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "worker", source: "compose", kind: "worker", image: "img:1" }],
    });
    const { value } = runAws(ir);
    const worker = expectRec(value.recommendations, "aws.compute.worker-fargate");
    expect(worker.message).not.toContain("ALB");
  });

  it("recommends EC2 for stateful services", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "legacy", source: "compose", kind: "stateful", image: "img:1" }],
    });
    const { value } = runAws(ir);
    const ec2 = expectRec(value.recommendations, "aws.compute.stateful-ec2");
    expect(ec2.severity).toBe("warning");
    expect(ec2.costTier).toBe("low");
  });

  it("maps postgres and redis to managed AWS services", () => {
    const { value } = runAws(dbIR);
    expect(expectRec(value.recommendations, "aws.datastore.postgres-rds").message).toContain("RDS");
    expect(expectRec(value.recommendations, "aws.datastore.redis-elasticache").costTier).toBe(
      "medium",
    );
  });

  it("warns that DocumentDB has Mongo compatibility caveats", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      datastores: [{ name: "docs", engine: "mongodb", version: "7", detected: true }],
    });
    const { value } = runAws(ir);
    expect(expectRec(value.recommendations, "aws.datastore.mongodb-documentdb").severity).toBe(
      "suggestion",
    );
  });

  it("suggests a managed database when env URLs reference one but none is declared", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "img:1",
          secrets: ["DATABASE_URL"],
        },
      ],
    });
    const { value } = runAws(ir);
    const gap = expectRec(value.recommendations, "aws.gap.missing-database");
    expect(gap.severity).toBe("warning");
    expect(gap.message).toContain("RDS");
  });

  it("recommends supporting services: Cloud Map, Secrets Manager, EFS, S3", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "img:1",
          secrets: ["TOKEN"],
          dependsOn: ["db"],
        },
      ],
      datastores: [{ name: "db", engine: "postgres", detected: true }],
      storage: [
        { name: "uploads", kind: "shared-volume", source: "compose", sharedBy: ["api"] },
        { name: "assets", kind: "static-assets", source: "compose", sharedBy: [] },
      ],
      network: { serviceDiscovery: true },
    });
    const { value } = runAws(ir);
    expectRec(value.recommendations, "aws.network.service-discovery-cloudmap");
    expectRec(value.recommendations, "aws.secrets.secrets-manager");
    expectRec(value.recommendations, "aws.storage.shared-volume-efs");
    expectRec(value.recommendations, "aws.storage.static-s3");
  });

  it("recommends ECR for build contexts", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "app", source: "compose", kind: "web", buildContext: "./app" }],
    });
    const { value } = runAws(ir);
    expect(expectRec(value.recommendations, "aws.build.ecr").costTier).toBe("free");
  });

  it("recommends per target with cost tiers and skips Fargate for cheap targets", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        { name: "web", source: "compose", kind: "web", image: "img:1", target: "ec2" },
        { name: "api", source: "compose", kind: "web", image: "img:2", target: "apprunner" },
        { name: "jobs", source: "compose", kind: "worker", image: "img:3" },
      ],
    });
    const { value } = runAws(ir);
    expectRec(value.recommendations, "aws.compute.ec2-box");
    expectRec(value.recommendations, "aws.compute.app-runner");
    const fargateRecs = value.recommendations.filter((r) => r.ruleId === "aws.compute.web-fargate");
    expect(
      fargateRecs.every((r) => !r.message.includes('"web"') && !r.message.includes('"api"')),
    ).toBe(true);
    const workerFargate = value.recommendations.filter(
      (r) => r.ruleId === "aws.compute.worker-fargate",
    );
    expect(workerFargate.some((r) => r.message.includes('"jobs"'))).toBe(true);
  });

  it("rule ids are namespaced and unique", () => {
    const ids = awsRulePack.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("aws."))).toBe(true);
  });
});
