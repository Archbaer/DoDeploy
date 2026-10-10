export type ProviderId = "aws" | "gcp" | "azure";
export type Scenario = {
  id: string;
  level: "minimal" | "common" | "edge";
  fixture?: string;
  failure?: "unreadable-input" | "unwritable-output";
  providers: readonly ProviderId[];
  expectedOutcome: "generation" | "error";
  expectedFiles: readonly string[];
  expectedDiagnostics: readonly string[];
  expectedDeferred: readonly ProviderId[];
  interviewRecipe?: Readonly<Record<string, unknown>>;
};

const all = ["aws", "gcp", "azure"] as const;
const outputFiles = [
  "providers.tf",
  "variables.tf",
  "network.tf",
  "compute.tf",
  "data.tf",
  "outputs.tf",
];
const good = (
  id: string,
  level: Scenario["level"],
  fixture: string,
  expectedDeferred: ProviderId[] = [],
  diagnostics: string[] = [],
): Scenario => ({
  id,
  level,
  fixture,
  providers: all,
  expectedOutcome: "generation",
  expectedFiles: outputFiles,
  expectedDiagnostics: diagnostics,
  expectedDeferred,
});
const bad = (
  id: string,
  fixture: string | undefined,
  diagnostic: string,
  failure?: Scenario["failure"],
): Scenario => ({
  id,
  level: "edge",
  ...(fixture ? { fixture } : {}),
  ...(failure ? { failure } : {}),
  providers: all,
  expectedOutcome: "error",
  expectedFiles: [],
  expectedDiagnostics: [diagnostic],
  expectedDeferred: [],
});

export const scenarios: readonly Scenario[] = [
  good("C01", "minimal", "single-web.yaml"),
  good("C02", "minimal", "single-worker.yaml"),
  good("C03", "common", "web-postgres.yaml", ["aws", "gcp", "azure"]),
  good("C04", "common", "web-mysql.yaml", ["azure"]),
  good("C05", "common", "web-db-redis.yaml", ["aws", "gcp", "azure"]),
  good("C06", "common", "frontend-api-db.yaml", ["azure"]),
  good("C07", "common", "api-worker-db-cache.yaml", ["aws", "gcp", "azure"]),
  good("C08", "common", "multi-web.yaml"),
  good("C09", "common", "single-volume.yaml", ["aws", "gcp", "azure"]),
  good("C10", "common", "stateful-volume.yaml", ["aws", "gcp", "azure"]),
  good("C11", "common", "multi-network.yaml"),
  good("C12", "common", "build-only.yaml", ["aws", "gcp", "azure"]),
  good("C13", "common", "build-and-image.yaml"),
  good("C14", "common", "runtime-options.yaml", ["aws", "gcp", "azure"]),
  good("C15", "common", "anchors-profiles.yaml"),
  good("C16", "common", "multiple-datastores.yaml", ["azure"]),
  good("C17", "common", "mongodb.yaml", ["gcp", "azure"]),
  good("C18", "common", "wordpress-mysql.yaml", ["aws", "gcp", "azure"]),
  good("C19", "common", "one-shot-job.yaml"),
  good("C20", "common", "multi-service.yaml", ["azure"]),
  bad("E01", "bad-yaml.yaml", "invalid compose file:"),
  bad("E02", "invalid-shape.yaml", "invalid compose file:"),
  good("E03", "edge", "edge/port-forms.yaml"),
  good("E04", "edge", "edge/port-forms.yaml"),
  bad("E05", "edge/invalid-port.yaml", "normalized IR failed validation:"),
  good("E06", "edge", "edge/port-ranges.yaml"),
  good("E07", "edge", "edge/shared-host-port.yaml", ["aws"]),
  good("E08", "edge", "edge/udp-ports.yaml", ["aws"]),
  good("E09", "edge", "edge/duplicate-ports.yaml", ["aws"]),
  good("E10", "edge", "edge/env-shapes.yaml"),
  good("E11", "edge", "edge/escaped-env.yaml"),
  good("E12", "edge", "edge/secret-sentinels.yaml", ["aws", "gcp", "azure"]),
  bad("E13", "edge/sizing.yaml", "invalid compose file:"),
  good("E14", "edge", "edge/healthcheck.yaml"),
  bad("E15", "edge/label-collision.yaml", "sanitize to Terraform label"),
  good("E16", "edge", "edge/commands.yaml"),
  good("E17", "edge", "edge/volume-forms.yaml", ["aws", "gcp", "azure"]),
  good("E18", "edge", "edge/dependencies.yaml", ["azure"]),
  good("E19", "edge", "edge/profiles-only.yaml"),
  good("E20", "edge", "edge/unsupported-compose.yaml"),
  good("E21", "edge", "edge/database-tags.yaml", ["azure"]),
  good("E22", "edge", "edge/database-only.yaml", ["azure"]),
  bad("E23", undefined, "cannot read compose file:", "unreadable-input"),
  bad("E24", "single-web.yaml", "cannot create output directory:", "unwritable-output"),
];

export function scenariosFor(provider: ProviderId): readonly Scenario[] {
  return scenarios.filter((scenario) => scenario.providers.includes(provider));
}
