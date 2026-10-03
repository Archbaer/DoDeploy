import { describe, expect, it } from "vitest";
import { projectIRSchema } from "../../src/ir/index.js";
import { awsRulePack } from "../../src/providers/aws/index.js";
import { renderSections } from "../../src/render/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR } from "../providers/fixtures.js";

const withCompute = (name: string, kind: "web" | "worker" | "stateful") =>
  projectIRSchema.parse({
    meta: { name: "x" },
    compute: [{ name, source: "compose", kind, image: "img:1" }],
  });

describe("renderSections", () => {
  it("joins builder output into one document", () => {
    const out = renderSections(
      [
        { name: "a", builder: () => "# a\n" },
        { name: "b", builder: () => "# b\n" },
      ],
      {},
    );
    expect(out.content).toBe("# a\n\n# b\n");
    expect(out.diagnostics).toEqual([]);
  });

  it("isolates a failing builder with a diagnostic and TODO placeholder", () => {
    const out = renderSections(
      [
        { name: "good", builder: () => "# good\n" },
        {
          name: "bad",
          builder: () => {
            throw new Error("exploded");
          },
        },
      ],
      {},
    );
    expect(out.content).toContain("# good");
    expect(out.content).toContain('# TODO(dodeploy): section "bad" failed to render');
    expect(out.diagnostics.some((d) => d.message.includes("bad"))).toBe(true);
    expect(out.diagnostics[0]?.stage).toBe("render");
  });
});

describe("aws renderer", () => {
  const enriched = (ir = dbIR) => {
    const result = applyRules(ir, awsRulePack.rules);
    if (!result.ok) throw new Error("rules failed");
    return result.value;
  };

  it("renders the expected file set", () => {
    const { files } = awsRulePack.render(enriched());
    expect(Object.keys(files).sort()).toEqual(
      ["compute.tf", "data.tf", "network.tf", "outputs.tf", "providers.tf", "variables.tf"].sort(),
    );
  });

  it("renders ECS for compute, RDS for postgres, ElastiCache for redis", () => {
    const { files } = awsRulePack.render(enriched());
    expect(files["compute.tf"]).toContain('resource "aws_ecs_cluster"');
    expect(files["compute.tf"]).toContain('resource "aws_ecs_service" "api"');
    expect(files["data.tf"]).toContain('resource "aws_db_instance" "db"');
    expect(files["data.tf"]).toContain('engine               = "postgres"');
    expect(files["data.tf"]).toContain('resource "aws_elasticache_cluster" "cache"');
  });

  it("renders an ALB and target group for public web services", () => {
    const { files } = awsRulePack.render(enriched());
    expect(files["network.tf"]).toContain('resource "aws_lb" "main"');
    expect(files["network.tf"]).toContain('resource "aws_lb_target_group" "api"');
  });

  it("renders explicit TODO blocks for stateful units instead of pretending", () => {
    const { files, diagnostics } = awsRulePack.render(enriched(withCompute("legacy", "stateful")));
    expect(files["compute.tf"]).toContain("TODO(dodeploy)");
    expect(diagnostics.some((d) => d.message.includes("legacy"))).toBe(true);
  });

  it("snapshot: full AWS output for the standard fixture", () => {
    const { files } = awsRulePack.render(enriched());
    expect(files).toMatchSnapshot();
  });

  it("covers docdb, s3, deferred volumes, builder variables, env and worker-only services", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "big" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          buildContext: "./api",
          ports: [{ container: 3000, host: 80, public: true }],
          env: { LOG_LEVEL: "debug" },
        },
        { name: "jobs", source: "compose", kind: "worker", image: "img:2" },
      ],
      datastores: [{ name: "docs", engine: "mongodb", detected: true }],
      storage: [
        { name: "uploads", kind: "uploads", source: "compose", sharedBy: [] },
        { name: "data", kind: "local-volume", source: "compose", sharedBy: [] },
      ],
    });
    const { files, diagnostics } = awsRulePack.render(enriched(ir));
    expect(
      diagnostics.some((d) => d.message.includes("data") && d.message.includes("mount paths")),
    ).toBe(true);
    expect(files["data.tf"]).toContain('resource "aws_docdb_cluster" "docs"');
    expect(files["data.tf"]).toContain('resource "aws_s3_bucket" "uploads"');
    expect(files["data.tf"]).toContain('volume "data" deferred');
    expect(files["data.tf"]).not.toContain("aws_efs_file_system");
    expect(files["variables.tf"]).toContain('variable "api_image"');
    expect(files["compute.tf"]).toContain("LOG_LEVEL");
    expect(files["compute.tf"]).toContain('resource "aws_ecs_service" "jobs"');
    expect(files["outputs.tf"]).toContain('output "bucket_uploads"');
    expect(files["outputs.tf"]).toContain('output "db_docs_endpoint"');
  });
});
