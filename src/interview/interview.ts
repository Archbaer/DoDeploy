import type { Budget, ComputeTarget, Diagnostic, ProjectIR, Recommendation } from "../ir/index.js";
import { projectIRSchema } from "../ir/index.js";
import type { InterviewDriver } from "./driver.js";

export type InterviewResult =
  | { ok: true; value: ProjectIR; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

const PROVIDER_OPTIONS = [
  { value: "aws" as const, label: "AWS", hint: "ECS Fargate, RDS, ElastiCache, S3…" },
  { value: "gcp" as const, label: "Google Cloud", hint: "Cloud Run, Cloud SQL, Memorystore, GCS…" },
  { value: "azure" as const, label: "Azure", hint: "Container Apps, Flexible Server, Key Vault…" },
];

const BUDGET_OPTIONS = [
  { value: "cheapest" as const, label: "Lowest cost", hint: "$ — single VMs, no HA, dev/hobby" },
  {
    value: "balanced" as const,
    label: "Balanced",
    hint: "$$ — managed where cheap, simple where possible",
  },
  {
    value: "production" as const,
    label: "Production-grade",
    hint: "$$$ — managed services, load balancers, HA",
  },
];

const TARGET_OPTIONS = {
  web: [
    {
      value: "ec2" as const,
      label: "EC2 box",
      hint: "$ — single VM running docker, cheapest, no HA",
    },
    {
      value: "apprunner" as const,
      label: "App Runner",
      hint: "$$ — managed, web services only, needs a pushed image",
    },
    {
      value: "fargate" as const,
      label: "ECS Fargate",
      hint: "$$$ — managed + ALB, production-grade",
    },
  ],
  worker: [
    {
      value: "ec2" as const,
      label: "EC2 box",
      hint: "$ — single VM running docker, cheapest, no HA",
    },
    { value: "fargate" as const, label: "ECS Fargate", hint: "$$$ — managed, no load balancer" },
  ],
};

const budgetOrder = (
  budget: Budget,
  options: readonly { value: ComputeTarget; label: string; hint: string }[],
): { value: ComputeTarget; label: string; hint: string }[] => {
  const priority = (value: ComputeTarget) => {
    if (budget === "cheapest") return value === "ec2" ? 0 : value === "apprunner" ? 1 : 2;
    if (budget === "production") return value === "fargate" ? 0 : value === "apprunner" ? 1 : 2;
    // balanced
    if (value === "apprunner") return 0;
    if (value === "fargate") return 1;
    return 2;
  };
  return [...options].sort((a, b) => priority(a.value) - priority(b.value));
};

const WORKLOAD_OPTIONS = [
  { value: "containers" as const, label: "Containers", hint: "recommended for most workloads" },
  { value: "vms" as const, label: "Virtual machines", hint: "for stateful or legacy workloads" },
];

const KIND_OPTIONS = [
  { value: "web" as const, label: "Web (serves HTTP traffic)" },
  { value: "worker" as const, label: "Worker (background jobs)" },
];

const ENGINE_OPTIONS = [
  { value: "postgres" as const, label: "PostgreSQL" },
  { value: "mysql" as const, label: "MySQL / MariaDB" },
  { value: "redis" as const, label: "Redis (cache)" },
  { value: "mongodb" as const, label: "MongoDB" },
];

const STORAGE_OPTIONS = [
  { value: "static-assets" as const, label: "Static assets (frontend bundles, media)" },
  { value: "uploads" as const, label: "User uploads" },
  { value: "both" as const, label: "Both" },
];

export async function runInterview(
  ir: ProjectIR,
  driver: InterviewDriver,
  provider?: ProjectIR["meta"]["provider"],
  budget?: Budget,
): Promise<InterviewResult> {
  const diagnostics: Diagnostic[] = [];
  let changed = false;

  const meta = { ...ir.meta };
  const compute = [...ir.compute];
  const datastores = [...ir.datastores];
  const storage = [...ir.storage];

  if (provider !== undefined) {
    meta.provider = provider;
  } else if (meta.source === "interview") {
    meta.provider = await driver.select("Target cloud provider?", PROVIDER_OPTIONS);
    changed = true;
  }

  if (budget !== undefined) {
    meta.budget = budget;
  } else {
    meta.budget = await driver.select("What matters most for this deployment?", BUDGET_OPTIONS);
  }

  const region = await driver.text(`Region?`, { defaultValue: meta.region });
  if (region.trim().length > 0 && region !== meta.region) {
    meta.region = region.trim();
    changed = true;
  }

  if (compute.length === 0) {
    const workload = await driver.select("What kind of workloads?", WORKLOAD_OPTIONS);
    const names = await driver.text("Service names (comma separated)?");
    const kind =
      workload === "vms" ? "stateful" : await driver.select("Service type?", KIND_OPTIONS);
    for (const name of names
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0)) {
      compute.push({
        name,
        source: "interview",
        kind,
        ports: [],
        env: {},
        secrets: [],
        dependsOn: [],
      });
    }
    changed = true;
  }

  if (meta.provider === "aws") {
    for (const [index, unit] of compute.entries()) {
      if (unit.kind === "stateful" || unit.target !== undefined) continue;
      const pool = unit.kind === "web" ? TARGET_OPTIONS.web : TARGET_OPTIONS.worker;
      const target = await driver.select(
        `Service "${unit.name}" — run on?`,
        budgetOrder(meta.budget, pool),
      );
      compute[index] = { ...unit, target };
    }
  }

  if (datastores.length === 0) {
    const needsDb = await driver.confirm("Does your app need a database?", true);
    if (needsDb) {
      const engine = await driver.select("Which engine?", ENGINE_OPTIONS);
      datastores.push({ name: engine, engine, detected: false });
      changed = true;
    }
  }

  if (storage.length === 0) {
    const hasStorage = await driver.confirm(
      "Do you serve static assets or handle user uploads?",
      false,
    );
    if (hasStorage) {
      const choice = await driver.select("What kind of storage?", STORAGE_OPTIONS);
      const kinds =
        choice === "both" ? (["static-assets", "uploads"] as const) : ([choice] as const);
      for (const kind of kinds) {
        storage.push({ name: kind, kind, source: "interview", sharedBy: [] });
      }
      changed = true;
    }
  }

  const source = changed && meta.source === "compose" ? "mixed" : meta.source;
  const result = projectIRSchema.safeParse({
    ...ir,
    meta: { ...meta, source },
    compute,
    datastores,
    storage,
  });
  if (!result.success) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        {
          stage: "interview",
          severity: "error",
          message: `interview result failed validation: ${result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        },
      ],
    };
  }
  return { ok: true, value: result.data, diagnostics };
}

export async function acceptRecommendations(
  enriched: { recommendations: Recommendation[] },
  driver: InterviewDriver,
): Promise<Recommendation[]> {
  const decisions: Recommendation[] = [];
  for (const rec of enriched.recommendations) {
    const accepted = await driver.confirm(`${rec.message} — apply?`, rec.severity !== "warning");
    decisions.push({ ...rec, accepted });
  }
  return decisions;
}
