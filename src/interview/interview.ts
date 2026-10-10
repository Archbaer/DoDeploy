import type { Budget, ComputeTarget, Diagnostic, ProjectIR, Recommendation } from "../ir/index.js";
import { projectIRSchema } from "../ir/index.js";
import { deriveNetwork } from "../ir/network.js";
import type { InterviewDriver } from "./driver.js";
import { defaultRegion, eligibleTargets } from "./options.js";

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

export const TARGET_ORDER: Record<Budget, ComputeTarget[]> = {
  cheapest: ["ec2", "apprunner", "fargate"],
  balanced: ["apprunner", "fargate", "ec2"],
  production: ["fargate", "apprunner", "ec2"],
};

const budgetOrder = (
  budget: Budget,
  options: readonly { value: ComputeTarget; label: string; hint: string }[],
): { value: ComputeTarget; label: string; hint: string }[] =>
  [...options].sort(
    (a, b) => TARGET_ORDER[budget].indexOf(a.value) - TARGET_ORDER[budget].indexOf(b.value),
  );

const WORKLOAD_OPTIONS = [
  { value: "containers" as const, label: "Containers", hint: "recommended for most workloads" },
  { value: "vms" as const, label: "Virtual machines", hint: "for stateful or legacy workloads" },
];

const KIND_OPTIONS = [
  { value: "web" as const, label: "Web (serves HTTP traffic)" },
  { value: "worker" as const, label: "Worker (background jobs)" },
  { value: "cron" as const, label: "One-shot job" },
  { value: "stateful" as const, label: "Stateful / legacy workload" },
];

