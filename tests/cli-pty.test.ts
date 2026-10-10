import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Linux reports PTY EOF as EIO; macOS normally returns an empty read.
// Convert an empty read to EIO so the Linux regression also runs on macOS.
const launcher = `
import errno, json, os, runpy, sys
read = os.read
def linux_read(fd, size):
    data = read(fd, size)
    if not data:
        raise OSError(errno.EIO, "PTY closed")
    return data
os.read = linux_read
recipe = {"command": [sys.executable, "-c", sys.argv[1]], "timeout": float(sys.argv[2])}
sys.argv = ["tests/helpers/cli-pty.py", json.dumps(recipe)]
runpy.run_path(sys.argv[0], run_name="__main__")
`;

function runChild(source: string, timeout = 5) {
  return JSON.parse(
    execFileSync("python3", ["-c", launcher, source, String(timeout)], {
      encoding: "utf8",
      timeout: 10_000,
    }),
  ) as { status: number; output: string };
}

describe("PTY process lifecycle", () => {
  it.each([0, 7, 130])("preserves child exit %i after Linux PTY EOF", (code) => {
    const result = runChild(`print('finished', flush=True); raise SystemExit(${code})`);
    expect(result.status, result.output).toBe(code);
    expect(result.output).toContain("finished");
  });

  it("uses 124 only when the child exceeds the deadline", () => {
    const result = runChild("import time; print('waiting', flush=True); time.sleep(10)", 1);
    expect(result.status).toBe(124);
    expect(result.output).toContain("waiting");
  });
});
