import { describe, expect, it } from "vitest";
import type { Diagnostic, EnrichedIR, ProjectIR } from "../../src/ir/index.js";
import {
  diagnosticSchema,
  enrichedIRSchema,
  err,
  mapResult,
  ok,
  projectIRSchema,
} from "../../src/ir/index.js";

const minimalIR = {
  meta: { name: "shop" },
};

const fullIR = {
  meta: { name: "shop", region: "eu-west-1", source: "compose", provider: "gcp" },
  compute: [
    {
      name: "api",
      source: "compose",
      kind: "web",
      image: "ghcr.io/acme/api:1.2.3",
      ports: [{ container: 3000, host: 80, public: true }],
      cpu: 0.5,
      memoryMb: 512,
      env: { NODE_ENV: "production" },
      secrets: ["DATABASE_URL"],
      dependsOn: ["db"],
    },
    {
      name: "worker",
      source: "compose",
      kind: "worker",
      image: "ghcr.io/acme/worker:1.2.3",
    },
  ],
  datastores: [
    { name: "db", engine: "postgres", version: "16", detected: true },
    { name: "cache", engine: "redis", detected: true },
  ],
  storage: [{ name: "uploads", kind: "uploads", source: "compose", sharedBy: ["api"] }],
  network: {
    vpcCidr: "10.10.0.0/16",
    availabilityZones: 3,
    publicIngress: true,
    loadBalancer: "application",
    serviceDiscovery: true,
    securityGroupRules: [{ from: "api", to: "db", port: 5432 }],
  },
};

describe("projectIRSchema", () => {
  it("parses a minimal IR and applies defaults", () => {
    const ir = projectIRSchema.parse(minimalIR);
    expect(ir.meta.region).toBe("us-east-1");
    expect(ir.meta.source).toBe("compose");
    expect(ir.meta.provider).toBe("aws");
    expect(ir.compute).toEqual([]);
    expect(ir.datastores).toEqual([]);
    expect(ir.storage).toEqual([]);
    expect(ir.network.vpcCidr).toBe("10.0.0.0/16");
    expect(ir.network.availabilityZones).toBe(2);
    expect(ir.network.publicIngress).toBe(false);
    expect(ir.network.loadBalancer).toBe("none");
    expect(ir.network.serviceDiscovery).toBe(false);
    expect(ir.network.securityGroupRules).toEqual([]);
  });

  it("round-trips a full IR without losing values", () => {
    const ir = projectIRSchema.parse(fullIR);
    expect(ir.compute).toHaveLength(2);
    expect(ir.compute[0]?.ports[0]).toMatchObject({ container: 3000, host: 80, public: true });
    expect(ir.compute[1]?.ports).toEqual([]);
    expect(ir.compute[1]?.env).toEqual({});
    expect(ir.datastores[1]?.engine).toBe("redis");
    expect(ir.network.loadBalancer).toBe("application");
    expect(ir.network.securityGroupRules[0]).toEqual({ from: "api", to: "db", port: 5432 });
  });

  it("infers a usable TypeScript type", () => {
    const ir: ProjectIR = projectIRSchema.parse(minimalIR);
    const names: string[] = ir.compute.map((c) => c.name);
    expect(names).toEqual([]);
  });

  it.each([
    ["empty project name", { ...minimalIR, meta: { name: "" } }],
    ["unknown provider", { ...minimalIR, meta: { name: "x", provider: "oracle" } }],
    [
      "port out of range",
      {
        ...minimalIR,
        compute: [{ name: "a", source: "compose", kind: "web", ports: [{ container: 70000 }] }],
      },
    ],
    [
      "zero memory",
      { ...minimalIR, compute: [{ name: "a", source: "compose", kind: "web", memoryMb: 0 }] },
    ],
    [
      "unknown datastore engine",
      { ...minimalIR, datastores: [{ name: "db", engine: "couchdb", detected: true }] },
    ],
    ["invalid CIDR", { ...minimalIR, network: { vpcCidr: "999.0.0.0/16" } }],
    ["CIDR prefix too large", { ...minimalIR, network: { vpcCidr: "10.0.0.0/33" } }],
  ])("rejects %s", (_label, input) => {
    expect(projectIRSchema.safeParse(input).success).toBe(false);
  });

  it("reports the offending field path in validation issues", () => {
    const result = projectIRSchema.safeParse({
      ...minimalIR,
      compute: [{ name: "a", source: "compose", kind: "web", ports: [{ container: 0 }] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("ports"))).toBe(true);
    }
  });

  it("defaults budget to balanced and omits target", () => {
    const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
    expect(ir.meta.budget).toBe("balanced");
    expect(ir.compute).toEqual([]);
  });

  it("accepts a compute target", () => {
    const ir = projectIRSchema.parse({
      meta: { name: "x", source: "compose", budget: "cheapest" },
      compute: [{ name: "web", source: "compose", kind: "web", target: "ec2" }],
    });
    expect(ir.meta.budget).toBe("cheapest");
    expect(ir.compute[0]?.target).toBe("ec2");
  });

  it("rejects an unknown target", () => {
    const result = projectIRSchema.safeParse({
      meta: { name: "x" },
      compute: [{ name: "web", source: "compose", kind: "web", target: "kubernetes" }],
    });
    expect(result.success).toBe(false);
  });
});
describe("enrichedIRSchema", () => {
  it("extends ProjectIR with recommendations", () => {
    const enriched = enrichedIRSchema.parse({
      ...minimalIR,
      recommendations: [
        {
          ruleId: "datastore.postgres-managed",
          severity: "suggestion",
          message: "Run Postgres on a managed database",
          rationale: "Managed backups and failover",
          costTier: "medium",
          accepted: true,
        },
      ],
    });
    expect(enriched.recommendations).toHaveLength(1);
    expect(enriched.recommendations[0]?.ruleId).toBe("datastore.postgres-managed");
  });

  it("rejects an unknown cost tier", () => {
    const result = enrichedIRSchema.safeParse({
      ...minimalIR,
      recommendations: [
        { ruleId: "x", severity: "info", message: "m", rationale: "r", costTier: "priceless" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("is assignable to the inferred EnrichedIR type", () => {
    const value: EnrichedIR = enrichedIRSchema.parse(minimalIR);
    expect(value.recommendations).toEqual([]);
  });
});

describe("diagnosticSchema", () => {
  it("parses a valid diagnostic", () => {
    const d = diagnosticSchema.parse({
      stage: "rules",
      severity: "warning",
      message: "rule failed",
      ruleId: "datastore.postgres-managed",
    });
    expect(d.stage).toBe("rules");
  });

  it("rejects an unknown stage", () => {
    expect(
      diagnosticSchema.safeParse({ stage: "brew-coffee", severity: "info", message: "x" }).success,
    ).toBe(false);
  });
});

describe("Result helpers", () => {
  it("ok() wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err() collects diagnostics", () => {
    const diagnostics: Diagnostic[] = [{ stage: "parse", severity: "error", message: "bad yaml" }];
    const r = err(...diagnostics);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics).toEqual(diagnostics);
  });

  it("mapResult() transforms ok values and passes errors through", () => {
    const doubled = mapResult(ok(2), (n) => n * 2);
    expect(doubled.ok).toBe(true);
    if (doubled.ok) expect(doubled.value).toBe(4);

    const diagnostics: Diagnostic[] = [{ stage: "render", severity: "error", message: "boom" }];
    const failed = mapResult(err(...diagnostics), (n: number) => n * 2);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.diagnostics).toEqual(diagnostics);
  });
});
