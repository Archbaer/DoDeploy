import { deriveNetwork } from "../ir/network.js";
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

const SECRET_KEY = /(PASS|SECRET|TOKEN|KEY|URL|CRED)/i;

/**
 * Compose allows string or list forms. A string command runs through a shell
 * (matching Compose string semantics); a string entrypoint is a single binary.
 * Explicitly empty lists are preserved — they clear the image default.
 */
const toArgv = (value: string | string[] | undefined, shellWrap: boolean): string[] | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return shellWrap ? ["sh", "-c", value] : [value];
};

export function normalizeCompose(compose: ComposeFile): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const compute: ComputeUnit[] = [];
  const datastores: ProjectIR["datastores"] = [];
  const sharedBy = new Map<string, string[]>();

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (service.profiles.length > 0) {
      diagnostics.push({
        stage: "normalize",
        severity: "warning",
        message: `service "${serviceName}" has profiles [${service.profiles.join(", ")}] and is ignored; only default-profile services are deployed`,
      });
      continue;
    }

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
    if (service.healthcheck?.interval !== undefined && intervalSeconds === undefined) {
      diagnostics.push({
        stage: "normalize",
        severity: "warning",
        message: `service "${serviceName}": cannot parse healthcheck interval "${service.healthcheck.interval}"; using default 30s`,
      });
    }
    if (service.healthcheck?.timeout !== undefined && timeoutSeconds === undefined) {
      diagnostics.push({
        stage: "normalize",
        severity: "warning",
        message: `service "${serviceName}": cannot parse healthcheck timeout "${service.healthcheck.timeout}"; using default 5s`,
      });
    }
    const healthcheck =
      service.healthcheck === undefined || service.healthcheck.disable === true
        ? undefined
        : {
            command: Array.isArray(test) ? test : [test ?? ""],
            intervalSeconds: intervalSeconds ?? 30,
            timeoutSeconds: timeoutSeconds ?? 5,
            retries: service.healthcheck.retries ?? 3,
          };

    const buildContext =
      typeof service.build === "string" ? service.build : (service.build?.context ?? undefined);
    const command = toArgv(service.command, true);
    const entrypoint = toArgv(service.entrypoint, false);

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
      ...(command !== undefined ? { command } : {}),
      ...(entrypoint !== undefined ? { entrypoint } : {}),
      ...(healthcheck !== undefined ? { healthcheck } : {}),
      dependsOn: service.dependsOn ?? [],
    });

    for (const volume of service.volumes ?? []) {
      const source = typeof volume === "string" ? volume.split(":")[0] : volume.source;
      const type = typeof volume === "string" ? undefined : volume.type;
      if (
        source &&
        (type === "bind" || compose.volumes === undefined || !(source in compose.volumes))
      ) {
        diagnostics.push({
          stage: "normalize",
          severity: "warning",
          message: `service "${serviceName}": volume "${source}" is not a named Compose volume; bind mounts are not mapped to cloud storage`,
        });
      }
    }

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

  const ir = projectIRSchema.safeParse({
    meta: { name: compose.name ?? "app", source: "compose" },
    compute,
    datastores,
    storage,
    network: deriveNetwork(compute, datastores, storage),
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
