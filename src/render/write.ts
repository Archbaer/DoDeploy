import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WriteFailure {
  name: string;
  message: string;
}

export interface WriteResult {
  ok: boolean;
  written: string[];
  failures: WriteFailure[];
  message: string;
}

export function writeTfFileset(dir: string, files: Record<string, string>): WriteResult {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      written: [],
      failures: [],
      message: `cannot create output directory: ${message}`,
    };
  }

  const written: string[] = [];
  const failures: WriteFailure[] = [];

  for (const [name, content] of Object.entries(files)) {
    try {
      writeFileSync(join(dir, name), content);
      written.push(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name, message });
    }
  }

  if (failures.length > 0) {
    const names = failures.map((f) => f.name).join(", ");
    return {
      ok: false,
      written,
      failures,
      message: `failed to write ${failures.length} file(s): ${names}`,
    };
  }

  return { ok: true, written, failures: [], message: "" };
}
