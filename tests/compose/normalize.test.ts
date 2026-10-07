import { describe, expect, it } from "vitest";
import { composeFileSchema, normalizeCompose, parseComposeFile } from "../../src/compose/index.js";

const load = (name: string) => {
  const parsed = parseComposeFile(new URL(`./fixtures/${name}`, import.meta.url));
  if (!parsed.ok) throw new Error(`fixture ${name} failed to parse`);
  return parsed.value;
};

describe("normalizeCompose", () => {
  it("maps a public web service with host port to a web compute unit", () => {
    const result = normalizeCompose(load("web-app.yaml"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unit = result.value.compute[0];
    expect(unit?.name).toBe("web");
    expect(unit?.kind).toBe("web");
    expect(unit?.image).toBe("ghcr.io/acme/web:1.0.0");
    expect(unit?.ports[0]).toMatchObject({ container: 3000, host: 80, public: true });
    expect(unit?.env.NODE_ENV).toBe("production");
    expect(unit?.secrets).toContain("API_TOKEN");
    expect(result.value.network.publicIngress).toBe(true);
    expect(result.value.network.loadBalancer).toBe("application");
  });

  it("keeps loopback-published ports internal end to end (issue #24)", () => {
    const file = composeFileSchema.parse({
      services: {
        web: {
          image: "nginx",
          ports: ["127.0.0.1:8080:80", { target: 81, published: 8081, host_ip: "[::1]" }],
        },
      },
    });
    const result = normalizeCompose(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unit = result.value.compute[0];
    expect(unit?.ports).toHaveLength(2);
    expect(unit?.ports.every((p) => !p.public)).toBe(true);
    expect(unit?.kind).toBe("worker");
    expect(result.value.network.publicIngress).toBe(false);
    expect(result.value.network.loadBalancer).toBe("none");
    expect(
      result.diagnostics.filter((d) => d.message.includes("not publicly reachable")),
    ).toHaveLength(2);
  });

  it("preserves command and entrypoint overrides in list, string and empty forms (issue #25)", () => {
    const file = composeFileSchema.parse({
      services: {
        list: { image: "alpine:3", entrypoint: ["/bin/sh"], command: ["-c", "sleep infinity"] },
        str: { image: "alpine:3", entrypoint: "/entry.sh", command: "bundle exec thin -p 3000" },
        empty: { image: "alpine:3", command: [] },
        plain: { image: "alpine:3" },
      },
    });
    const result = normalizeCompose(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byName = new Map(result.value.compute.map((u) => [u.name, u]));
    expect(byName.get("list")).toMatchObject({
      entrypoint: ["/bin/sh"],
      command: ["-c", "sleep infinity"],
    });
    expect(byName.get("str")).toMatchObject({
      entrypoint: ["/entry.sh"],
      command: ["sh", "-c", "bundle exec thin -p 3000"],
    });
    expect(byName.get("empty")?.command).toEqual([]);
    expect(byName.get("plain")?.command).toBeUndefined();
    expect(byName.get("plain")?.entrypoint).toBeUndefined();
  });

  it("detects datastore images and extracts engine and version", () => {
    const result = normalizeCompose(load("web-db-redis.yaml"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute.map((c) => c.name)).toEqual(["api"]);
    expect(result.value.datastores).toEqual([
      { name: "db", engine: "postgres", version: "16", detected: true },
      { name: "cache", engine: "redis", version: "7", detected: true },
    ]);
  });

  it("wires depends_on into security group rules with default engine ports", () => {
    const result = normalizeCompose(load("web-db-redis.yaml"));
    if (!result.ok) throw new Error("normalize failed");
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
    expect(result.value.compute[0]?.dependsOn).toEqual(["db", "cache"]);
  });

  it("maps resource limits and healthcheck durations", () => {
    const result = normalizeCompose(load("web-db-redis.yaml"));
    if (!result.ok) throw new Error("normalize failed");
    const api = result.value.compute[0];
    expect(api?.cpu).toBe(0.5);
    expect(api?.memoryMb).toBe(512);
    expect(api?.healthcheck).toMatchObject({ intervalSeconds: 30, timeoutSeconds: 5, retries: 3 });
  });

  it("flags secret-looking environment keys", () => {
    const result = normalizeCompose(load("web-db-redis.yaml"));
    if (!result.ok) throw new Error("normalize failed");
    const api = result.value.compute[0];
    expect(api?.secrets).toEqual(expect.arrayContaining(["DATABASE_URL", "REDIS_URL"]));
    expect(api?.secrets).not.toContain("LOG_LEVEL");
  });

  it("maps shared named volumes to shared-volume storage nodes", () => {
    const result = normalizeCompose(load("stateful-volume.yaml"));
    if (!result.ok) throw new Error("normalize failed");
    expect(result.value.storage).toEqual([
      { name: "uploads", kind: "shared-volume", source: "compose", sharedBy: ["app", "worker"] },
    ]);
  });

  it("classifies port-less services as workers and enables service discovery", () => {
    const result = normalizeCompose(load("stateful-volume.yaml"));
    if (!result.ok) throw new Error("normalize failed");
    const worker = result.value.compute.find((c) => c.name === "worker");
    expect(worker?.kind).toBe("worker");
    expect(result.value.network.serviceDiscovery).toBe(true);
  });

  it("collects a diagnostic for unsupported port ranges without failing", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        name: "ranges",
        services: {
          web: { image: "nginx", ports: ["3000-3005"] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]?.ports).toEqual([]);
    expect(result.diagnostics?.some((d) => d.message.includes("3000-3005"))).toBe(true);
  });

  it("uses build context when no image is given", () => {
    const result = normalizeCompose(
      composeFileSchema.parse({
        services: { app: { build: "./app" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compute[0]?.buildContext).toBe("./app");
  });
});
