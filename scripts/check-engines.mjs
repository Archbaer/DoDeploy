import { readFileSync } from "node:fs";
import semver from "semver";

// Guards the runtime support contract (issue #43): the minimum Node version we
// advertise in package.json "engines" must satisfy every production
// dependency's own engines.node range.
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

const declared = pkg.engines?.node;
if (!declared) {
  console.error("package.json is missing engines.node");
  process.exit(1);
}
const minimum = semver.minVersion(declared);
if (!minimum) {
  console.error(`cannot determine minimum Node version from engines.node "${declared}"`);
  process.exit(1);
}

const offenders = [];
for (const name of Object.keys(pkg.dependencies ?? {})) {
  const dep = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, root), "utf8"));
  const range = dep.engines?.node;
  if (range && !semver.satisfies(minimum, range)) {
    offenders.push(`${name}@${dep.version} requires node "${range}"`);
  }
}

if (offenders.length > 0) {
  console.error(
    `Declared minimum Node ${minimum} (engines.node "${declared}") is rejected by:\n  ${offenders.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`Declared minimum Node ${minimum} satisfies all production dependency engines.`);
