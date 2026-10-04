import { describe, expect, it } from "vitest";
import { acceptRecommendations, runInterview, ScriptedDriver } from "../../src/interview/index.js";
import type { EnrichedIR } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";

describe("runInterview", () => {
  it("builds a full IR from an empty interview-source project", async () => {
    const driver = new ScriptedDriver([
      "gcp",
      "balanced",
      "europe-west1",
      "containers",
      "api, worker",
      "worker",
      true,
      "postgres",
      false,
    ]);
    const ir = projectIRSchema.parse({ meta: { name: "greenfield", source: "interview" } });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.provider).toBe("gcp");
    expect(result.value.meta.region).toBe("europe-west1");
    expect(result.value.meta.source).toBe("interview");
    expect(result.value.compute).toEqual([
      expect.objectContaining({ name: "api", kind: "worker", source: "interview" }),
      expect.objectContaining({ name: "worker", kind: "worker", source: "interview" }),
    ]);
    expect(result.value.datastores).toEqual([
      expect.objectContaining({ engine: "postgres", detected: false }),
    ]);
    expect(result.value.storage).toEqual([]);
  });

  it("marks VM workloads as stateful", async () => {
    const driver = new ScriptedDriver([
      "aws",
      "balanced",
      "us-east-1",
      "vms",
      "legacy",
      true,
      "mysql",
      false,
    ]);
    const ir = projectIRSchema.parse({ meta: { name: "lift", source: "interview" } });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]).toEqual(
      expect.objectContaining({ name: "legacy", kind: "stateful" }),
    );
  });

  it("fills gaps of a compose-origin IR and marks source as mixed", async () => {
    const driver = new ScriptedDriver(["balanced", "eu-west-1", false, true, "static-assets"]);
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

  it("asks for budget and stores it in meta", async () => {
    const driver = new ScriptedDriver([
      "gcp",
      "cheapest",
      "europe-west1",
      "vms",
      "legacy",
      false,
      false,
    ]);
    const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
    const result = await runInterview(ir, driver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.budget).toBe("cheapest");
  });

  it("skips the budget question when a budget is passed in", async () => {
    const driver = new ScriptedDriver(["gcp", "europe-west1", "vms", "legacy", false, false]);
    const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
    const result = await runInterview(ir, driver, undefined, "production");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.budget).toBe("production");
    expect(driver.exhausted()).toBe(true);
  });

  it("keeps source as compose when nothing changed", async () => {
    const driver = new ScriptedDriver(["balanced", "us-east-1", false, false]);
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
