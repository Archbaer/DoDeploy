import type { Rule } from "../../../rules/index.js";

export const webFargateRule: Rule = {
  id: "aws.compute.web-fargate",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "web")
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
      .filter((c) => c.kind === "worker" || c.kind === "cron")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on ECS Fargate`,
        rationale:
          "Internal container with no public ports runs as a Fargate service without a load balancer",
        costTier: "medium" as const,
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
