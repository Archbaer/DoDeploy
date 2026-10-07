import { CANCEL_SYMBOL } from "@clack/core";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...mod,
    cancel: vi.fn(),
    text: vi.fn(async () => CANCEL_SYMBOL),
    select: vi.fn(async () => CANCEL_SYMBOL),
    confirm: vi.fn(async () => CANCEL_SYMBOL),
  };
});

const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((() => undefined) as (code?: string | number | null) => never);

const { ClackDriver } = await import("../../src/interview/clack-driver.js");

afterAll(() => {
  exitSpy.mockRestore();
});

describe("ClackDriver cancellation (issue #41)", () => {
  it.each([
    ["text", (d: InstanceType<typeof ClackDriver>) => d.text("question?")],
    [
      "select",
      (d: InstanceType<typeof ClackDriver>) =>
        d.select("question?", [{ value: "a" as const, label: "a" }]),
    ],
    ["confirm", (d: InstanceType<typeof ClackDriver>) => d.confirm("question?")],
  ])("%s cancellation exits 130, not 0", async (_method, ask) => {
    exitSpy.mockClear();
    await ask(new ClackDriver());
    expect(exitSpy).toHaveBeenCalledWith(130);
    expect(exitSpy).not.toHaveBeenCalledWith(0);
  });
});
