import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateProject } from "../../src/generate.js";

const FIXTURES = join(process.cwd(), "tests/compose/fixtures");

const terraformAvailable = (() => {
  try {
    execSync("terraform version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const providers = ["aws", "gcp", "azure"] as const;
type Provider = (typeof providers)[number];

const readFiles = (dir: string): Record<string, string> =>
  Object.fromEntries(
    ["providers.tf", "variables.tf", "network.tf", "compute.tf", "data.tf", "outputs.tf"].map(
      (name) => [name, readFileSync(join(dir, name), "utf8")],
    ),
  );

const runTerraformValidate = (dir: string): void => {
  execFileSync("terraform", ["fmt", dir], { stdio: "pipe" });
  execFileSync("terraform", [`-chdir=${dir}`, "init", "-backend=false"], { stdio: "pipe" });
  execFileSync("terraform", [`-chdir=${dir}`, "validate"], { stdio: "pipe" });
};

describe("semantic render + terraform validate", () => {
  it.each(providers)(
    "web-db-redis (%s) renders connected resources",
    async (provider: Provider) => {
      const out = mkdtempSync(join(tmpdir(), `dd-sem-web-db-redis-${provider}-`));
      const result = await generateProject({
        composePath: join(FIXTURES, "web-db-redis.yaml"),
        provider,
        outDir: out,
        interview: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const files = readFiles(out);
      if (provider === "aws") {
        expect(files["compute.tf"]).toMatch(/aws_ecs_service[\s\S]{0,10}api/);
        expect(files["compute.tf"]).toContain("task_definition = aws_ecs_task_definition.api.arn");
        expect(files["network.tf"]).toMatch(/aws_lb_target_group[\s\S]{0,10}api/);
        expect(files["network.tf"]).toContain("target_group_arn = aws_lb_target_group.api.arn");
        expect(files["network.tf"]).toContain("aws_security_group.service_api.id");
        expect(files["data.tf"]).toMatch(/aws_db_instance[\s\S]{0,10}db/);
        expect(files["data.tf"]).toMatch(/aws_elasticache_cluster[\s\S]{0,10}cache/);
        expect(files["outputs.tf"]).toContain("aws_lb.main.dns_name");
        expect(files["outputs.tf"]).toContain("aws_db_instance.db.address");
        expect(files["outputs.tf"]).toContain(
          "aws_elasticache_cluster.cache.cache_nodes[0].address",
        );
      } else if (provider === "gcp") {
        expect(files["compute.tf"]).toMatch(/google_cloud_run_v2_service[\s\S]{0,10}api/);
        expect(files["data.tf"]).toMatch(/google_sql_database_instance[\s\S]{0,10}db/);
        expect(files["data.tf"]).toMatch(/google_redis_instance[\s\S]{0,10}cache/);
        expect(files["outputs.tf"]).toContain("google_cloud_run_v2_service.api.uri");
        expect(files["outputs.tf"]).toContain("google_sql_database_instance.db.private_ip_address");
        expect(files["outputs.tf"]).toContain("google_redis_instance.cache.host");
      } else {
        expect(files["compute.tf"]).toMatch(/azurerm_container_app[\s\S]{0,10}api/);
        expect(files["data.tf"]).toMatch(/azurerm_postgresql_flexible_server[\s\S]{0,10}db/);
        expect(files["data.tf"]).toMatch(/azurerm_redis_cache[\s\S]{0,10}cache/);
        expect(files["outputs.tf"]).toContain("azurerm_container_app.api.ingress[0].fqdn");
        expect(files["outputs.tf"]).toContain("azurerm_postgresql_flexible_server.db.fqdn");
        expect(files["outputs.tf"]).toContain("azurerm_redis_cache.cache.hostname");
      }
      if (terraformAvailable) runTerraformValidate(out);
    },
    180_000,
  );

  it.each(providers)(
    "multi-web (%s) renders all public web services",
    async (provider: Provider) => {
      const out = mkdtempSync(join(tmpdir(), `dd-sem-multi-web-${provider}-`));
      const result = await generateProject({
        composePath: join(FIXTURES, "multi-web.yaml"),
        provider,
        outDir: out,
        interview: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const files = readFiles(out);
      if (provider === "aws") {
        expect(files["compute.tf"]).toMatch(/aws_ecs_service[\s\S]{0,10}frontend/);
        expect(files["compute.tf"]).toMatch(/aws_ecs_service[\s\S]{0,10}backend/);
        expect(files["network.tf"]).toMatch(/aws_lb_target_group[\s\S]{0,10}frontend/);
        expect(files["network.tf"]).toMatch(/aws_lb_target_group[\s\S]{0,10}backend/);
        expect(files["network.tf"]).toContain(
          "target_group_arn = aws_lb_target_group.frontend.arn",
        );
        expect(files["network.tf"]).toContain("target_group_arn = aws_lb_target_group.backend.arn");
      } else if (provider === "gcp") {
        expect(files["compute.tf"]).toMatch(/google_cloud_run_v2_service[\s\S]{0,10}frontend/);
        expect(files["compute.tf"]).toMatch(/google_cloud_run_v2_service[\s\S]{0,10}backend/);
        expect(files["outputs.tf"]).toContain("google_cloud_run_v2_service.frontend.uri");
        expect(files["outputs.tf"]).toContain("google_cloud_run_v2_service.backend.uri");
      } else {
        expect(files["compute.tf"]).toMatch(/azurerm_container_app[\s\S]{0,10}frontend/);
        expect(files["compute.tf"]).toMatch(/azurerm_container_app[\s\S]{0,10}backend/);
        expect(files["outputs.tf"]).toContain("azurerm_container_app.frontend.ingress[0].fqdn");
        expect(files["outputs.tf"]).toContain("azurerm_container_app.backend.ingress[0].fqdn");
      }
      if (terraformAvailable) runTerraformValidate(out);
    },
    180_000,
  );
  it.each(providers)(
    "stateful-volume (%s) renders or defers shared storage",
    async (provider: Provider) => {
      const out = mkdtempSync(join(tmpdir(), `dd-sem-stateful-${provider}-`));
      const result = await generateProject({
        composePath: join(FIXTURES, "stateful-volume.yaml"),
        provider,
        outDir: out,
        interview: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const files = readFiles(out);
      expect(files["data.tf"]).toContain("TODO(dodeploy)");
      expect(result.diagnostics.some((d) => d.message.includes('volume "uploads"'))).toBe(true);
      if (provider === "aws") {
        expect(files["data.tf"]).not.toContain('resource "aws_efs_file_system"');
      } else if (provider === "gcp") {
        expect(result.diagnostics.some((d) => d.message.includes("Filestore"))).toBe(true);
      } else {
        expect(files["data.tf"]).not.toContain('resource "azurerm_storage_share"');
        expect(files["data.tf"]).not.toContain('resource "azurerm_storage_account"');
      }
      if (terraformAvailable) runTerraformValidate(out);
    },
    180_000,
  );

  it.each(providers)(
    "build-only (%s) emits a builder variable and TODO",
    async (provider: Provider) => {
      const out = mkdtempSync(join(tmpdir(), `dd-sem-build-${provider}-`));
      const result = await generateProject({
        composePath: join(FIXTURES, "build-only.yaml"),
        provider,
        outDir: out,
        interview: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const files = readFiles(out);
      expect(files["variables.tf"]).toMatch(/variable[\s\S]{0,10}api_image/);
      expect(files["compute.tf"]).toContain("TODO(dodeploy)");
      if (terraformAvailable) runTerraformValidate(out);
    },
    180_000,
  );
});
