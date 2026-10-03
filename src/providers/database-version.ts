import type { Diagnostic, ProjectIR } from "../ir/index.js";

export function resolveDatabaseVersion(
  provider: "aws" | "gcp" | "azure",
  datastore: ProjectIR["datastores"][number],
): { version: string; diagnostics: Diagnostic[] } {
  // Docker distro suffixes are packaging details, not managed engine versions.
  // Unknown/custom/prerelease tags must not silently become stable releases.
  const raw = datastore.version;
  const numeric = raw?.match(
    /^(\d+(?:\.\d+){0,2})(?:-(?:alpine[\d.]*|bookworm|bullseye|trixie|oracle(?:linux)?[\d.]*))?$/,
  )?.[1];
  const parts = numeric?.split(".");
  const postgres = datastore.engine === "postgres";
  const family = postgres ? parts?.[0] : parts?.slice(0, 2).join(".");
  const supported = postgres
    ? family !== undefined &&
      Number(family) >= (provider === "azure" ? 11 : 10) &&
      Number(family) <= 17
    : family !== undefined && ["5.7", "8.0", "8.4"].includes(family);
  const selected = supported ? (family as string) : postgres ? "16" : "8.0";
  const version =
    provider === "gcp"
      ? `${postgres ? "POSTGRES" : "MYSQL"}_${selected.replaceAll(".", "_")}`
      : provider === "azure" && !postgres && selected === "8.0"
        ? "8.0.21"
        : selected;
  return {
    version,
    diagnostics:
      raw !== undefined && !supported
        ? [
            {
              stage: "render",
              severity: "warning",
              message: `datastore "${datastore.name}": cannot safely map ${datastore.engine} version "${raw}" to ${provider}; using generator default "${version}". Review engine compatibility before applying.`,
            },
          ]
        : [],
  };
}
