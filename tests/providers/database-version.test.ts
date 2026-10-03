import { describe, expect, it } from "vitest";
import { resolveDatabaseVersion } from "../../src/providers/database-version.js";

describe("managed database versions", () => {
  it("does not emit PostgreSQL 10 for Azure Flexible Server", () => {
    const result = resolveDatabaseVersion("azure", {
      name: "legacy",
      engine: "postgres",
      version: "10-alpine",
      detected: true,
    });
    expect(result.version).toBe("16");
    expect(result.diagnostics[0]?.message).toContain('"legacy"');
    expect(result.diagnostics[0]?.message).toContain('"10-alpine"');
  });
  it.each([
    ["aws", "postgres", "16.3-alpine3.20", "16"],
    ["gcp", "postgres", "16-alpine", "POSTGRES_16"],
    ["azure", "postgres", "15.6-bookworm", "15"],
    ["aws", "mysql", "8.0.36-oraclelinux8", "8.0"],
    ["gcp", "mysql", "8.4", "MYSQL_8_4"],
    ["azure", "mysql", "8.0", "8.0.21"],
    ["azure", "mysql", "5.7", "5.7"],
  ] as const)("maps %s %s image tag %s to %s", (provider, engine, version, expected) => {
    const result = resolveDatabaseVersion(provider, {
      name: "db",
      engine,
      version,
      detected: true,
    });
    expect(result.version).toBe(expected);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["latest", "banana", "99", "16-rc1", "16.1-custom"])(
    "reports unsafe PostgreSQL tag %s before falling back",
    (version) => {
      const result = resolveDatabaseVersion("gcp", {
        name: "db",
        engine: "postgres",
        version,
        detected: true,
      });
      expect(result.version).toBe("POSTGRES_16");
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining(`"${version}"`),
        }),
      ]);
      expect(result.diagnostics[0]?.message).toContain('"db"');
    },
  );

  it.each(["aws", "gcp", "azure"] as const)("uses defaults for absent %s versions", (provider) => {
    expect(
      resolveDatabaseVersion(provider, { name: "db", engine: "postgres", detected: true })
        .diagnostics,
    ).toEqual([]);
  });

  it("does not treat a MariaDB version or ambiguous MySQL major as a MySQL release", () => {
    for (const version of ["11", "8", "9.0"]) {
      const result = resolveDatabaseVersion("azure", {
        name: "db",
        engine: "mysql",
        version,
        detected: true,
      });
      expect(result.version).toBe("8.0.21");
      expect(result.diagnostics).toHaveLength(1);
    }
  });
});
