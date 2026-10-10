import type { ComputeTarget } from "../ir/schema.js";

export type ProviderId = "aws" | "gcp" | "azure";

export interface TargetRequirements {
  provider: ProviderId;
  kind: "web" | "worker" | "cron" | "stateful";
  publicPorts: boolean;
  image?: string;
  stateful: boolean;
}

/** Return only implemented AWS targets compatible with the stated requirements. */
export function eligibleTargets(requirements: TargetRequirements): ComputeTarget[] {
  if (
    requirements.provider !== "aws" ||
    requirements.stateful ||
    requirements.kind === "stateful"
  ) {
    return [];
  }
  const targets: ComputeTarget[] = ["fargate", "ec2"];
  const image = requirements.image ?? "";
  if (
    requirements.kind === "web" &&
    requirements.publicPorts &&
    (image.startsWith("public.ecr.aws/") || image.includes(".dkr.ecr."))
  ) {
    targets.push("apprunner");
  }
  return targets;
}

export const defaultRegion = (provider: ProviderId): string =>
  ({ aws: "us-east-1", gcp: "us-central1", azure: "eastus" })[provider];
