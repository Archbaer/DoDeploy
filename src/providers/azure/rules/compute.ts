import type { Rule } from "../../../rules/index.js";

export const webContainerAppsRule: Rule = {
  id: "azure.compute.web-containerapps",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "web")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on Azure Container Apps`,
        rationale:
          "Stateless HTTP containers map to Container Apps — built-in ingress, scales to zero, no cluster management",
        costTier: "medium" as const,
      })),
};

export const workerContainerAppsRule: Rule = {
  id: "azure.compute.worker-containerapps",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "worker" || c.kind === "cron")
      .map((c) => ({
        severity: "suggestion" as const,
        message: `Service "${c.name}": run on Azure Container Apps`,
        rationale: "Internal container workloads fit Container Apps background jobs/replicas",
        costTier: "medium" as const,
      })),
};

export const statefulVmssRule: Rule = {
  id: "azure.compute.stateful-vmss",
  run: (ir) =>
    ir.compute
      .filter((c) => c.kind === "stateful")
      .map((c) => ({
        severity: "warning" as const,
        message: `Service "${c.name}": run on Virtual Machine Scale Sets — Container Apps does not support stateful/host workloads`,
        rationale:
          "Stateful services need persistent host state that Container Apps does not provide; VMSS keeps replacement automated",
        costTier: "low" as const,
      })),
};
