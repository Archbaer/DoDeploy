import { describe, expect, it } from "vitest";
import { parseComposeFile } from "../../src/compose/index.js";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe("parseComposeFile", () => {
  it("parses a valid compose file", () => {
    const result = parseComposeFile(fixture("web-app.yaml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("shop");
      expect(Object.keys(result.value.services)).toEqual(["web"]);
    }
  });

  it("returns a parse diagnostic for a missing file", () => {
    const result = parseComposeFile(fixture("does-not-exist.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.stage).toBe("parse");
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.message).toContain("does-not-exist.yaml");
    }
  });

  it("returns a parse diagnostic for malformed YAML", () => {
    const result = parseComposeFile(fixture("bad-yaml.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.stage).toBe("parse");
      expect(result.diagnostics[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it("returns a parse diagnostic for a structurally invalid compose file", () => {
    const result = parseComposeFile(fixture("invalid-shape.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.stage).toBe("parse");
    }
  });
});
