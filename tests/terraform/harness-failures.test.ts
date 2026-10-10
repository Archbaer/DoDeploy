import { describe, expect, it } from "vitest";
import { verifyTerraform } from "../helpers/terraform.js";

describe("strict Terraform harness", () => {
  it("fails for a missing Terraform binary instead of skipping", () => {
    if (process.env.DODEPLOY_REQUIRE_TERRAFORM === "1") return;
    const previous = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(() => verifyTerraform("/missing", { provider: "aws", strict: true })).toThrow(
        /Terraform required/,
      );
    } finally {
      process.env.PATH = previous;
    }
  });
});
