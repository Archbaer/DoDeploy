import type { Rule } from "../../rules/index.js";
import type { CloudProvider } from "../types.js";
import { statefulGceRule, webCloudRunRule, workerCloudRunRule } from "./rules/compute.js";
import {
  missingDatabaseRule,
  mongodbNoNativeRule,
  mysqlCloudSqlRule,
  postgresCloudSqlRule,
  redisMemorystoreRule,
} from "./rules/datastore.js";
import {
  artifactRegistryRule,
  secretManagerRule,
  serviceDiscoveryDnsRule,
  sharedFilestoreRule,
  staticGcsRule,
} from "./rules/services.js";

export const gcpRules: Rule[] = [
  webCloudRunRule,
  workerCloudRunRule,
  statefulGceRule,
  postgresCloudSqlRule,
  mysqlCloudSqlRule,
  redisMemorystoreRule,
  mongodbNoNativeRule,
  missingDatabaseRule,
  sharedFilestoreRule,
  staticGcsRule,
  serviceDiscoveryDnsRule,
  secretManagerRule,
  artifactRegistryRule,
];

import { renderGcp } from "./render.js";

export const gcpRulePack: CloudProvider = {
  id: "gcp",
  rules: gcpRules,
  render: renderGcp,
};
