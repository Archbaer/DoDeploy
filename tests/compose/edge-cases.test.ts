import { describe, expect, it } from "vitest";
import { composeFileSchema, normalizeCompose } from "../../src/compose/index.js";

describe("compose edge cases", () => {
  it("ignores services with profiles and emits a warning", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          web: { image: "nginx", ports: ["80:80"] },
          worker: { image: "worker", profiles: ["dev"] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute.map((c) => c.name)).toEqual(["web"]);
    expect(result.diagnostics.some((d) => d.message.includes("profile"))).toBe(true);
  });

  it("warns on bind mounts and does not create storage nodes", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          web: { image: "nginx", volumes: ["./data:/data"] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("bind"))).toBe(true);
  });

  it("keeps shared named volumes that are declared at the top level", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          app: { image: "app", volumes: ["uploads:/data"] },
          worker: { image: "worker", volumes: ["uploads:/data"] },
        },
        volumes: { uploads: {} },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toEqual([
      { name: "uploads", kind: "shared-volume", source: "compose", sharedBy: ["app", "worker"] },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("parses depends_on with conditions into dependsOn", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          api: {
            image: "api",
            depends_on: {
              db: { condition: "service_healthy" },
              cache: { condition: "service_started" },
            },
          },
          db: { image: "postgres:16" },
          cache: { image: "redis:7" },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const api = result.value.compute.find((c) => c.name === "api");
    expect(api?.dependsOn).toEqual(["db", "cache"]);
    expect(result.value.network.securityGroupRules).toContainEqual({
      from: "api",
      to: "db",
      port: 5432,
    });
    expect(result.value.network.securityGroupRules).toContainEqual({
      from: "api",
      to: "cache",
      port: 6379,
    });
  });

  it("maps deploy.resources.limits edge cases", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          api: {
            image: "api",
            deploy: { resources: { limits: { cpus: "0.25", memory: "1.5G" } } },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const api = result.value.compute[0];
    expect(api?.cpu).toBe(0.25);
    expect(api?.memoryMb).toBe(1536);
  });

  it("emits a warning for unparseable memory limits", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          api: { image: "api", deploy: { resources: { limits: { memory: "banana" } } } },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]?.memoryMb).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes("banana"))).toBe(true);
  });

  it("parses healthcheck string test form", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          api: {
            image: "api",
            healthcheck: {
              test: "curl -f http://localhost/health",
              interval: "1m",
              timeout: "10s",
              retries: 5,
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const api = result.value.compute[0];
    expect(api?.healthcheck).toMatchObject({
      command: ["curl -f http://localhost/health"],
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 5,
    });
  });

  it("classifies a published-only port as not public", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: {
          web: { image: "nginx", ports: ["3000"] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const port = result.value.compute[0]?.ports[0];
    expect(port).toMatchObject({ container: 3000, public: false });
    expect(port).not.toHaveProperty("host");
  });
});
