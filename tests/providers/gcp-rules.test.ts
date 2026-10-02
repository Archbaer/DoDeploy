import { describe, expect, it } from "vitest";
import type { ProjectIR } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";
import { gcpRulePack } from "../../src/providers/gcp/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR, expectRec, webIR } from "./fixtures.js";

const runGcp = (ir: ProjectIR) => {
  const result = applyRules(ir, gcpRulePack.rules);
  if (!result.ok) throw new Error("applyRules failed");
  return result;
};

describe("gcp rule pack", () => {
  it("recommends Cloud Run for a public web service", () => {
    const { value } = runGcp(webIR);
    const web = expectRec(value.recommendations, "gcp.compute.web-cloudrun");
    expect(web.costTier).toBe("low");
    expect(web.message).toContain("Cloud Run");
  });

  it("maps postgres and redis to Cloud SQL and Memorystore", () => {
    const { value } = runGcp(dbIR);
    expect(expectRec(value.recommendations, "gcp.datastore.postgres-cloudsql").message).toContain(
      "Cloud SQL",
    );
    expect(expectRec(value.recommendations, "gcp.datastore.redis-memorystore").costTier).toBe(
      "medium",
    );
  });

  it("warns that GCP has no native managed MongoDB", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      datastores: [{ name: "docs", engine: "mongodb", version: "7", detected: true }],
    });
    const { value } = runGcp(ir);
    const mongo = expectRec(value.recommendations, "gcp.datastore.mongodb-no-native");
    expect(mongo.severity).toBe("warning");
  });

  it("suggests Cloud SQL when a database is referenced but not declared", () => {
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
    const { value } = runGcp(ir);
    expect(expectRec(value.recommendations, "gcp.gap.missing-database").message).toContain(
      "Cloud SQL",
    );
  });

  it("recommends GCE for stateful services", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "legacy", source: "compose", kind: "stateful", image: "img:1" }],
    });
    const { value } = runGcp(ir);
    expect(expectRec(value.recommendations, "gcp.compute.stateful-gce").severity).toBe("warning");
  });

  it("recommends supporting services: Filestore, GCS, DNS, Secret Manager, Artifact Registry", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "img:1",
          secrets: ["TOKEN"],
          buildContext: "./api",
          dependsOn: ["db"],
        },
      ],
      datastores: [{ name: "db", engine: "postgres", detected: true }],
      storage: [{ name: "uploads", kind: "shared-volume", source: "compose", sharedBy: ["api"] }],
      network: { serviceDiscovery: true },
    });
    const { value } = runGcp(ir);
    expectRec(value.recommendations, "gcp.storage.shared-filestore");
    expectRec(value.recommendations, "gcp.network.service-discovery-dns");
    expectRec(value.recommendations, "gcp.secrets.secretmanager");
    expectRec(value.recommendations, "gcp.build.artifactregistry");
  });

  it("rule ids are namespaced and unique", () => {
    const ids = gcpRulePack.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("gcp."))).toBe(true);
  });
});
