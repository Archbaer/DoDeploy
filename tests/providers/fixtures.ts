import { expect } from "vitest";
import type { Recommendation } from "../../src/ir/index.js";
import { projectIRSchema } from "../../src/ir/index.js";

export const webIR = projectIRSchema.parse({
  meta: { name: "shop" },
  compute: [
    {
      name: "web",
      source: "compose",
      kind: "web",
      image: "ghcr.io/acme/web:1.0.0",
      ports: [{ container: 3000, host: 80, public: true }],
    },
  ],
});

export const dbIR = projectIRSchema.parse({
  meta: { name: "shop" },
  compute: [
    {
      name: "api",
      source: "compose",
      kind: "web",
      image: "ghcr.io/acme/api:1.0.0",
      ports: [{ container: 8080, host: 8080, public: true }],
      secrets: ["DATABASE_URL"],
      dependsOn: ["db", "cache"],
    },
  ],
  datastores: [
    { name: "db", engine: "postgres", version: "16", detected: true },
    { name: "cache", engine: "redis", detected: true },
  ],
  network: {
    publicIngress: true,
    serviceDiscovery: true,
    securityGroupRules: [
      { from: "api", to: "db", port: 5432 },
      { from: "api", to: "cache", port: 6379 },
    ],
  },
});

export const expectRec = (recommendations: Recommendation[], ruleId: string): Recommendation => {
  const rec = recommendations.find((r) => r.ruleId === ruleId);
  expect(rec, `recommendation ${ruleId} missing`).toBeDefined();
  return rec as Recommendation;
};
