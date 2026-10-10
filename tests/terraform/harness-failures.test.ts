import { describe, expect, it } from "vitest";
import { verifyTerraform } from "../helpers/terraform.js";

describe("strict Terraform harness", () => {
  it("fails for a missing Terraform binary instead of skipping", () => {
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
