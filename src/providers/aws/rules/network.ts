import type { Rule } from "../../../rules/index.js";

export const serviceDiscoveryCloudMapRule: Rule = {
  id: "aws.network.service-discovery-cloudmap",
  run: (ir) =>
    ir.network.serviceDiscovery
      ? [
          {
            severity: "suggestion" as const,
            message: "Service discovery: AWS Cloud Map",
            rationale:
              "Compose service names resolve over the internal network; Cloud Map provides the same DNS-based service discovery",
            costTier: "low" as const,
          },
        ]
      : [],
};

export const secretsManagerRule: Rule = {
  id: "aws.secrets.secrets-manager",
  run: (ir) => {
    const secretKeys = [...new Set(ir.compute.flatMap((c) => c.secrets))];
    return secretKeys.length > 0
      ? [
          {
            severity: "suggestion" as const,
            message: `Secrets: AWS Secrets Manager (${secretKeys.length} detected)`,
            rationale:
              "Environment variables holding credentials should live in Secrets Manager and be injected at runtime, not baked into images",
            costTier: "low" as const,
          },
        ]
      : [];
  },
};

export const ecrRule: Rule = {
  id: "aws.build.ecr",
  run: (ir) => {
    const builders = ir.compute.filter((c) => c.buildContext !== undefined);
    return builders.length > 0
      ? [
          {
            severity: "info" as const,
            message: `Container registry: Amazon ECR for ${builders.map((b) => `"${b.name}"`).join(", ")}`,
            rationale:
              "Compose build contexts need a registry to deploy from; ECR is the native AWS option and integrates with ECS task definitions",
            costTier: "free" as const,
          },
        ]
      : [];
  },
};
