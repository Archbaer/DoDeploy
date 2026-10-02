import type { ComputeUnit, Diagnostic, ProjectIR } from "../ir/schema.js";
import { projectIRSchema } from "../ir/schema.js";
import {
  datastoreEngine,
  durationToSeconds,
  memoryToMb,
  namedVolumeRefs,
  serviceEnv,
  toPort,
} from "./ports.js";
import type { ComposeFile } from "./schema.js";

export type NormalizeResult =
  | { ok: true; value: ProjectIR; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

const ENGINE_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
};

const SECRET_KEY = /(PASS|SECRET|TOKEN|KEY|URL|CRED)/i;

export function normalizeCompose(compose: ComposeFile): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const compute: ComputeUnit[] = [];
  const datastores: ProjectIR["datastores"] = [];
  const sharedBy = new Map<string, string[]>();

  for (const [serviceName, service] of Object.entries(compose.services)) {
    const image = service.image ?? undefined;
    const datastore = image !== undefined ? datastoreEngine(image) : undefined;

    if (datastore) {
      datastores.push({
        name: serviceName,
        engine: datastore.engine as ProjectIR["datastores"][number]["engine"],
        ...(datastore.version !== undefined ? { version: datastore.version } : {}),
        detected: true,
      });
      continue;
    }

    const env = serviceEnv(service);
    const ports: ComputeUnit["ports"] = [];
    for (const spec of service.ports ?? []) {
      const port = toPort(spec, serviceName, diagnostics);
      if (port) ports.push(port);
    }

    const limits = service.deploy?.resources?.limits;
    const memoryMb = limits?.memory !== undefined ? memoryToMb(limits.memory) : undefined;
    if (limits?.memory !== undefined && memoryMb === undefined) {
      diagnostics.push({
        stage: "normalize",
        severity: "warning",
        message: `service "${serviceName}": cannot parse memory limit "${limits.memory}"`,
      });
    }

    const test = service.healthcheck?.test;
    const intervalSeconds =
      service.healthcheck?.interval !== undefined
        ? durationToSeconds(service.healthcheck.interval)
        : undefined;
    const timeoutSeconds =
      service.healthcheck?.timeout !== undefined
        ? durationToSeconds(service.healthcheck.timeout)
        : undefined;
    const healthcheck =
      service.healthcheck === undefined
        ? undefined
        : {
            command: Array.isArray(test) ? test : [test ?? ""],
            intervalSeconds: intervalSeconds ?? 30,
            timeoutSeconds: timeoutSeconds ?? 5,
            retries: service.healthcheck.retries ?? 3,
          };

    const buildContext =
      typeof service.build === "string" ? service.build : (service.build?.context ?? undefined);

    compute.push({
      name: serviceName,
      source: "compose",
      kind: ports.some((p) => p.public) ? "web" : "worker",
      ...(image !== undefined ? { image } : {}),
      ...(buildContext !== undefined ? { buildContext } : {}),
      ports,
      ...(limits?.cpus !== undefined ? { cpu: Number(limits.cpus) } : {}),
      ...(memoryMb !== undefined ? { memoryMb } : {}),
      env,
      secrets: Object.keys(env).filter((key) => SECRET_KEY.test(key)),
      ...(healthcheck !== undefined ? { healthcheck } : {}),
      dependsOn: service.dependsOn ?? [],
    });

    for (const ref of namedVolumeRefs({ ...service, volumes: service.volumes ?? [] })) {
      sharedBy.set(ref, [...(sharedBy.get(ref) ?? []), serviceName]);
    }
  }

  const storage: ProjectIR["storage"] = [...sharedBy.entries()]
    .filter(([name]) => compose.volumes !== undefined && name in compose.volumes)
    .map(([name, users]) => ({
      name,
      kind: "shared-volume" as const,
      source: "compose" as const,
      sharedBy: users,
    }));

  const publicIngress = compute.some((unit) => unit.ports.some((p) => p.public));
  const securityGroupRules: ProjectIR["network"]["securityGroupRules"] = [];
  for (const unit of compute) {
    for (const dep of unit.dependsOn) {
      const datastore = datastores.find((d) => d.name === dep);
      const port = datastore
        ? ENGINE_PORTS[datastore.engine]
        : compute.find((c) => c.name === dep)?.ports[0]?.container;
      if (port !== undefined) {
        securityGroupRules.push({ from: unit.name, to: dep, port });
      }
    }
  }

  const ir = projectIRSchema.safeParse({
    meta: { name: compose.name ?? "app", source: "compose" },
    compute,
    datastores,
    storage,
    network: {
      publicIngress,
      loadBalancer: publicIngress ? "application" : "none",
      serviceDiscovery: compute.some((u) => u.dependsOn.length > 0) || storage.length > 0,
      securityGroupRules,
    },
  });

  if (!ir.success) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        {
          stage: "normalize",
          severity: "error",
          message: `normalized IR failed validation: ${ir.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        },
      ],
    };
  }

  return { ok: true, value: ir.data, diagnostics };
}
