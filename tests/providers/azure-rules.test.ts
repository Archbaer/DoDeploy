import { describe, expect, it } from "vitest";
import type { ProjectIR } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";
import { azureRulePack } from "../../src/providers/azure/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR, expectRec, webIR } from "./fixtures.js";

const runAzure = (ir: ProjectIR) => {
  const result = applyRules(ir, azureRulePack.rules);
  if (!result.ok) throw new Error("applyRules failed");
  return result;
};

describe("azure rule pack", () => {
  it("recommends Container Apps for a public web service", () => {
    const { value } = runAzure(webIR);
    const web = expectRec(value.recommendations, "azure.compute.web-containerapps");
    expect(web.costTier).toBe("medium");
    expect(web.message).toContain("Container Apps");
  });

  it("maps postgres and redis to Flexible Server and Azure Cache", () => {
    const { value } = runAzure(dbIR);
    expect(expectRec(value.recommendations, "azure.datastore.postgres-flexible").message).toContain(
      "Flexible Server",
    );
    expect(expectRec(value.recommendations, "azure.datastore.redis-cache").message).toContain(
      "Azure Cache for Redis",
    );
  });

  it("recommends Cosmos DB (Mongo API) with a compatibility caveat", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      datastores: [{ name: "docs", engine: "mongodb", version: "7", detected: true }],
    });
    const { value } = runAzure(ir);
    expect(expectRec(value.recommendations, "azure.datastore.mongodb-cosmos").rationale).toContain(
      "compatib",
    );
  });

  it("suggests a Flexible Server when a database is referenced but not declared", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "img:1",
          env: { DATABASE_URL: "postgres://db:5432/x" },
        },
      ],
    });
    const { value } = runAzure(ir);
    expect(expectRec(value.recommendations, "azure.gap.missing-database").message).toContain(
      "Flexible Server",
    );
  });

  it("recommends VM Scale Sets for stateful services", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "legacy", source: "compose", kind: "stateful", image: "img:1" }],
    });
    const { value } = runAzure(ir);
    expect(expectRec(value.recommendations, "azure.compute.stateful-vmss").severity).toBe(
      "warning",
    );
  });

  it("recommends supporting services: Azure Files, Blob, Private DNS, Key Vault, ACR", () => {
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
      storage: [
        { name: "uploads", kind: "shared-volume", source: "compose", sharedBy: ["api"] },
        { name: "assets", kind: "static-assets", source: "compose", sharedBy: [] },
      ],
      network: { serviceDiscovery: true },
    });
    const { value } = runAzure(ir);
    expectRec(value.recommendations, "azure.storage.shared-files");
    expectRec(value.recommendations, "azure.storage.static-blob");
    expectRec(value.recommendations, "azure.network.service-discovery-privatedns");
    expectRec(value.recommendations, "azure.secrets.keyvault");
    expectRec(value.recommendations, "azure.build.acr");
  });

  it("rule ids are namespaced and unique", () => {
    const ids = azureRulePack.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("azure."))).toBe(true);
  });
});
