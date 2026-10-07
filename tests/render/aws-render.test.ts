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

  it("includes ec2.tf for ec2-targeted workloads", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [{ name: "web", source: "compose", kind: "web", image: "nginx", target: "ec2" }],
    });
    const { files } = awsRulePack.render(enriched(ir));
    expect(Object.keys(files).sort()).toContain("ec2.tf");
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

  it("renders ec2-targeted services as a single EC2 box and no ECS resources", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          target: "ec2",
          ports: [{ container: 80, host: 80, public: true }],
        },
        { name: "jobs", source: "compose", kind: "worker", image: "worker:v1", target: "ec2" },
      ],
    });
    const { files } = awsRulePack.render(enriched(ir));
    expect(files["ec2.tf"]).toContain('resource "aws_instance" "box"');
    expect(files["ec2.tf"]).toContain("docker run -d");
    expect(files["compute.tf"]).not.toContain("aws_ecs_cluster");
    expect(files["compute.tf"]).not.toContain("aws_ecs_task_definition");
  });

  it("does not emit spurious route TODOs for ec2-targeted public ports", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "web app",
          source: "compose",
          kind: "web",
          image: "nginx",
          target: "ec2",
          ports: [
            { container: 80, host: 80, public: true },
            { container: 443, host: 443, public: true },
            { container: 80, host: 8080, public: true }, // duplicate protocol/port not possible in real schema, but defends ingress dedup
          ],
          env: { GREETING: "hello world", QUOTE: "it's" },
        },
      ],
    });
    const { files, diagnostics } = awsRulePack.render(enriched(ir));
    expect(files["ec2.tf"]).not.toContain("TODO(dodeploy)");
    expect(
      diagnostics.some((d) => d.message.includes("public port") || d.message.includes("route")),
    ).toBe(false);
    expect(files["ec2.tf"]).toContain("--name web-app");
    expect(files["ec2.tf"]).toContain("-e 'GREETING=hello world'");
    expect(files["ec2.tf"]).toContain("-e 'QUOTE=it'\\''s'");
  });

  it("shell-quotes image and env arguments in the EC2 bootstrap (issue #31)", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "api",
          source: "compose",
          kind: "web",
          image: "nginx; printf SHELL_INJECTION_PROBE",
          target: "ec2",
          env: { "EVIL;KEY": "v$(rm -rf /)" },
        },
        { name: "good", source: "compose", kind: "web", image: "nginx:1.25", target: "ec2" },
        { name: "builder", source: "compose", kind: "web", buildContext: "./app", target: "ec2" },
      ],
    });
    const { files } = awsRulePack.render(enriched(ir));
    const lines = files["ec2.tf"]?.split("\n") ?? [];
    const hostile = lines.find((l) => l.includes("--name api")) ?? "";
    // Metacharacters, whitespace and command substitution stay inside one single-quoted token.
    expect(hostile).toContain("'nginx; printf SHELL_INJECTION_PROBE'");
    expect(hostile).toContain("-e 'EVIL;KEY=v$(rm -rf /)'");
    expect(hostile).not.toMatch(/[^']nginx;/);
    // Valid tagged images remain a single shell argument.
    const good = lines.find((l) => l.includes("--name good")) ?? "";
    expect(good.endsWith("'nginx:1.25'")).toBe(true);
    // Build-image variable references stay Terraform-interpolated inside the heredoc.
    const builder = lines.find((l) => l.includes("--name builder")) ?? "";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal Terraform reference
    expect(builder.endsWith("'${var.builder_image}'")).toBe(true);
  });

  it("renders apprunner-targeted web services as App Runner services", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "public.ecr.aws/x/web:v1",
          target: "apprunner",
          ports: [{ container: 8080, host: 8080, public: true }],
          env: { FOO: "bar", BAZ: "qux" },
        },
      ],
    });
    const { files } = awsRulePack.render(enriched(ir));
    expect(files["apprunner.tf"]).toContain('resource "aws_apprunner_service" "web"');
    expect(files["apprunner.tf"]).toContain('image_repository_type = "ECR_PUBLIC"');
    expect(files["apprunner.tf"]).toContain("runtime_environment_variables");
    expect(files["apprunner.tf"]).toContain("FOO");
    expect(files["apprunner.tf"]).toContain("BAZ");
    expect(files["apprunner.tf"]).not.toContain("authentication_configuration");
    expect(files["compute.tf"]).not.toContain("aws_ecs_cluster");
    expect(files["outputs.tf"]).toContain('output "apprunner_web_url"');
  });

  it("emits the aws_partition data source exactly once when fargate and apprunner mix", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x" },
      compute: [
        { name: "web", source: "compose", kind: "web", image: "x/web", target: "apprunner" },
        { name: "jobs", source: "compose", kind: "worker", image: "x/jobs", target: "fargate" },
      ],
    });
    const result = awsRulePack.render(enriched(ir));
    const all = Object.values(result.files).join("\n");
    expect(all.match(/data "aws_partition" "current"/g)?.length).toBe(1);
  });
});
