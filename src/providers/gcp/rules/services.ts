import type { Rule } from "../../../rules/index.js";

export const sharedFilestoreRule: Rule = {
  id: "gcp.storage.shared-filestore",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "shared-volume")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Volume "${s.name}": Filestore (shared by ${s.sharedBy.join(", ") || "services"})`,
        rationale:
          "Shared named volumes need a network file system; Filestore mounts across GCE and GKE",
        costTier: "medium" as const,
      })),
};

export const staticGcsRule: Rule = {
  id: "gcp.storage.static-gcs",
  run: (ir) =>
    ir.storage
      .filter((s) => s.kind === "static-assets" || s.kind === "uploads")
      .map((s) => ({
        severity: "suggestion" as const,
        message: `Storage "${s.name}": Cloud Storage${s.kind === "static-assets" ? " + Cloud CDN" : ""}`,
        rationale:
          "Object storage is cheaper and more durable than file servers for static assets and user uploads",
        costTier: "low" as const,
      })),
};

export const serviceDiscoveryDnsRule: Rule = {
  id: "gcp.network.service-discovery-dns",
  run: (ir) =>
    ir.network.serviceDiscovery
      ? [
          {
            severity: "suggestion" as const,
            message: "Service discovery: internal Cloud DNS / Service Directory",
            rationale:
              "Compose service names resolve over the internal network; internal DNS zones or Service Directory provide the same discovery",
            costTier: "low" as const,
          },
        ]
      : [],
};

export const secretManagerRule: Rule = {
  id: "gcp.secrets.secretmanager",
  run: (ir) => {
    const secretKeys = [...new Set(ir.compute.flatMap((c) => c.secrets))];
    return secretKeys.length > 0
      ? [
          {
            severity: "suggestion" as const,
            message: `Secrets: Secret Manager (${secretKeys.length} detected)`,
            rationale:
              "Environment variables holding credentials should live in Secret Manager and be injected at runtime, not baked into images",
            costTier: "low" as const,
          },
        ]
      : [];
  },
};

export const artifactRegistryRule: Rule = {
  id: "gcp.build.artifactregistry",
  run: (ir) => {
    const builders = ir.compute.filter((c) => c.buildContext !== undefined);
    return builders.length > 0
      ? [
          {
            severity: "info" as const,
            message: `Container registry: Artifact Registry for ${builders.map((b) => `"${b.name}"`).join(", ")}`,
            rationale:
              "Compose build contexts need a registry to deploy from; Artifact Registry is the native GCP option",
            costTier: "free" as const,
          },
        ]
      : [];
  },
};