const IMAGE_OPTIONS = [
  { value: "pushed" as const, label: "Image already pushed to a registry" },
  { value: "build" as const, label: "Build from a local context (push remains deferred)" },
  { value: "unknown" as const, label: "Image not chosen yet" },
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

async function collectGreenfield(
  driver: InterviewDriver,
  provider: ProjectIR["meta"]["provider"],
  budget: Budget,
  diagnostics: Diagnostic[],
): Promise<Pick<ProjectIR, "compute" | "datastores" | "storage">> {
  const compute: ProjectIR["compute"] = [];
  const datastores: ProjectIR["datastores"] = [];
  const storage: ProjectIR["storage"] = [];
  const knownNames = new Set<string>();

  while (await driver.confirm("Add a service?", compute.length === 0)) {
    let name = "";
    while (name.trim() === "" || knownNames.has(name.trim())) {
      name = await driver.text(
        knownNames.size > 0 && name.trim() !== ""
          ? `Name already used; enter a unique service name`
          : "Service name?",
      );
    }
    name = name.trim();
    knownNames.add(name);
    const kind = await driver.select("Service role?", KIND_OPTIONS);
    const imageKind = await driver.select(`Service "${name}" image?`, IMAGE_OPTIONS);
    const imageValue =
      imageKind === "unknown"
        ? ""
        : await driver.text(
            imageKind === "build" ? `Build context for "${name}"?` : `Image URI for "${name}"?`,
          );
    const imageFields =
      imageKind === "build"
        ? { buildContext: imageValue }
        : imageValue.trim().length > 0
          ? { image: imageValue.trim() }
          : {};
    if (imageKind !== "pushed" || imageValue.trim() === "") {
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `service "${name}" image build/push or image selection remains deferred`,
      });
    }

    const ports: ProjectIR["compute"][number]["ports"] = [];
    if (kind === "web") {
      const isPublic = await driver.confirm(`Expose "${name}" to public HTTP traffic?`, true);
      let port = "";
      if (isPublic) {
        while (true) {
          port = await driver.text(
            port === ""
              ? `Container HTTP port for "${name}"?`
              : "Invalid port; enter integer from 1 to 65535",
          );
          if (/^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535) break;
        }
        ports.push({ container: Number(port), host: Number(port), protocol: "tcp", public: true });
      } else {
        let privatePort = await driver.text(
          `Container port for internal service "${name}" (blank if none)?`,
        );
        privatePort = privatePort.trim();
        if (
          privatePort !== "" &&
          /^[1-9]\d{0,4}$/.test(privatePort) &&
          Number(privatePort) <= 65535
        ) {
          ports.push({ container: Number(privatePort), protocol: "tcp", public: false });
        } else if (privatePort !== "") {
          diagnostics.push({
            stage: "interview",
            severity: "warning",
            message: `invalid port for "${name}" omitted`,
          });
        }
      }
    }
    let target: ProjectIR["compute"][number]["target"];
    if (provider === "aws" && kind !== "stateful") {
      const eligible = eligibleTargets({
        provider,
        kind,
        publicPorts: ports.some((port) => port.public),
        ...("image" in imageFields ? { image: imageFields.image } : {}),
        stateful: false,
      });
      const pool = (kind === "web" ? TARGET_OPTIONS.web : TARGET_OPTIONS.worker).filter((option) =>
        eligible.includes(option.value),
      );
      if (pool.length === 0) {
        diagnostics.push({
          stage: "interview",
          severity: "warning",
          message: `no implemented AWS target supports service "${name}" requirements; revise requirements before deployment`,
        });
      } else {
        target = await driver.select(
          `Service "${name}" — compatible run target?`,
          budgetOrder(budget, pool),
        );
      }
    } else if (kind === "stateful") {
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `stateful service "${name}" is deferred; current renderer does not provide a ready stateful VM deployment`,
      });
    } else if (provider === "gcp" && kind === "worker") {
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `worker "${name}" maps to a Cloud Run job; finite job execution is not a continuously running Compose worker`,
      });
    }
    if (await driver.confirm(`Does "${name}" need persistent mounted storage?`, false)) {
      const volumeName = await driver.text(`Persistent volume name for "${name}"?`);
      storage.push({
        name: volumeName.trim() || `${name}-data`,
        kind: "shared-volume",
        source: "interview",
        sharedBy: [name],
      });
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `persistent volume for "${name}" remains deferred; no managed mount is emitted`,
      });
    }
    compute.push({
      name,
      source: "interview",
      kind,
      ...imageFields,
      ports,
      env: {},
      secrets: [],
      dependsOn: [],
      ...(target !== undefined ? { target } : {}),
    });
  }

  while (await driver.confirm("Add a datastore?", datastores.length === 0)) {
    const engine = await driver.select("Datastore engine?", ENGINE_OPTIONS);
    let name = "";
    while (name.trim() === "" || knownNames.has(name.trim())) {
      name = await driver.text("Unique datastore name?");
    }
    name = name.trim();
    knownNames.add(name);
    const version = (
      await driver.text(`Version for "${name}" (blank for provider default)?`)
    ).trim();
    const managed = await driver.confirm(`Provision managed ${engine} "${name}"?`, true);
    if (!managed) {
      diagnostics.push({
        stage: "interview",
        severity: "info",
        message: `datastore "${name}" is external; no managed resource emitted. Inject its connection reference into dependent services.`,
      });
    } else if (engine === "mongodb") {
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `managed ${engine} datastore "${name}" unsupported by current provider renderers; choose external or revise engine`,
      });
    } else {
      datastores.push({ name, engine, ...(version !== "" ? { version } : {}), detected: false });
    }
  }

  const dependencyNames = [...knownNames];
  for (const unit of compute) {
    const raw = await driver.text(
      `Services/datastores used by "${unit.name}" (comma-separated names, blank for none)?`,
    );
    const deps = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const unknown = deps.filter((dep) => !dependencyNames.includes(dep));
    if (unknown.length > 0) {
      diagnostics.push({
        stage: "interview",
        severity: "warning",
        message: `unknown dependencies for "${unit.name}" omitted: ${unknown.join(", ")}`,
      });
    }
    unit.dependsOn = [...new Set(deps.filter((dep) => dependencyNames.includes(dep)))];
  }
  return { compute, datastores, storage };
}

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
  let storage = [...ir.storage];
  const greenfield = compute.length === 0 && ir.meta.source === "interview";

  if (provider !== undefined) {
    meta.provider = provider;
  } else if (meta.source === "interview") {
    meta.provider = await driver.select("Target cloud provider?", PROVIDER_OPTIONS);
    changed = true;
  }

  if (meta.region === "us-east-1" && meta.provider !== "aws") {
    meta.region = defaultRegion(meta.provider);
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

  if (greenfield) {
    const collected = await collectGreenfield(driver, meta.provider, meta.budget, diagnostics);
    compute.push(...collected.compute);
    datastores.push(...collected.datastores);
    storage.push(...collected.storage);
    changed = true;
    if (compute.length === 0) {
      return {
        ok: false,
        diagnostics: [
          ...diagnostics,
          {
            stage: "interview",
            severity: "error",
            message: "add at least one service before generation",
          },
        ],
      };
    }
  } else if (compute.length === 0) {
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
      const allowed = eligibleTargets({
        provider: meta.provider,
        kind: unit.kind,
        publicPorts: unit.ports.some((port) => port.public),
        ...(unit.image !== undefined ? { image: unit.image } : {}),
        stateful: false,
      });
      const compatible = pool.filter((option) => allowed.includes(option.value));
      const target = await driver.select(
        `Service "${unit.name}" — run on?`,
        budgetOrder(meta.budget, compatible),
      );
      compute[index] = { ...unit, target };
    }
  }

  if (meta.provider === "gcp" && !greenfield) {
    for (const unit of compute) {
      if (unit.kind === "worker") {
        diagnostics.push({
          stage: "interview",
          severity: "warning",
          message: `worker "${unit.name}" maps to a Cloud Run job; this is finite job execution, not a continuously running Compose worker`,
        });
      }
    }
  }

  if (compute.some((u) => u.ports.some((p) => p.public))) {
    const keepPublic = await driver.confirm(
      "Public ports detected — expose via load balancer / public ingress? ($$$ on AWS: ALB)",
      true,
    );
    if (!keepPublic) {
      for (const [index, unit] of compute.entries()) {
        compute[index] = { ...unit, ports: unit.ports.map((p) => ({ ...p, public: false })) };
      }
      changed = true;
    }
  }

  if (greenfield) {
    // Datastores were collected alongside per-service requirements above.
  } else if (datastores.length === 0) {
    const needsDb = await driver.confirm("Does your app need a database?", true);
    if (needsDb) {
      const engine = await driver.select("Which engine?", ENGINE_OPTIONS);
      datastores.push({ name: engine, engine, detected: false });
      changed = true;
    }
  } else {
    for (let i = datastores.length - 1; i >= 0; i--) {
      const d = datastores[i];
      if (!d) continue;
      const managed = await driver.confirm(
        `Provision managed service for ${d.engine} "${d.name}"? ($$$ — managed databases are usually the biggest cost line)`,
        true,
      );
      if (!managed) {
        datastores.splice(i, 1);
        diagnostics.push({
          stage: "interview",
          severity: "info",
          message: `datastore "${d.name}" skipped by user; run it yourself and wire connection env vars manually`,
        });
        changed = true;
      }
    }
  }

  const volumeNodes = storage.filter(
    (s) => s.kind === "shared-volume" || s.kind === "local-volume",
  );
  if (volumeNodes.length > 0) {
    const keepVolumes = await driver.confirm(
      "Named volumes detected — keep them in the plan? (persistent storage renders as deferred EFS/$$$ items)",
      true,
    );
    if (!keepVolumes) {
      storage = storage.filter((s) => s.kind !== "shared-volume" && s.kind !== "local-volume");
      for (const v of volumeNodes) {
        diagnostics.push({
          stage: "interview",
          severity: "info",
          message: `volume "${v.name}" skipped by user; re-add as EFS/azure files/etc if needed`,
        });
      }
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
  const network = deriveNetwork(compute, datastores, storage);
  if (greenfield) {
    const services = compute
      .map((unit) => `${unit.name} (${unit.kind}${unit.target ? `, ${unit.target}` : ""})`)
      .join(", ");
    const databases =
      datastores
        .map((item) => `${item.name} (${item.engine}${item.version ? ` ${item.version}` : ""})`)
        .join(", ") || "none managed";
    const deferred =
      diagnostics
        .filter((item) => item.severity === "warning")
        .map((item) => item.message)
        .join("; ") || "none";
    const review = `Review configuration: services ${services}; datastores ${databases}; public ingress ${network.publicIngress ? "yes" : "no"}; deferred: ${deferred}. Continue?`;
    if (!(await driver.confirm(review, true))) {
      return {
        ok: false,
        diagnostics: [
          { stage: "interview", severity: "error", message: "interview cancelled at final review" },
        ],
      };
    }
  }
  const result = projectIRSchema.safeParse({
    ...ir,
    meta: { ...meta, source },
    compute,
    datastores,
    storage,
    network,
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
