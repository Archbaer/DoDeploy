import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/terraform/**/*.test.ts"],
    // Terraform's shared provider cache does not support concurrent writers.
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    reporters: ["default", "junit"],
    outputFile: { junit: "terraform-junit.xml" },
  },
});
