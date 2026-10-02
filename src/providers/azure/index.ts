import type { Rule } from "../../rules/index.js";
import type { CloudProvider } from "../types.js";
import {
  statefulVmssRule,
  webContainerAppsRule,
  workerContainerAppsRule,
} from "./rules/compute.js";
import {
  missingDatabaseRule,
  mongodbCosmosRule,
  mysqlFlexibleRule,
  postgresFlexibleRule,
  redisCacheRule,
} from "./rules/datastore.js";
import {
  acrRule,
  keyVaultRule,
  serviceDiscoveryPrivateDnsRule,
  sharedFilesRule,
  staticBlobRule,
} from "./rules/services.js";

export const azureRules: Rule[] = [
  webContainerAppsRule,
  workerContainerAppsRule,
  statefulVmssRule,
  postgresFlexibleRule,
  mysqlFlexibleRule,
  redisCacheRule,
  mongodbCosmosRule,
  missingDatabaseRule,
  sharedFilesRule,
  staticBlobRule,
  serviceDiscoveryPrivateDnsRule,
  keyVaultRule,
  acrRule,
];

import { renderAzure } from "./render.js";

export const azureRulePack: CloudProvider = {
  id: "azure",
  rules: azureRules,
  render: renderAzure,
};
