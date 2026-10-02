import type { Rule } from "../../../rules/index.js";

export const webCloudRunRule: Rule = {
  id: "gcp.compute.web-cloudrun",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "web")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on Cloud Run`,
        rationale:
          "Stateless HTTP containers map directly to Cloud Run — scales to zero, no cluster or server management",
        costTier: "low" as const,
      })),
};

export const workerCloudRunRule: Rule = {
  id: "gcp.compute.worker-cloudrun",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "worker" || c.kind === "cron")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on Cloud Run jobs`,
        rationale: "Internal/container workloads without HTTP ingress fit Cloud Run jobs",
        costTier: "low" as const,
      })),
};

export const statefulGceRule: Rule = {
  id: "gcp.compute.stateful-gce",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "stateful")
      .map((c) => ({
        severity: "warning" as const,
        message: `Service "${c.name}": run on Compute Engine — Cloud Run does not support stateful/host workloads`,
        rationale:
          "Stateful services need persistent disks and host control that Cloud Run does not provide; GCE with instance groups keeps replacement automated",
        costTier: "low" as const,
      })),
};
