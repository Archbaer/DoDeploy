import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/terraform/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    reporters: ["default", "junit"],
    outputFile: { junit: "terraform-junit.xml" },
  },
});
