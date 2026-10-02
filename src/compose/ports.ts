import type { Diagnostic, Port } from "../ir/schema.js";
import type { ComposePort, ComposeService } from "./schema.js";

export type DiagnosticLike = Pick<Diagnostic, "stage" | "severity" | "message">;

export function memoryToMb(raw: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(K|M|G)B?$/i.exec(raw.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2]?.toUpperCase();
  if (unit === "G") return Math.round(value * 1024);
  if (unit === "M") return Math.round(value);
  return Math.max(1, Math.round(value / 1024));
}

export function durationToSeconds(raw: string): number | undefined {
  let total = 0;
  let matched = false;
  for (const match of raw.matchAll(/(\d+)\s*(ms|s|m|h)/g)) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2];
    total +=
      unit === "h" ? value * 3600 : unit === "m" ? value * 60 : unit === "s" ? value : value / 1000;
  }
  return matched ? Math.round(total) : undefined;
}

export function toPort(
  spec: ComposePort,
  serviceName: string,
  diagnostics: DiagnosticLike[],
): Port | undefined {
  if (typeof spec === "object" && "target" in spec) {
    const published = spec.published === undefined ? undefined : Number(spec.published);
    const validHost = published !== undefined && Number.isInteger(published);
    return {
      container: spec.target,
      ...(validHost ? { host: published } : {}),
      protocol: spec.protocol === "udp" ? "udp" : "tcp",
      public: validHost,
    };
  }

  const raw = String(spec);
  if (raw.includes("-")) {
    diagnostics.push({
      stage: "normalize",
      severity: "warning",
      message: `service "${serviceName}": port range "${raw}" is not supported and was skipped`,
    });
    return undefined;
  }

  const parts = raw.split(":").filter((p) => p !== "");
  const last = parts.at(-1) ?? "";
  const [containerRaw, protoRaw] = last.split("/");
  const container = Number(containerRaw);

  if (!Number.isInteger(container)) {
    diagnostics.push({
      stage: "normalize",
      severity: "warning",
      message: `service "${serviceName}": cannot parse port "${raw}" and skipped it`,
    });
    return undefined;
  }

  const hostRaw = parts.length > 1 ? parts.at(-2) : undefined;
  const host = hostRaw !== undefined ? Number(hostRaw) : undefined;
  const validHost = host !== undefined && Number.isInteger(host);
  return {
    container,
    ...(validHost ? { host } : {}),
    protocol: protoRaw === "udp" ? "udp" : "tcp",
    public: validHost,
  };
}

export function serviceEnv(service: ComposeService): Record<string, string> {
  const env = service.environment;
  if (env === undefined || env === null) return {};
  if (!Array.isArray(env)) {
    return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? ""]));
  }
  return Object.fromEntries(
    env.map((entry) => {
      const index = entry.indexOf("=");
      return index === -1 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );
}

export function datastoreEngine(image: string): { engine: string; version?: string } | undefined {
  const name = image.split("/").at(-1) ?? image;
  const [base, tag] = name.split(":");
  const engines: Record<string, string> = {
    postgres: "postgres",
    mysql: "mysql",
    mariadb: "mysql",
    redis: "redis",
    mongo: "mongodb",
    mongodb: "mongodb",
  };
  const engine = engines[base?.toLowerCase() ?? ""];
  if (!engine) return undefined;
  return { engine, ...(tag !== undefined ? { version: tag } : {}) };
}

export function namedVolumeRefs(service: ComposeService): string[] {
  const refs: string[] = [];
  for (const volume of service.volumes) {
    if (typeof volume === "string") {
      const source = volume.split(":")[0];
      if (source) refs.push(source);
    } else if (volume.type === "volume" && volume.source) {
      refs.push(volume.source);
    }
  }
  return refs;
}
