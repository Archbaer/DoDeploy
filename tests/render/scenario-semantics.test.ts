import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCompose, parseComposeFile } from "../../src/compose/index.js";
import { generateProject } from "../../src/generate.js";
import { scenarios } from "../scenarios/catalog.js";

const root = join(process.cwd(), "tests/compose/fixtures");

describe("scenario catalog expectations", () => {
  for (const scenario of scenarios) {
    for (const provider of scenario.providers) {
      it(`${scenario.id} ${provider}: matches declared output, diagnostics and deferred work`, async () => {
        const temp = mkdtempSync(join(tmpdir(), `dodeploy-${scenario.id}-${provider}-`));
        const outDir =
          scenario.failure === "unwritable-output"
            ? join(temp, "not-a-directory")
            : join(temp, "out");
        if (scenario.failure === "unwritable-output") writeFileSync(outDir, "preserve-me");
        if (!scenario.fixture && scenario.failure !== "unreadable-input") {
          throw new Error(`${scenario.id} missing Compose fixture`);
        }
        const composePath =
          scenario.failure === "unreadable-input"
            ? join(temp, "missing-compose.yaml")
            : join(root, scenario.fixture ?? "");
        const result = await generateProject({ composePath, provider, outDir, interview: false });

        if (scenario.expectedOutcome === "error") {
          expect(result.ok, scenario.id).toBe(false);
          if (result.ok) return;
          for (const expected of scenario.expectedDiagnostics) {
            expect(
              result.diagnostics.some((diagnostic) => diagnostic.message.includes(expected)),
              scenario.id,
            ).toBe(true);
          }
          expect(readdirSync(temp).sort()).toEqual(
            scenario.failure === "unwritable-output" ? ["not-a-directory"] : [],
          );
          if (scenario.failure === "unwritable-output") {
            expect(readFileSync(outDir, "utf8")).toBe("preserve-me");
          }
          return;
        }

        expect(result.ok, scenario.id).toBe(true);
        if (!result.ok) return;
        expect(result.filesWritten.slice().sort(), scenario.id).toEqual(
          scenario.expectedFiles.slice().sort(),
        );
        const generated = Object.fromEntries(
          result.filesWritten.map((name) => [name, readFileSync(join(outDir, name), "utf8")]),
        );
        const source = Object.values(generated).join("\n");
        for (const expected of scenario.expectedDiagnostics) {
          expect(
            result.diagnostics.some((diagnostic) => diagnostic.message.includes(expected)),
            scenario.id,
          ).toBe(true);
        }
        expect(result.deferred.length > 0, scenario.id).toBe(
          scenario.expectedDeferred.includes(provider),
        );
        expect(source).not.toContain("TEST_ONLY_PASSWORD_SENTINEL");
        expect(source).not.toContain("TEST_ONLY_TOKEN_SENTINEL");

        const parsed = parseComposeFile(pathToFileURL(composePath));
        expect(parsed.ok, scenario.id).toBe(true);
        if (!parsed.ok) return;
        const normalized = normalizeCompose(parsed.value);
        expect(normalized.ok, scenario.id).toBe(true);
        if (!normalized.ok) return;
        if (scenario.id === "C01") {
          expect(normalized.value.compute[0]).toMatchObject({
            image: "nginx:1.27-alpine",
            kind: "web",
          });
          expect(normalized.value.compute[0]?.ports).toContainEqual(
            expect.objectContaining({ host: 8080, container: 80, public: true }),
          );
        } else if (scenario.id === "C02") {
          expect(normalized.value.network.publicIngress).toBe(false);
          expect(normalized.value.compute[0]?.kind).toBe("worker");
        } else if (scenario.id === "C03") {
          expect(normalized.value.datastores).toContainEqual(
            expect.objectContaining({ name: "db", engine: "postgres" }),
          );
          expect(normalized.value.compute[0]?.dependsOn).toContain("db");
        } else if (scenario.id === "C04") {
          expect(normalized.value.datastores.map((item) => item.engine)).toContain("mysql");
          expect(normalized.value.datastores.map((item) => item.engine)).not.toContain("postgres");
        } else if (scenario.id === "C06") {
          expect(normalized.value.compute.map((unit) => unit.name)).toEqual(
            expect.arrayContaining(["frontend", "api"]),
          );
          expect(normalized.value.compute.find((unit) => unit.name === "api")?.dependsOn).toContain(
            "db",
          );
        } else if (scenario.id === "C08") {
          expect(normalized.value.compute.filter((unit) => unit.kind === "web")).toHaveLength(2);
          expect(
            normalized.value.compute.every((unit) => unit.ports.some((port) => port.public)),
          ).toBe(true);
        } else if (scenario.id === "C05" || scenario.id === "C07") {
          expect(normalized.value.datastores.map((item) => item.engine)).toEqual(
            expect.arrayContaining(["postgres", "redis"]),
          );
        }
        if (scenario.id === "C07") {
          expect(
            normalized.value.compute.find((unit) => unit.name === "worker")?.ports,
          ).toHaveLength(0);
        }
        if (scenario.id === "C16") {
          expect(normalized.value.datastores.map((item) => item.engine)).toEqual(
            expect.arrayContaining(["postgres", "mysql", "redis"]),
          );
        }
        if (scenario.id === "C09" || scenario.id === "C10") {
          expect(normalized.value.storage).toContainEqual(
            expect.objectContaining({ name: "uploads", kind: "shared-volume" }),
          );
        }
        if (scenario.id === "C12" || scenario.id === "C13") {
          expect(normalized.value.compute[0]?.buildContext).toBe("./api");
          if (scenario.id === "C13") {
            expect(normalized.value.compute[0]?.image).toBe("ghcr.io/example/api:1.0");
            expect(generated["variables.tf"]).not.toContain("api_image");
          } else {
            expect(generated["variables.tf"]).toContain("api_image");
          }
        }
        if (scenario.id === "C14") {
          expect(normalized.value.compute[0]).toMatchObject({ cpu: 0.5, memoryMb: 1024 });
          expect(normalized.value.compute[0]?.command).toEqual(["node", "server.js"]);
          expect(normalized.value.compute[0]?.healthcheck).toBeDefined();
        }
        if (scenario.id === "C15") {
          expect(normalized.value.compute.map((unit) => unit.name)).toContain("web");
          expect(normalized.value.compute.map((unit) => unit.name)).not.toContain("debug");
        }
        if (scenario.id === "C17") {
          expect(normalized.value.datastores).toContainEqual(
            expect.objectContaining({ engine: "mongodb" }),
          );
        }
        if (scenario.id === "C18") {
          expect(normalized.value.compute.map((unit) => unit.name)).toContain("wordpress");
          expect(normalized.value.datastores.map((item) => item.engine)).toContain("mysql");
        }
        if (scenario.id === "C19") {
          expect(normalized.value.compute[0]?.command).toEqual(["sh", "-c", "echo migrate"]);
        }
        if (scenario.id === "C20") {
          expect(normalized.value.compute).toHaveLength(9);
        }
        if (scenario.id === "E12") {
          expect(source).not.toContain("TEST_ONLY_TOKEN_SENTINEL");
        }
        if (scenario.id === "E03" || scenario.id === "E04") {
          expect(normalized.value.compute[0]?.ports).toHaveLength(3);
          expect(
            normalized.value.compute[0]?.ports.some((port) => !port.public && port.host === 9090),
          ).toBe(true);
        }
        if (scenario.id === "E10") {
          expect(normalized.value.compute[0]?.env).toMatchObject({
            A: "one=two",
            EMPTY: "",
            BARE: "",
          });
        }
        if (scenario.id === "E11") {
          expect(normalized.value.compute[0]?.env.MESSAGE).toContain("quote");
          expect(source).toContain("\\\\");
        }
        if (scenario.id === "E14") {
          expect(normalized.value.compute[0]?.healthcheck?.intervalSeconds).toBe(30);
        }
        if (scenario.id === "E17") {
          expect(normalized.value.storage).toContainEqual(
            expect.objectContaining({ name: "named", sharedBy: ["app"] }),
          );
          expect(
            result.diagnostics.some((diagnostic) =>
              diagnostic.message.includes("not a named Compose volume"),
            ),
          ).toBe(true);
        }
        if (scenario.id === "E18") {
          expect(normalized.value.compute[0]?.dependsOn).toContain("db");
        }
        if (scenario.id === "E19") expect(normalized.value.compute).toHaveLength(0);
        if (scenario.id === "E21") {
          expect(
            normalized.value.datastores.filter((item) => item.engine === "mysql"),
          ).toHaveLength(2);
        }
        if (scenario.id === "E22") {
          expect(normalized.value.compute).toHaveLength(0);
          expect(normalized.value.datastores).toHaveLength(1);
        }
      });
    }
  }
});
