import { describe, expect, it } from "vitest";
import { alignAttributes, block, quote, tfName } from "../../src/render/index.js";

describe("tfName", () => {
  it.each([
    ["API Service", "api-service"],
    ["my_app", "my-app"],
    ["Web.Frontend/2", "web-frontend-2"],
    ["UPPER", "upper"],
  ])("sanitizes %s → %s", (raw, expected) => {
    expect(tfName(raw)).toBe(expected);
  });
});

describe("quote", () => {
  it("escapes quotes and keeps valid HCL strings", () => {
    expect(quote('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("escapes HCL template markers so values stay literal", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal HCL marker
    expect(quote("${var.db_password}")).toBe('"$${var.db_password}"');
    expect(quote("%{ if true }changed%{ endif }")).toBe('"%%{ if true }changed%%{ endif }"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal Compose-style marker
    expect(quote("${APP_MODE:-production}")).toBe('"$${APP_MODE:-production}"');
  });

  it("escapes newlines, carriage returns and tabs", () => {
    expect(quote("first\nsecond\r\nthird\tend")).toBe('"first\\nsecond\\r\\nthird\\tend"');
  });

  it("escapes backslashes before any other sequence", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal HCL marker
    expect(quote("a\\b${c}")).toBe('"a\\\\b$${c}"');
  });
});

describe("block", () => {
  it("renders a labelled resource block with aligned attributes", () => {
    const out = block("resource", ["aws_vpc", "main"], { cidr_block: '"10.0.0.0/16"' });
    expect(out).toBe('resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n');
  });

  it("renders blocks without labels", () => {
    const out = block("provider", ["aws"], { region: "var.region" });
    expect(out).toBe('provider "aws" {\n  region = var.region\n}\n');
  });
});

describe("template attribute alignment", () => {
  it("aligns optional attributes while keeping multiline expressions in separate groups", () => {
    expect(
      alignAttributes(`  name = "api"
  image = "api:1"
  command = ["node", "worker.js"]
  container_definitions    = jsonencode([
    {
      image = "api:1"
      portMappings = [{ containerPort = 80 }]
    }
  ])`),
    ).toBe(`  name    = "api"
  image   = "api:1"
  command = ["node", "worker.js"]
  container_definitions = jsonencode([
    {
      image        = "api:1"
      portMappings = [{ containerPort = 80 }]
    }
  ])`);
  });

  it("preserves quoted values, comments, and heredoc bytes while aligning surrounding attributes", () => {
    const source = `  instance_type = "t3.small"
  user_data = <<-EOF
name=literal
  shell_value = preserve spacing
# shell comment = untouched
EOF
  tags = { Project = "test" }

  image = "value = stays"
  longer = "# stays" # TODO: keep this comment
`;
    const expected = `  instance_type = "t3.small"
  user_data     = <<-EOF
name=literal
  shell_value = preserve spacing
# shell comment = untouched
EOF
  tags          = { Project = "test" }

  image  = "value = stays"
  longer = "# stays" # TODO: keep this comment
`;
    expect(alignAttributes(source)).toBe(expected);
    expect(alignAttributes(expected)).toBe(expected);
  });
});
