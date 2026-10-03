import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { enrichedIRSchema } from "../../src/ir/index.js";
import { renderAws } from "../../src/providers/aws/render.js";
import { renderAzure } from "../../src/providers/azure/render.js";
import { renderGcp } from "../../src/providers/gcp/render.js";

const injectedName = "TOKEN\nlocals { injected = true }\r\n#";
const secretValue = "never-print-secret-value";
const fixture = () =>
  enrichedIRSchema.parse({
    meta: { name: "comments" },
    compute: [{ name: "api", source: "compose", kind: "web", image: "image:1" }],
  });
const expectSafe = (content: string) => {
  expect(content).not.toMatch(/^[ \t]*locals \{ injected = true \}/m);
  expect(content).not.toContain(secretValue);
  expect(content).toContain(JSON.stringify(injectedName));
};

describe("deferred TODO comment escaping", () => {
  for (const [provider, render] of [
    ["AWS", renderAws],
    ["GCP", renderGcp],
    ["Azure", renderAzure],
  ] as const) {
    it(`${provider} escapes secret keys without leaking values`, () => {
      const ir = fixture();
      assert(ir.compute[0]);
      ir.compute[0].secrets = [injectedName];
      ir.compute[0].env = { [injectedName]: secretValue };
      const { files } = render(ir);
      expectSafe(Object.values(files).join("\n"));
    });

    it(`${provider} escapes service names in secret TODOs`, () => {
      const ir = fixture();
      assert(ir.compute[0]);
      ir.compute[0].name = injectedName;
      ir.compute[0].secrets = ["TOKEN"];
      expectSafe(render(ir).files["compute.tf"] ?? "");
    });
  }

  it("AWS escapes deferred storage names", () => {
    const ir = fixture();
    ir.storage = [{ name: injectedName, source: "compose", kind: "shared-volume", sharedBy: [] }];
    expectSafe(renderAws(ir).files["data.tf"] ?? "");
  });

  it("AWS escapes service names in deferred route TODOs", () => {
    const ir = fixture();
    assert(ir.compute[0]);
    ir.compute[0].name = injectedName;
    ir.compute[0].ports = [{ container: 53, protocol: "udp", public: true }];
    expectSafe(renderAws(ir).files["network.tf"] ?? "");
  });

  it("Azure escapes datastore names in connectivity TODOs", () => {
    const ir = fixture();
    ir.datastores = [{ name: injectedName, engine: "postgres", detected: true }];
    expectSafe(renderAzure(ir).files["data.tf"] ?? "");
  });
});
