import type { Rule } from "../../../rules/index.js";

export const sharedFilesRule: Rule = {
  id: "azure.storage.shared-files",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "shared-volume")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Volume "${s.name}": Azure Files (shared by ${s.sharedBy.join(", ") || "services"})`,
        rationale:
          "Shared named volumes need an SMB/NFS file share; Azure Files mounts across containers and VMs",
        costTier: "medium" as const,
      })),
};

export const staticBlobRule: Rule = {
  id: "azure.storage.static-blob",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "static-assets" || s.kind === "uploads")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Storage "${s.name}": Azure Blob Storage${s.kind === "static-assets" ? " + Azure CDN" : ""}`,
        rationale:
          "Object storage is cheaper and more durable than file servers for static assets and user uploads",
        costTier: "low" as const,
      })),
};

export const serviceDiscoveryPrivateDnsRule: Rule = {
  id: "azure.network.service-discovery-privatedns",
  run: (ir) =>
    ir.network.serviceDiscovery
      ? [
          {
            severity: "suggestion" as const,
            message: "Service discovery: Azure Private DNS",
            rationale:
              "Compose service names resolve over the internal network; Private DNS zones provide the same DNS-based discovery",
            costTier: "low" as const,
          },
        ]
      : [],
};

export const keyVaultRule: Rule = {
  id: "azure.secrets.keyvault",
  run: (ir) => {
    const secretKeys = [...new Set(ir.compute.flatMap((c) => c.secrets))];
    return secretKeys.length > 0
      ? [
          {
            severity: "suggestion" as const,
            message: `Secrets: Azure Key Vault (${secretKeys.length} detected)`,
            rationale:
              "Environment variables holding credentials should live in Key Vault and be injected at runtime, not baked into images",
            costTier: "low" as const,
          },
        ]
      : [];
  },
};

export const acrRule: Rule = {
  id: "azure.build.acr",
  run: (ir) => {
    const builders = ir.compute.filter((c) => c.buildContext !== undefined);
    return builders.length > 0
      ? [
          {
            severity: "info" as const,
            message: `Container registry: Azure Container Registry for ${builders.map((b) => `"${b.name}"`).join(", ")}`,
            rationale:
              "Compose build contexts need a registry to deploy from; ACR is the native Azure option",
            costTier: "free" as const,
          },
        ]
      : [];
  },
};
