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
    // Fractions, sub-second units and composites (issue #27).
    ["1.5s", 2],
    ["100ms", 1],
    ["1us", 1],
    ["1h30m45s", 5445],
    // Positive durations never floor to zero; junk and negatives are rejected whole.
    ["0.1s", 1],
    ["bad30s", undefined],
    ["-10s", undefined],
    ["30", undefined],
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

  it("parses long syntax without published port and udp short syntax", () => {
    expect(parse({ target: 53 })).toEqual({ container: 53, protocol: "tcp", public: false });
    expect(parse("53/udp")).toMatchObject({ container: 53, protocol: "udp", public: false });
  });

  it("ignores a non-integer host port and keeps the container port", () => {
    expect(parse("abc:3000")).toMatchObject({ container: 3000, public: false });
    expect(diagnostics).toHaveLength(0);
  });

  it("keeps loopback-bound ports internal with a diagnostic instead of widening to public", () => {
    expect(parse("127.0.0.1:8080:80")).toEqual({
      container: 80,
      host: 8080,
      protocol: "tcp",
      public: false,
    });
    expect(diagnostics[0]?.message).toContain("127.0.0.1");
    expect(diagnostics[0]?.severity).toBe("warning");

    expect(parse("[::1]:8080:80")).toEqual({
      container: 80,
      host: 8080,
      protocol: "tcp",
      public: false,
    });
    expect(diagnostics[0]?.message).toContain("[::1]");

    expect(parse({ target: 80, published: 8080, host_ip: "127.0.0.1" })).toEqual({
      container: 80,
      host: 8080,
      protocol: "tcp",
      public: false,
    });
    expect(diagnostics[0]?.message).toContain("127.0.0.1");

    expect(parse("localhost:8080:80")).toMatchObject({ host: 8080, public: false });
    expect(diagnostics[0]?.message).toContain("localhost");
  });

  it("keeps wildcard and unprefixed host bindings public without diagnostics", () => {
    expect(parse("0.0.0.0:8080:80")).toMatchObject({ host: 8080, public: true });
    expect(diagnostics).toHaveLength(0);
    expect(parse({ target: 80, published: 8080, host_ip: "0.0.0.0" })).toMatchObject({
      public: true,
    });
    expect(diagnostics).toHaveLength(0);
    expect(parse("8080:80")).toMatchObject({ host: 8080, public: true });
    expect(diagnostics).toHaveLength(0);
  });

  it("treats other specific host IPs as restricted bindings", () => {
    expect(parse("192.168.1.10:8080:80")).toMatchObject({ host: 8080, public: false });
    expect(diagnostics[0]?.message).toContain("192.168.1.10");
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
