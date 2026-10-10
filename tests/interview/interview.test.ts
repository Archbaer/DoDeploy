import { describe, expect, it } from "vitest";
import {
  acceptRecommendations,
  runInterview,
  ScriptedDriver,
  TARGET_ORDER,
} from "../../src/interview/index.js";
import type { Budget, EnrichedIR } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";

describe("runInterview", () => {
  it("collects different service roles, image/port intent, repeated datastores and dependencies", async () => {
    const driver = new ScriptedDriver([
      "aws",
      "balanced",
      "us-east-1",
      true,
      "api",
      "web",
      "pushed",
      "ghcr.io/acme/api:1",
      true,
      "8080",
      "fargate",
      false,
      true,
      "worker",
      "worker",
      "pushed",
      "ghcr.io/acme/worker:1",
      "fargate",
      false,
      false,
      true,
      "postgres",
      "db",
      "16",
      true,
      true,
      "redis",
      "cache",
      "7",
      true,
      false,
      "db, cache",
      "db, cache",
      true,
      false,
      true,
    ]);
    const result = await runInterview(
      projectIRSchema.parse({ meta: { name: "parity", source: "interview" } }),
      driver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute).toEqual([
      expect.objectContaining({
        name: "api",
        kind: "web",
        image: "ghcr.io/acme/api:1",
        target: "fargate",
        dependsOn: ["db", "cache"],
        ports: [expect.objectContaining({ container: 8080, public: true })],
      }),
      expect.objectContaining({
        name: "worker",
        kind: "worker",
        image: "ghcr.io/acme/worker:1",
        target: "fargate",
        dependsOn: ["db", "cache"],
        ports: [],
      }),
    ]);
    expect(
      result.value.datastores.map(({ name, engine, version }) => ({ name, engine, version })),
    ).toEqual([
      { name: "db", engine: "postgres", version: "16" },
      { name: "cache", engine: "redis", version: "7" },
    ]);
    expect(result.value.network.securityGroupRules).toEqual([
      { from: "api", to: "db", port: 5432 },
      { from: "api", to: "cache", port: 6379 },
      { from: "worker", to: "db", port: 5432 },
      { from: "worker", to: "cache", port: 6379 },
    ]);
    expect(driver.exhausted()).toBe(true);
  });

  it("covers build images, internal ports, external + managed datastores, dependencies and object storage", async () => {
    const driver = new ScriptedDriver([
      "aws",
      "balanced",
      "us-east-1",
      true,
      "api",
      "worker",
      "build",
      "./api",
      "fargate",
      false,
      false,
      true,
      "postgres",
      "external-db",
      "",
      false,
      true,
      "redis",
      "cache",
      "7",
      true,
      false,
      "external-db, cache",
      true,
      "both",
      true,
    ]);
    const result = await runInterview(
      projectIRSchema.parse({ meta: { name: "store", source: "interview" } }),
      driver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]).toMatchObject({
      kind: "worker",
      buildContext: "./api",
      dependsOn: ["external-db", "cache"],
    });
    expect(result.value.datastores).toEqual([
      expect.objectContaining({ name: "cache", engine: "redis", version: "7" }),
    ]);
    expect(result.value.storage.map((item) => item.kind)).toEqual(["static-assets", "uploads"]);
    expect(
      result.diagnostics.some((item) =>
        item.message.includes('datastore "external-db" is external'),
      ),
    ).toBe(true);
    expect(result.diagnostics.some((item) => item.message.includes("image build/push"))).toBe(true);
    expect(result.value.network.securityGroupRules).toContainEqual({
      from: "api",
      to: "cache",
      port: 6379,
    });
    expect(driver.exhausted()).toBe(true);
  });

  it("keeps named persistent volume as explicit deferred work", async () => {
    const driver = new ScriptedDriver([
      "aws",
      "balanced",
      "us-east-1",
      true,
      "api",
      "worker",
      "unknown",
      "fargate",
      true,
      "uploads",
      false,
      false,
      "",
      true,
      true,
    ]);
    const result = await runInterview(
      projectIRSchema.parse({ meta: { name: "volume", source: "interview" } }),
      driver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toEqual([
      expect.objectContaining({ name: "uploads", kind: "shared-volume", sharedBy: ["api"] }),
    ]);
    expect(
      result.diagnostics.some((item) => item.message.includes("no managed mount is emitted")),
    ).toBe(true);
  });

  it("fills gaps of a compose-origin IR and marks source as mixed", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "eu-west-1",
      "fargate", // target for existing web service (provider defaults to aws)
      false, // decline public LB
      false, // no new database
      true, // add storage
      "static-assets",
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.source).toBe("mixed");
    expect(result.value.meta.region).toBe("eu-west-1");
    expect(result.value.datastores).toEqual([]);
    expect(result.value.storage).toEqual([
      expect.objectContaining({ kind: "static-assets", source: "interview" }),
    ]);
    expect(driver.exhausted()).toBe(true);
  });

  it.each([
    ["cheapest", ["ec2", "apprunner", "fargate"]],
    ["balanced", ["apprunner", "fargate", "ec2"]],
    ["production", ["fargate", "apprunner", "ec2"]],
  ] as [Budget, string[]][])("orders targets by %s budget", (budget, expected) => {
    expect(TARGET_ORDER[budget]).toEqual(expected);
  });

  it("drops public exposure when the user declines the load balancer", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "fargate", // target for web (aws default provider)
      false, // no load balancer
      false, // no new database needed (datastores empty → confirm)
      false, // no storage
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]?.ports[0]?.public).toBe(false);
  });

  it("drops a managed datastore the user declines", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "fargate", // target for web
      true, // keep LB
      false, // decline managed postgres
      false, // no storage
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
      datastores: [{ name: "db", engine: "postgres", detected: true }],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.datastores).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("db"))).toBe(true);
  });

  it("keeps a managed datastore the user accepts", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "fargate", // target for web
      true, // keep LB
      true, // accept managed postgres
      false, // no storage
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
      datastores: [{ name: "db", engine: "postgres", detected: true }],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.datastores).toHaveLength(1);
    expect(result.value.datastores[0]?.name).toBe("db");
  });

  it("drops named volumes the user declines", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "fargate", // target for web
      true, // keep LB
      false, // no new database
      false, // decline named volumes
      false, // no static assets/uploads
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
      storage: [{ name: "data", kind: "shared-volume", source: "compose", sharedBy: ["web"] }],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("data"))).toBe(true);
    expect(driver.exhausted()).toBe(true);
  });

  it("keeps source as compose when nothing changed", async () => {
    const driver = new ScriptedDriver([
      "balanced",
      "us-east-1",
      "fargate", // target for existing web service (provider defaults to aws)
      true, // keep public ports unchanged
      false, // no new database
      false, // no storage
    ]);
    const ir = projectIRSchema.parse({
      meta: { name: "shop", source: "compose" },
      compute: [
        {
          name: "web",
          source: "compose",
          kind: "web",
          image: "nginx",
          ports: [{ container: 80, host: 80, public: true }],
        },
      ],
    });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.source).toBe("compose");
  });
});

describe("acceptRecommendations", () => {
  it("marks each recommendation accepted or rejected per answer", async () => {
    const enriched = {
      ...projectIRSchema.parse({ meta: { name: "x" } }),
      recommendations: [
        {
          ruleId: "a",
          severity: "suggestion" as const,
          message: "m1",
          rationale: "r1",
          costTier: "low" as const,
        },
        {
          ruleId: "b",
          severity: "warning" as const,
          message: "m2",
          rationale: "r2",
        },
      ],
    } as EnrichedIR;
    const accepted = await acceptRecommendations(enriched, new ScriptedDriver([true, false]));
    expect(accepted[0]?.accepted).toBe(true);
    expect(accepted[1]?.accepted).toBe(false);
  });
});
