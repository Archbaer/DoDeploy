import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";

const FIXTURES = join(process.cwd(), "tests/compose/fixtures");

describe("runDoctor", () => {
  it("fails critically when compose parses but resource normalization fails", () => {
    const path = join(mkdtempSync(join(tmpdir(), "dd-doctor-")), "compose.yaml");
    writeFileSync(
      path,
      "services:\n  api:\n    image: nginx\n    deploy:\n      resources:\n        limits:\n          cpus: banana\n",
    );
    const compose = runDoctor({ composePath: path }).find((check) => check.id === "compose");
    expect(compose?.ok).toBe(false);
    expect(compose?.critical).toBe(true);
    expect(compose?.detail).toContain("cpu");
  });

  it("reports blocking normalization error before an earlier warning", () => {
    const path = join(mkdtempSync(join(tmpdir(), "dd-doctor-warning-")), "compose.yaml");
    writeFileSync(
      path,
      "services:\n  api:\n    image: nginx\n    deploy:\n      resources:\n        limits:\n          cpus: banana\n          memory: banana\n",
    );
    const compose = runDoctor({ composePath: path }).find((check) => check.id === "compose");
    expect(compose?.ok).toBe(false);
    expect(compose?.critical).toBe(true);
    expect(compose?.detail).toContain("cpu");
    expect(compose?.detail).not.toContain("cannot parse memory limit");
  });

  it("reports terraform presence (advisory), node runtime and compose validity", () => {
    const checks = runDoctor({ composePath: join(FIXTURES, "web-db-redis.yaml") });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(typeof byId.terraform?.ok).toBe("boolean");
    expect(byId.terraform?.critical).toBe(false);
    expect(byId.compose?.ok).toBe(true);
    expect(byId.compose?.detail).toContain("services");
    expect(byId.node?.ok).toBe(true);
  });

  it("fails the compose check for a missing file (critical)", () => {
    const checks = runDoctor({ composePath: join(FIXTURES, "nope.yaml") });
    const compose = checks.find((c) => c.id === "compose");
    expect(compose?.ok).toBe(false);
    expect(compose?.critical).toBe(true);
  });

  it("fails the compose check for invalid YAML (critical)", () => {
    const checks = runDoctor({ composePath: join(FIXTURES, "bad-yaml.yaml") });
    const compose = checks.find((c) => c.id === "compose");
    expect(compose?.ok).toBe(false);
    expect(compose?.critical).toBe(true);
  });
});
