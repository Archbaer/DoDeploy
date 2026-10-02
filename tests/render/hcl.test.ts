import { describe, expect, it } from "vitest";
import { block, quote, tfName } from "../../src/render/index.js";

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
