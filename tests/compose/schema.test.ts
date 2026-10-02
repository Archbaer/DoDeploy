import { describe, expect, it } from "vitest";
import { composeFileSchema } from "../../src/compose/index.js";

describe("composeFileSchema", () => {
  it("parses short-syntax ports and object environment", () => {
    const result = composeFileSchema.parse({
      services: {
        web: {
          image: "nginx:1.25",
          ports: ["80:3000", 8080],
          environment: { NODE_ENV: "production", OPTIONAL: null },
        },
      },
    });
    const web = result.services.web;
    expect(web?.ports).toEqual(["80:3000", 8080]);
    expect(web?.environment).toEqual({ NODE_ENV: "production", OPTIONAL: "" });
  });

  it("parses long-syntax ports", () => {
    const result = composeFileSchema.parse({
      services: {
        web: {
          image: "nginx",
          ports: [{ target: 3000, published: "80", protocol: "udp" }],
        },
      },
    });
    expect(result.services.web?.ports[0]).toEqual({
      target: 3000,
      published: "80",
      protocol: "udp",
    });
  });

  it("normalizes list-form environment to a map", () => {
    const result = composeFileSchema.parse({
      services: {
        web: { image: "nginx", environment: ["A=1", "B=two=2"] },
      },
    });
    expect(result.services.web?.environment).toEqual({ A: "1", B: "two=2" });
  });

  it("accepts long-form depends_on and extracts condition form keys", () => {
    const result = composeFileSchema.parse({
      services: {
        api: { image: "api", depends_on: { db: { condition: "service_healthy" } } },
      },
    });
    expect(result.services.api?.dependsOn).toEqual(["db"]);
  });

  it("rejects a service with neither image nor build", () => {
    const result = composeFileSchema.safeParse({ services: { web: {} } });
    expect(result.success).toBe(false);
  });

  it("rejects an empty services record", () => {
    const result = composeFileSchema.safeParse({ services: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object document", () => {
    expect(composeFileSchema.safeParse(["not", "a", "mapping"]).success).toBe(false);
  });
});
