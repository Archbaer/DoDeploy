import type { Rule } from "../../../rules/index.js";
import { findDatabaseHints } from "../../shared.js";

export const postgresCloudSqlRule: Rule = {
  id: "gcp.datastore.postgres-cloudsql",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "postgres")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Cloud SQL for PostgreSQL${d.version ? ` ${d.version}` : ""}`,
        rationale: "Managed backups, patching and HA; no self-administered Postgres",
        costTier: "medium" as const,
      })),
};

export const mysqlCloudSqlRule: Rule = {
  id: "gcp.datastore.mysql-cloudsql",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mysql")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Cloud SQL for MySQL`,
        rationale: "Managed relational database with automated backups and failover",
        costTier: "medium" as const,
      })),
};

export const redisMemorystoreRule: Rule = {
  id: "gcp.datastore.redis-memorystore",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "redis")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Cache "${d.name}": Memorystore for Redis`,
        rationale: "Managed in-memory cache with replication; no Redis administration",
        costTier: "medium" as const,
      })),
};

export const mongodbNoNativeRule: Rule = {
  id: "gcp.datastore.mongodb-no-native",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mongodb")
      .map((d) => ({
        severity: "warning" as const,
        message: `Database "${d.name}": GCP has no native managed MongoDB — consider MongoDB Atlas on GCP or self-manage on GCE`,
        rationale:
          "Unlike AWS DocumentDB or Azure Cosmos DB, GCP offers no first-party Mongo-compatible service; Atlas (partner service) or a self-managed VM are the practical options",
        costTier: "medium" as const,
      })),
};

export const missingDatabaseRule: Rule = {
  id: "gcp.gap.missing-database",
  run: (ir) => {
    if (ir.datastores.length > 0) return [];
    const hints = findDatabaseHints(ir);
    if (hints.length === 0) return [];
    return [
      {
        severity: "warning" as const,
        message:
          "No database service found, but configuration references one — add a managed database (Cloud SQL) or confirm an external endpoint",
        rationale: `Detected database references (${[...new Set(hints)].join(", ")}); Docker Compose stacks that need a database should declare it`,
        costTier: "medium" as const,
      },
    ];
  },
};
