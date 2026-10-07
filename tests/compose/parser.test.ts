import { describe, expect, it } from "vitest";
import { parseCompose, parseComposeFile } from "../../src/compose/index.js";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe("YAML merge keys (issue #29)", () => {
  it("resolves inherited image and environment from anchors", () => {
    const result = parseCompose(
      'x-common: &common\n  image: nginx\n  environment:\n    MODE: production\nservices:\n  web:\n    <<: *common\n    ports: ["8080:80"]\n',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.services.web?.image).toBe("nginx");
      expect(result.value.services.web?.environment).toEqual({ MODE: "production" });
    }
  });

  it("lets explicit child keys override merged values", () => {
    const result = parseCompose(
      "x-common: &common\n  image: nginx\n  environment:\n    MODE: staging\nservices:\n  web:\n    <<: *common\n    image: redis\n    environment:\n      MODE: production\n",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.services.web?.image).toBe("redis");
      expect(result.value.services.web?.environment).toEqual({ MODE: "production" });
    }
  });

  it("rejects unresolved merge aliases instead of silently discarding them", () => {
    const result = parseCompose("services:\n  web:\n    <<: *missing\n    image: nginx\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.stage).toBe("parse");
  });
});

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
