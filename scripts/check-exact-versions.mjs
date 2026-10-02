import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const offenders = [];
for (const field of ["dependencies", "devDependencies"]) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(spec)) {
      offenders.push(`${field}.${name} = "${spec}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error(`Non-exact dependency versions found:\n  ${offenders.join("\n  ")}`);
  process.exit(1);
}
console.log("All dependency versions are exact.");
