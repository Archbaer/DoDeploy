import { describe, expect, it } from "vitest";
import { enrichedIRSchema } from "../../src/ir/index.js";
import { renderAzure } from "../../src/providers/azure/render.js";
import { renderGcp } from "../../src/providers/gcp/render.js";

const fixture = () =>
  enrichedIRSchema.parse({
    meta: { name: "cloud" },
    compute: [
      {
        name: "api",
        source: "compose",
        kind: "web",
        image: "image:1",
        env: { TOKEN: "never-print-this", MODE: "production" },
        secrets: ["TOKEN", "EXTERNAL_SECRET"],
      },
    ],
    datastores: [
      { name: "mysql", engine: "mysql", version: "8.0.36", detected: true },
      { name: "postgres", engine: "postgres", version: "16.2", detected: true },
    ],
  });

describe("cloud runtime wiring", () => {
  it("renders Azure MySQL separately from PostgreSQL with matching outputs", () => {
    const { files, diagnostics } = renderAzure(fixture());
    expect(files["data.tf"]).toContain('resource "azurerm_mysql_flexible_server" "mysql"');
    expect(files["data.tf"]).toContain('version                = "8.0.21"');
    expect(files["data.tf"]).toContain('version                = "16"');
    expect(files["outputs.tf"]).toContain("azurerm_mysql_flexible_server.mysql.fqdn");
    expect(files["outputs.tf"]).toContain("azurerm_postgresql_flexible_server.postgres.fqdn");
    for (const name of ["mysql", "postgres"]) {
      expect(files["data.tf"]).toContain(`TODO(dodeploy): datastore "${name}"`);
      expect(
        diagnostics.some((d) => d.message.includes(name) && d.message.includes("connectivity")),
      ).toBe(true);
    }
  });

  it("connects private Cloud SQL and Cloud Run through generated VPC", () => {
    const { files } = renderGcp(fixture());
    expect(files["network.tf"]).toContain(
      'resource "google_compute_global_address" "private_services"',
    );
    expect(files["network.tf"]).toContain('purpose       = "VPC_PEERING"');
    expect(files["network.tf"]).toContain(
      'resource "google_service_networking_connection" "private_services"',
    );
    expect(files["network.tf"]).toContain(
      'service                 = "servicenetworking.googleapis.com"',
    );
    expect(files["network.tf"]).toContain('"compute.googleapis.com"');
    expect(files["network.tf"]).toContain('"sqladmin.googleapis.com"');
    expect(files["network.tf"]).toContain('"run.googleapis.com"');
    expect(files["data.tf"]).toContain("ipv4_enabled    = false");
    expect(files["data.tf"]).toContain("private_network = google_compute_network.main.id");
    expect(files["data.tf"]).toContain(
      "depends_on = [google_service_networking_connection.private_services]",
    );
    expect(files["data.tf"]).toContain('edition = "ENTERPRISE"');
    expect(files["data.tf"]).toContain('database_version = "POSTGRES_16"');
    expect(files["data.tf"]).toContain('database_version = "MYSQL_8_0"');
    expect(files["compute.tf"]).toContain("network_interfaces {");
    expect(files["compute.tf"]).toContain("network    = google_compute_network.main.name");
    expect(files["compute.tf"]).toContain("subnetwork = google_compute_subnetwork.main.name");
    expect(files["compute.tf"]).toContain('egress = "PRIVATE_RANGES_ONLY"');
    expect(files["compute.tf"]).toContain(
      'depends_on = [google_project_service.apis["run.googleapis.com"]]',
    );
  });

  it("omits SQL networking and APIs when no relational database exists", () => {
    const ir = fixture();
    ir.datastores = [];
    const { files } = renderGcp(ir);
    expect(files["network.tf"]).not.toContain("google_service_networking_connection");
    expect(files["network.tf"]).not.toContain("sqladmin.googleapis.com");
    expect(files["network.tf"]).not.toContain("servicenetworking.googleapis.com");
    expect(files["compute.tf"]).toContain("network_interfaces {");
  });

  for (const [provider, render] of [
    ["GCP", renderGcp],
    ["Azure", renderAzure],
  ] as const) {
    it(`${provider} names omitted secrets and provides manual injection guidance`, () => {
      const { files, diagnostics } = render(fixture());
      for (const key of ["TOKEN", "EXTERNAL_SECRET"]) {
        expect(
          diagnostics.some(
            (d) => d.severity === "warning" && d.message.includes("api") && d.message.includes(key),
          ),
        ).toBe(true);
        expect(files["compute.tf"]).toContain(`TODO(dodeploy): service "api" secret "${key}"`);
      }
      expect(Object.values(files).join("\n")).not.toContain("never-print-this");
      expect(files["compute.tf"]).toContain("production");
    });
  }

  it("defers Azure persistent storage without unused account/share", () => {
    const ir = fixture();
    ir.storage = [
      { name: "persistent", source: "compose", kind: "shared-volume", sharedBy: ["api"] },
    ];
    const { files, diagnostics } = renderAzure(ir);
    expect(
      diagnostics.some((d) => d.message.includes("persistent") && d.message.includes("mount")),
    ).toBe(true);
    expect(files["data.tf"]).toContain('TODO(dodeploy): section "storage-persistent"');
    expect(files["data.tf"]).not.toContain('resource "azurerm_storage_share"');
    expect(files["data.tf"]).not.toContain('resource "azurerm_storage_account"');
  });
});
