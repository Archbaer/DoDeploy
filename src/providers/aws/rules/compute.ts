import type { Rule } from "../../../rules/index.js";

const isFargateTarget = (target: string | undefined) =>
  target === undefined || target === "fargate";

export const webFargateRule: Rule = {
  id: "aws.compute.web-fargate",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "web" && isFargateTarget(c.target))
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on ECS Fargate behind an Application Load Balancer`,
        rationale:
          "Stateless container with public ports maps to Fargate tasks behind an ALB — no servers to manage, pay per use",
        costTier: "medium" as const,
      })),
};

export const workerFargateRule: Rule = {
  id: "aws.compute.worker-fargate",
  run: (ir) =>
    ir.compute
      .filter((c) => (c.kind === "worker" || c.kind === "cron") && isFargateTarget(c.target))
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on ECS Fargate`,
        rationale:
          "Internal container with no public ports runs as a Fargate service without a load balancer",
        costTier: "medium" as const,
      })),
};

export const ec2BoxRule: Rule = {
  id: "aws.compute.ec2-box",
  run: (ir) =>
    ir.compute
      .filter((c) => c.target === "ec2")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on a single EC2 box ($ — cheapest, no HA)`,
        rationale:
          "Single-VM docker deployment is the cheapest option but creates a single point of failure; use it for dev, hobby, or cost-constrained workloads",
        costTier: "low" as const,
      })),
};

export const appRunnerRule: Rule = {
  id: "aws.compute.app-runner",
  run: (ir) =>
    ir.compute
      .filter((c) => c.target === "apprunner")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on App Runner ($$ — managed, web only, needs a pushed image)`,
        rationale:
          "App Runner is a managed container service for web workloads; it removes server management but requires a built image in ECR",
        costTier: "low" as const,
      })),
};

export const statefulEc2Rule: Rule = {
  id: "aws.compute.stateful-ec2",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "stateful")
      .map((c) => ({
        severity: "warning" as const,
        message: `Service "${c.name}": run on EC2 (auto-scaling group) — Fargate does not support stateful/host workloads`,
        rationale:
          "Stateful services need persistent host state or privileged operations that Fargate does not support; EC2 with an ASG keeps replacement automated",
        costTier: "low" as const,
      })),
};
