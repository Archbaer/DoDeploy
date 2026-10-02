import type { ProjectIR } from "../ir/index.js";

const CONNECTION_URL = /(postgres(ql)?|mysql|maria|redis|mongo):\/\//i;
const DB_SECRET_KEY = /(DATABASE_URL|DB_|POSTGRES|MYSQL|REDIS|MONGO)/i;

/**
 * Shared gap-detection: finds references to a database in env/secret values
 * when no datastore service is declared in the IR.
 */
export function findDatabaseHints(ir: ProjectIR): string[] {
  return ir.compute.flatMap((c) => [
    ...c.secrets.filter((s) => DB_SECRET_KEY.test(s)),
    ...Object.values(c.env).filter((v) => CONNECTION_URL.test(v)),
  ]);
}
