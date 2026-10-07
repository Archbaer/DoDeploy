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

  it("renders entrypoint/command as command/args on containers (issue #25)", () => {
    for (const pack of [gcpRulePack, azureRulePack]) {
      const ir = projectIRSchema.parse({
        meta: { name: "x" },
        compute: [
          {
            name: "worker",
            source: "compose",
            kind: "worker",
            image: "alpine:3",
            entrypoint: ["/bin/sh"],
            command: ["-c", "sleep infinity"],
          },
        ],
      });
      const { files } = pack.render(enriched(pack.rules, ir));
      expect(files["compute.tf"]).toContain('command = ["/bin/sh"]');
      expect(files["compute.tf"]).toContain('args    = ["-c", "sleep infinity"]');
    }
  });

  it("renders background-only workers as Cloud Run jobs, not HTTP services (issue #34)", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        { name: "worker", source: "compose", kind: "worker", image: "my-worker:1" },
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, protocol: "tcp", public: true }],
        },
      ],
    });
    const { files } = gcpRulePack.render(enriched(gcpRulePack.rules, ir));
    expect(files["compute.tf"]).toContain('resource "google_cloud_run_v2_job" "worker"');
    expect(files["compute.tf"]).not.toContain('resource "google_cloud_run_v2_service" "worker"');
    expect(files["compute.tf"]).toContain('resource "google_cloud_run_v2_service" "web"');
    expect(files["outputs.tf"]).not.toContain("google_cloud_run_v2_service.worker");
    expect(files["outputs.tf"]).toContain("google_cloud_run_v2_service.web.uri");
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
  it("keeps background workers alive with min_replicas and leaves web scaling unchanged (issue #35)", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        { name: "worker", source: "compose", kind: "worker", image: "my-worker:1" },
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, protocol: "tcp", public: true }],
        },
      ],
    });
    const { files } = azureRulePack.render(enriched(azureRulePack.rules, ir));
    const compute = files["compute.tf"] ?? "";
    const block = (name: string) =>
      (compute.split(`resource "azurerm_container_app" "${name}"`)[1] ?? "").split(
        'resource "',
      )[0] ?? "";
    const workerBlock = block("worker");
    const webBlock = block("web");
    expect(workerBlock).toContain("min_replicas = 1");
    expect(workerBlock).not.toContain("ingress {");
    expect(webBlock).toContain("ingress {");
    expect(webBlock).not.toContain("min_replicas");
  });

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
    expect(files["compute.tf"]).toContain('resource "google_cloud_run_v2_job" "w"');
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

describe("omitted public ports and UDP visibility (issue #37)", () => {
  const packs = { gcp: gcpRulePack, azure: azureRulePack };
  const ir = () =>
    projectIRSchema.parse({
      meta: { name: "probe" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [
            { host: 8080, container: 80, protocol: "tcp", public: true },
            { host: 8443, container: 443, protocol: "tcp", public: true },
            { host: 9000, container: 9000, protocol: "udp", public: true },
          ],
        },
      ],
    });

  it.each(Object.entries(packs))(
    "%s serves the first TCP port and reports the rest",
    (_n, pack) => {
      const { files, diagnostics } = pack.render(enriched(pack.rules, ir()));
      expect(files["compute.tf"]).toMatch(/(container_port|target_port)\s*=\s*80/);
      const omitted = diagnostics.filter((d) => d.message.includes("not exposed"));
      expect(omitted.some((d) => d.message.includes(":443/tcp"))).toBe(true);
      expect(
        omitted.some((d) => d.message.includes(":9000/udp") && d.message.includes("UDP")),
      ).toBe(true);
      expect(omitted.some((d) => d.message.includes(":80/"))).toBe(false);
    },
  );

  it.each(Object.entries(packs))(
    "%s reports all public ports on UDP-only and worker units",
    (_n, pack) => {
      const udpOnly = projectIRSchema.parse({
        meta: { name: "probe" },
        compute: [
          {
            name: "dns",
            source: "compose",
            kind: "web",
            image: "dns:1",
            ports: [{ host: 5353, container: 5353, protocol: "udp", public: true }],
          },
          {
            name: "worker",
            source: "compose",
            kind: "worker",
            image: "w:1",
            ports: [{ host: 9090, container: 9090, protocol: "tcp", public: true }],
          },
        ],
      });
      const { files, diagnostics } = pack.render(enriched(pack.rules, udpOnly));
      expect(files["compute.tf"]).not.toMatch(/(container_port|target_port)\s*=\s*5353/);
      expect(files["compute.tf"]).not.toMatch(/(container_port|target_port)\s*=\s*9090/);
      expect(diagnostics.some((d) => d.message.includes(":5353/udp"))).toBe(true);
      expect(diagnostics.some((d) => d.message.includes(":9090/tcp"))).toBe(true);
    },
  );
});

describe("duplicate Terraform labels (issue #33)", () => {
  const packs = { aws: awsRulePack, gcp: gcpRulePack, azure: azureRulePack };
  it.each(Object.entries(packs))(
    "%s rejects colliding labels with an error diagnostic instead of invalid output",
    (_n, pack) => {
      const ir = enrichedIRSchema.parse({
        meta: { name: "probe" },
        compute: [
          { name: "api_web", source: "compose", kind: "web", image: "nginx" },
          { name: "api-web", source: "compose", kind: "web", image: "nginx" },
        ],
      });
      const { files, diagnostics } = pack.render(ir);
      expect(diagnostics.some((d) => d.severity === "error" && d.message.includes("api-web"))).toBe(
        true,
      );
      expect(files["compute.tf"]).toContain("TODO(dodeploy)");
      expect(files["compute.tf"]).not.toContain('resource "');
    },
  );
});

describe("interview-only image variables and meta defaults (issues #38, #39)", () => {
  const packs = { aws: awsRulePack, gcp: gcpRulePack, azure: azureRulePack };

  it.each(Object.entries(packs))(
    "%s declares the image variable for image-less units",
    (_n, pack) => {
      const ir = enrichedIRSchema.parse({
        meta: { name: "app" },
        compute: [{ name: "api", source: "interview", kind: "web" }],
      });
      const { files } = pack.render(ir);
      expect(files["compute.tf"]).toContain("var.api_image");
      expect(files["variables.tf"]).toContain('variable "api_image"');
      expect(files["variables.tf"]).toContain("TF_VAR_api_image");
    },
  );

  it.each(Object.entries(packs))(
    "%s reflects the selected region and project name as variable defaults",
    (_n, pack) => {
      const ir = enrichedIRSchema.parse({
        meta: { name: "custom-project", region: "europe-west1" },
        compute: [],
      });
      const { files } = pack.render(ir);
      expect(files["variables.tf"]).toContain('default = "custom-project"');
      expect(files["variables.tf"]).toContain('default = "europe-west1"');
    },
  );
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
