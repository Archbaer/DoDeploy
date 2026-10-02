import { describe, expect, it } from "vitest";
import { projectIRSchema } from "../../src/ir/index.js";
import { azureRulePack } from "../../src/providers/azure/index.js";
import { gcpRulePack } from "../../src/providers/gcp/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR } from "../providers/fixtures.js";

const withStorage = () =>
  projectIRSchema.parse({
    meta: { name: "x" },
    compute: [{ name: "web", source: "compose", kind: "web", image: "img:1" }],
    storage: [{ name: "assets", kind: "static-assets", source: "compose", sharedBy: [] }],
  });

const withStateful = () =>
  projectIRSchema.parse({
    meta: { name: "x" },
    compute: [{ name: "legacy", source: "compose", kind: "stateful", image: "img:1" }],
  });

const enriched = (rules: Parameters<typeof applyRules>[1], ir = dbIR) => {
  const result = applyRules(ir, rules);
  if (!result.ok) throw new Error("rules failed");
  return result.value;
};

describe("gcp renderer", () => {
  it("renders the expected file set", () => {
    const { files } = gcpRulePack.render(enriched(gcpRulePack.rules));
    expect(Object.keys(files).sort()).toEqual(
      ["compute.tf", "data.tf", "network.tf", "outputs.tf", "providers.tf", "variables.tf"].sort(),
    );
  });

  it("renders Cloud Run, Cloud SQL, Memorystore and GCS", () => {
    const { files } = gcpRulePack.render(enriched(gcpRulePack.rules));
    expect(files["compute.tf"]).toContain('resource "google_cloud_run_v2_service" "api"');
    expect(files["data.tf"]).toContain('resource "google_sql_database_instance" "db"');
    expect(files["data.tf"]).toContain("POSTGRES_16");
    expect(files["data.tf"]).toContain('resource "google_redis_instance" "cache"');
  });

  it("renders static storage and explicit TODOs for stateful units", () => {
    const { files } = gcpRulePack.render(enriched(gcpRulePack.rules, withStorage()));
    expect(files["data.tf"]).toContain('resource "google_storage_bucket" "assets"');

    const statefulResult = gcpRulePack.render(enriched(gcpRulePack.rules, withStateful()));
    expect(statefulResult.files["compute.tf"]).toContain("TODO(dodeploy)");
  });
});

describe("azure renderer", () => {
  it("renders the expected file set", () => {
    const { files } = azureRulePack.render(enriched(azureRulePack.rules));
    expect(Object.keys(files).sort()).toEqual(
      ["compute.tf", "data.tf", "network.tf", "outputs.tf", "providers.tf", "variables.tf"].sort(),
    );
  });

  it("renders Container Apps, Flexible Server and Azure Cache", () => {
    const { files } = azureRulePack.render(enriched(azureRulePack.rules));
    expect(files["compute.tf"]).toContain('resource "azurerm_container_app" "api"');
    expect(files["data.tf"]).toContain('resource "azurerm_postgresql_flexible_server" "db"');
    expect(files["data.tf"]).toContain('resource "azurerm_redis_cache" "cache"');
    expect(files["network.tf"]).toContain('resource "azurerm_virtual_network"');
  });
});
