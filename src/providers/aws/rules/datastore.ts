import type { Rule } from "../../../rules/index.js";
import { findDatabaseHints } from "../../shared.js";

export const postgresRdsRule: Rule = {
  id: "aws.datastore.postgres-rds",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "postgres")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Amazon RDS for PostgreSQL${d.version ? ` ${d.version}` : ""}`,
        rationale:
          "Managed backups, patching and failover; running Postgres as a container in production means administering it yourself",
        costTier: "medium" as const,
      })),
};

export const mysqlRdsRule: Rule = {
  id: "aws.datastore.mysql-rds",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mysql")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Amazon RDS for MySQL/MariaDB`,
        rationale: "Managed relational database with automated backups and failover",
        costTier: "medium" as const,
      })),
};

export const redisElasticacheRule: Rule = {
  id: "aws.datastore.redis-elasticache",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "redis")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Cache "${d.name}": Amazon ElastiCache for Redis`,
        rationale: "Managed in-memory cache with replication and failover; no Redis administration",
        costTier: "medium" as const,
      })),
};

export const mongodbDocumentdbRule: Rule = {
  id: "aws.datastore.mongodb-documentdb",
  run: (ir) =>
    ir.datastores
      .filter((d) => d.engine === "mongodb")
      .map((d) => ({
        severity: "suggestion" as const,
        message: `Database "${d.name}": Amazon DocumentDB (Mongo-compatible)`,
        rationale:
          "Managed document database with MongoDB API compatibility — verify your driver/features are supported before migrating",
        costTier: "medium" as const,
      })),
};

export const missingDatabaseRule: Rule = {
  id: "aws.gap.missing-database",
  run: (ir) => {
    if (ir.datastores.length > 0) return [];
    const hints = findDatabaseHints(ir);
    if (hints.length === 0) return [];
    return [
      {
        severity: "warning" as const,
        message:
          "No database service found, but configuration references one — add a managed database (Amazon RDS) or confirm an external endpoint",
        rationale: `Detected database references (${[...new Set(hints)].join(", ")}); Docker Compose stacks that need a database should declare it`,
        costTier: "medium" as const,
      },
    ];
  },
};
