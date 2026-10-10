import { describe, expect, it } from "vitest";
import { normalizeCompose, parseCompose } from "../../src/compose/index.js";
import { eligibleTargets } from "../../src/interview/options.js";
import { deriveNetwork } from "../../src/ir/network.js";
import { projectIRSchema } from "../../src/ir/schema.js";

describe("Compose and interview parity primitives", () => {
  it("recomputes network edges after requirement edits", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "app" },
      compute: [
        {
          name: "api",
          source: "interview",
          kind: "web",
          ports: [{ container: 8080, host: 80, public: true }],
          dependsOn: ["db", "cache"],
        },
      ],
      datastores: [
        { name: "db", engine: "postgres", version: "16", detected: false },
        { name: "cache", engine: "redis", version: "7", detected: false },
      ],
    });
    expect(deriveNetwork(ir.compute, ir.datastores, ir.storage)).toMatchObject({
      publicIngress: true,
      securityGroupRules: [
        { from: "api", to: "db", port: 5432 },
        { from: "api", to: "cache", port: 6379 },
      ],
    });
  });

  it("keeps worker target choices provider compatible", () => {
    expect(
      eligibleTargets({
        provider: "aws",
        kind: "worker",
        publicPorts: false,
        image: "ghcr.io/acme/worker:1",
        stateful: false,
      }),
    ).not.toContain("apprunner");
    expect(
      eligibleTargets({
        provider: "gcp",
        kind: "web",
        publicPorts: true,
        image: "nginx:1.27",
        stateful: false,
      }),
    ).not.toContain("fargate");
    expect(
      eligibleTargets({
        provider: "aws",
        kind: "web",
        publicPorts: true,
        image: "ghcr.io/acme/web:1",
        stateful: false,
      }),
    ).not.toContain("apprunner");
  });

  it("normalizes Compose ports and dependency edges for parity comparisons", () => {
    const parsed = parseCompose(
      `name: parity\nservices:\n  api:\n    image: ghcr.io/acme/api:1\n    ports: ["8080:8080"]\n    depends_on: [db]\n  db:\n    image: postgres:16-alpine\n`,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const normalized = normalizeCompose(parsed.value);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.compute[0]).toMatchObject({
      name: "api",
      image: "ghcr.io/acme/api:1",
      dependsOn: ["db"],
    });
    expect(normalized.value.network.securityGroupRules).toContainEqual({
      from: "api",
      to: "db",
      port: 5432,
    });
  });
});
