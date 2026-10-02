import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeTfFileset(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}
