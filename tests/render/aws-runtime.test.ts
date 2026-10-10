import { describe, expect, it } from "vitest";
import { projectIRSchema } from "../../src/ir/index.js";
import { awsRulePack } from "../../src/providers/aws/index.js";
import { applyRules } from "../../src/rules/index.js";
import { dbIR } from "../providers/fixtures.js";

const render = (compute: unknown[], storage: unknown[] = [], network = {}) => {
  const ir = projectIRSchema.parse({ meta: { name: "runtime" }, compute, storage, network });
  const result = applyRules(ir, awsRulePack.rules);
  if (!result.ok) throw new Error("rules failed");
  return awsRulePack.render(result.value);
};
const web = (name: string, host: number, container = 3000) => ({
  name,
  source: "compose",
  kind: "web",
  image: "app:1",
  ports: [{ host, container, public: true }],
});

describe("AWS runtime wiring", () => {
  it("routes public subnets through IGW and private subnets through NAT", () => {
    const { files } = render([web("api", 8080)]);
    const network = files["network.tf"] ?? "";
    expect(network).toContain('resource "aws_nat_gateway" "main"');
    expect(network).toContain("gateway_id = aws_internet_gateway.main.id");
    expect(network).toContain("nat_gateway_id = aws_nat_gateway.main.id");
    for (const subnet of ["public_a", "public_b", "private_a", "private_b"]) {
      expect(network).toContain(`resource "aws_route_table_association" "${subnet}"`);
    }
    expect(network).toContain("NAT gateway incurs hourly and data processing charges");
  });

  it("routes each public web port and restricts task ingress to ALB", () => {
    const api = web("api", 8080);
    api.ports.push({ host: 9090, container: 9000, public: true });
    const { files } = render([api, web("ui", 8081)]);
    const network = files["network.tf"] ?? "";
    expect(network.match(/resource "aws_lb_listener"/g)).toHaveLength(3);
    expect(network).toContain("security_groups    = [aws_security_group.alb.id]");
    expect(network).toContain("source_security_group_id = aws_security_group.alb.id");
    expect(files["compute.tf"]).toContain(
      "depends_on      = [aws_iam_role_policy_attachment.ecs_execution, aws_route_table_association.private_a",
    );
    expect(files["compute.tf"]).toContain("aws_lb_listener.api_9090");
    expect(files["compute.tf"]?.match(/load_balancer \{/g)).toHaveLength(3);
    const taskSg = network.slice(network.indexOf('resource "aws_security_group" "service_api"'));
    expect(taskSg).not.toMatch(/ingress \{[^}]*cidr_blocks/s);
  });

  it("defers ambiguous and UDP public routes without orphan target groups", () => {
    const udp = {
      ...web("udp", 8082),
      ports: [{ host: 8082, container: 53, public: true, protocol: "udp" }],
    };
    const { files, diagnostics } = render([web("api", 8080), web("ui", 8080), udp]);
    expect(files["network.tf"]).not.toContain('resource "aws_lb_target_group"');
    expect(files["network.tf"]).toContain("TODO(dodeploy)");
    expect(
      diagnostics.some((d) => d.message.includes("api") && d.message.includes("ambiguous")),
    ).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("udp") && d.message.includes("UDP"))).toBe(
      true,
    );
  });

  it("retains service-to-service rules and defers ports without host routing", () => {
    const api = { ...web("api", 8080), ports: [{ container: 3000, public: true }] };
    const { files, diagnostics } = render([api, web("ui", 8081)], [], {
      securityGroupRules: [{ from: "ui", to: "api", port: 3000 }],
    });
    expect(files["network.tf"]).toContain(
      "source_security_group_id = aws_security_group.service_ui.id",
    );
    expect(files["network.tf"]).not.toContain('resource "aws_lb_target_group" "api"');
    expect(
      diagnostics.some(
        (d) => d.message.includes("api") && d.message.includes("unique Compose host ports"),
      ),
    ).toBe(true);
  });

  it("connects managed databases, DNS discovery and task execution permissions", () => {
    const result = applyRules(dbIR, awsRulePack.rules);
    if (!result.ok) throw new Error("rules failed");
    const { files } = awsRulePack.render(result.value);
    expect(files["data.tf"]).toContain("db_subnet_group_name   = aws_db_subnet_group.main.name");
    expect(files["data.tf"]).toContain(
      "vpc_security_group_ids = [aws_security_group.service_db.id]",
    );
    expect(files["data.tf"]).toContain(
      "subnet_group_name  = aws_elasticache_subnet_group.main.name",
    );
    expect(files["network.tf"]).toContain('resource "aws_service_discovery_private_dns_namespace"');
    expect(files["network.tf"]).toContain('type = "A"');
    expect(files["compute.tf"]).toContain(
      "execution_role_arn       = aws_iam_role.ecs_execution.arn",
    );
    expect(files["compute.tf"]).toContain("AmazonECSTaskExecutionRolePolicy");
  });

  it("namespaces service security groups and avoids reciprocal dependency cycles", () => {
    const { files } = render([web("alb", 8080), web("api", 8081)], [], {
      securityGroupRules: [
        { from: "alb", to: "api", port: 3000 },
        { from: "api", to: "alb", port: 3000 },
      ],
    });
    const network = files["network.tf"] ?? "";
    expect(network.match(/resource "aws_security_group" "alb"/g)).toHaveLength(1);
    expect(network).toContain('resource "aws_security_group" "service_alb"');
    expect(network).toContain('resource "aws_security_group_rule"');
    expect(network).toContain("source_security_group_id = aws_security_group.service_api.id");
    expect(files["compute.tf"]).toContain("aws_security_group.service_alb.id");
  });

  it("deduplicates container port mappings while retaining distinct host listeners", () => {
    const api = web("api", 8080);
    api.ports.push({ host: 8081, container: 3000, public: true });
    const { files } = render([api]);
    expect(files["compute.tf"]?.match(/containerPort = 3000/g)).toHaveLength(1);
    expect(files["network.tf"]?.match(/resource "aws_lb_listener"/g)).toHaveLength(2);
  });

  it("defers secrets and named volumes explicitly without exposing values or unused EFS", () => {
    const unit = { ...web("api", 8080), env: { TOKEN: "do-not-print" }, secrets: ["TOKEN"] };
    const { files, diagnostics } = render(
      [unit],
      [{ name: "data", source: "compose", kind: "shared-volume", sharedBy: ["api"] }],
    );
    expect(JSON.stringify(files)).not.toContain("do-not-print");
    expect(files["compute.tf"]).toContain("Secrets Manager");
    expect(files["compute.tf"]).toContain("TOKEN");
    expect(files["data.tf"]).toContain("mount paths");
    expect(JSON.stringify(files)).not.toContain("aws_efs_");
    expect(diagnostics.some((d) => d.message.includes("api") && d.message.includes("TOKEN"))).toBe(
      true,
    );
    expect(
      diagnostics.some((d) => d.message.includes("data") && d.message.includes("mount paths")),
    ).toBe(true);
  });
});
