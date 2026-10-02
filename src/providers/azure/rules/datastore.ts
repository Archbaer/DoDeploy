import type { Rule } from "../../../rules/index.js";
import { findDatabaseHints } from "../../shared.js";

export const postgresFlexibleRule: Rule = {
  id: "azure.datastore.postgres-flexible",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "postgres")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Azure Database for PostgreSQL — Flexible Server${d.version ? ` ${d.version}` : ""}`,
        rationale: "Managed backups, patching and HA; no self-administered Postgres",
        costTier: "medium" as const,
      })),
};

export const mysqlFlexibleRule: Rule = {
  id: "azure.datastore.mysql-flexible",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mysql")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Azure Database for MySQL — Flexible Server`,
        rationale: "Managed relational database with automated backups",
        costTier: "medium" as const,
      })),
};

export const redisCacheRule: Rule = {
  id: "azure.datastore.redis-cache",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "redis")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Cache "${d.name}": Azure Cache for Redis`,
        rationale: "Managed in-memory cache with clustering and failover",
        costTier: "medium" as const,
      })),
};

export const mongodbCosmosRule: Rule = {
  id: "azure.datastore.mongodb-cosmos",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mongodb")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Azure Cosmos DB (MongoDB API)`,
        rationale:
          "Managed document database with MongoDB API compatibility — verify your driver/features are supported before migrating",
        costTier: "medium" as const,
      })),
};

export const missingDatabaseRule: Rule = {
  id: "azure.gap.missing-database",
  run: (ir) => {
    if (ir.datastores.length > 0) return [];
    const hints = findDatabaseHints(ir);
    if (hints.length === 0) return [];
    return [
      {
        severity: "warning" as const,
        message:
          "No database service found, but configuration references one — add a managed database (Azure Database for PostgreSQL/MySQL — Flexible Server) or confirm an external endpoint",
        rationale: `Detected database references (${[...new Set(hints)].join(", ")}); Docker Compose stacks that need a database should declare it`,
        costTier: "medium" as const,
      },
    ];
  },
};
