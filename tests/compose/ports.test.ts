import { describe, expect, it } from "vitest";
import type { DiagnosticLike } from "../../src/compose/ports.js";
import {
  datastoreEngine,
  durationToSeconds,
  memoryToMb,
  namedVolumeRefs,
  serviceEnv,
  toPort,
} from "../../src/compose/ports.js";

const diagnostics: DiagnosticLike[] = [];
const parse = (spec: Parameters<typeof toPort>[0]) => {
  diagnostics.length = 0;
  return toPort(spec, "svc", diagnostics);
};

describe("memoryToMb", () => {
  it.each([
    ["512M", 512],
    ["512MB", 512],
    ["2G", 2048],
    ["1024K", 1],
    ["banana", undefined],
  ])("parses %s → %s", (raw, expected) => {
    expect(memoryToMb(raw)).toBe(expected);
  });
});

describe("durationToSeconds", () => {
  it.each([
    ["30s", 30],
    ["1m30s", 90],
    ["2h", 7200],
    ["500ms", 1],
    ["nope", undefined],
  ])("parses %s → %s", (raw, expected) => {
    expect(durationToSeconds(raw)).toBe(expected);
  });
});

describe("toPort", () => {
  it("parses long syntax with and without published port", () => {
    expect(parse({ target: 3000, published: "80" })).toEqual({
      container: 3000,
      host: 80,
      protocol: "tcp",
      public: true,
    });
    expect(parse({ target: 3000 })).toEqual({
      container: 3000,
      protocol: "tcp",
      public: false,
    });
  });

  it("parses ip-prefixed short syntax and udp protocol", () => {
    expect(parse("127.0.0.1:80:3000")).toMatchObject({ container: 3000, host: 80 });
    expect(parse("3000/udp")).toMatchObject({ container: 3000, protocol: "udp", public: false });
  });

  it("rejects ranges and unparsable values with diagnostics", () => {
    expect(parse("3000-3005")).toBeUndefined();
    expect(diagnostics[0]?.message).toContain("3000-3005");
    expect(parse("abc")).toBeUndefined();
    expect(diagnostics[0]?.message).toContain("abc");
  });
});

describe("serviceEnv", () => {
  it("handles map, list, and undefined forms", () => {
    expect(serviceEnv({ environment: { A: "1", B: null } } as never)).toEqual({ A: "1", B: "" });
    expect(serviceEnv({ environment: ["A=1", "NOEQUALS"] } as never)).toEqual({
      A: "1",
      NOEQUALS: "",
    });
    expect(serviceEnv({} as never)).toEqual({});
  });
});

describe("datastoreEngine", () => {
  it("detects engines with and without registry paths or tags", () => {
    expect(datastoreEngine("postgres:16")).toEqual({ engine: "postgres", version: "16" });
    expect(datastoreEngine("redis")).toEqual({ engine: "redis" });
    expect(datastoreEngine("mariadb:11")).toEqual({ engine: "mysql", version: "11" });
    expect(datastoreEngine("ghcr.io/acme/api:1.0")).toBeUndefined();
  });
});

describe("namedVolumeRefs", () => {
  it("collects short and long volume references only", () => {
    expect(
      namedVolumeRefs({
        volumes: ["uploads:/data", { type: "volume", source: "cache", target: "/cache" }],
      } as never),
    ).toEqual(["uploads", "cache"]);
  });
});
