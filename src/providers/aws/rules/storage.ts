import type { Rule } from "../../../rules/index.js";

export const sharedVolumeEfsRule: Rule = {
  id: "aws.storage.shared-volume-efs",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "shared-volume")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Volume "${s.name}": Amazon EFS (shared by ${s.sharedBy.join(", ") || "services"})`,
        rationale:
          "Shared named volumes used by multiple services need a network file system; EFS mounts across Fargate tasks and EC2",
        costTier: "medium" as const,
      })),
};

export const staticS3Rule: Rule = {
  id: "aws.storage.static-s3",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "static-assets" || s.kind === "uploads")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Storage "${s.name}": Amazon S3${s.kind === "static-assets" ? " + CloudFront" : ""}`,
        rationale:
          "Object storage is cheaper and more durable than file servers for static assets and user uploads",
        costTier: "low" as const,
      })),
};
