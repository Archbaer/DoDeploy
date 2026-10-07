import { describe, expect, it } from "vitest";
import { enrichedIRSchema, projectIRSchema } from "../../src/ir/index.js";
import { awsRulePack } from "../../src/providers/aws/index.js";
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

  it("reports deferred GCP resources as diagnostics without failing", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "w", source: "compose", kind: "worker", image: "img:1" }],
      datastores: [
        { name: "docs", engine: "mongodb", detected: true },
        { name: "legacy", engine: "mysql", version: "8", detected: true },
      ],
      storage: [{ name: "shared", kind: "shared-volume", source: "compose", sharedBy: ["w"] }],
    });
    const { files, diagnostics } = gcpRulePack.render(enriched(gcpRulePack.rules, ir));
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(files["data.tf"]).toContain("TODO(dodeploy)");
    expect(files["data.tf"]).toContain('resource "google_sql_database_instance" "legacy"');
    expect(files["data.tf"]).toContain("MYSQL_8_0");
    expect(files["compute.tf"]).toContain("INGRESS_TRAFFIC_INTERNAL_ONLY");
  });

  it("renders Azure object storage and explicitly defers volume mounts and Cosmos DB", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "w", source: "compose", kind: "worker", image: "img:1" }],
      datastores: [{ name: "docs", engine: "mongodb", detected: true }],
      storage: [
        { name: "shared", kind: "shared-volume", source: "compose", sharedBy: ["w"] },
        { name: "assets", kind: "static-assets", source: "compose", sharedBy: [] },
      ],
    });
    const { files, diagnostics } = azureRulePack.render(enriched(azureRulePack.rules, ir));
    expect(diagnostics.some((d) => d.message.includes("Cosmos"))).toBe(true);
    expect(files["data.tf"]).not.toContain('resource "azurerm_storage_share"');
    expect(files["data.tf"]).toContain('TODO(dodeploy): section "storage-shared"');
    expect(diagnostics.some((d) => d.message.includes('volume "shared"'))).toBe(true);
    expect(files["data.tf"]).toContain('resource "azurerm_storage_container" "assets"');
    expect(files["data.tf"]).toContain('resource "azurerm_storage_account" "main"');
  });
});

describe("HCL literal preservation (issue #32)", () => {
  const packs = { aws: awsRulePack, gcp: gcpRulePack, azure: azureRulePack };
  const irWithEnv = enrichedIRSchema.parse({
    meta: { name: "probe" },
    compute: [
      {
        name: "api",
        source: "compose",
        kind: "web",
        image: "nginx",
        env: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal HCL marker
          TEMPLATE: "${var.db_password}",
          DIRECTIVE: "%{ if true }changed%{ endif }",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal Compose-style marker
          COMPOSE_STYLE: "${APP_MODE:-production}",
          TEXT: "first\nsecond",
        },
      },
    ],
  });

  it.each(Object.entries(packs))("%s keeps template markers and newlines literal", (_n, pack) => {
    const all = Object.values(pack.render(irWithEnv).files).join("\n");
    expect(all).toContain("$${var.db_password}");
    expect(all).toContain("%%{ if true }changed%%{ endif }");
    expect(all).toContain("$${APP_MODE:-production}");
    expect(all).toContain("first\\nsecond");
    expect(all).not.toMatch(/(?<!\$)\$\{var\.db_password\}/);
    expect(all).not.toMatch(/(?<!%)%\{ if true \}/);
  });

  it("escapes build-image variable descriptions", () => {
    const ir = enrichedIRSchema.parse({
      meta: { name: "probe" },
      compute: [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal HCL markers
        { name: 'api"${var.x}', source: "compose", kind: "web", buildContext: "./app${var.y}" },
      ],
    });
    const variables = awsRulePack.render(ir).files["variables.tf"] ?? "";
    expect(variables).toContain("$${var.y}");
    expect(variables).not.toMatch(/(?<!\$)\$\{var\.y\}/);
    expect(variables).not.toMatch(/(?<!\$)\$\{var\.x\}/);
  });
});
