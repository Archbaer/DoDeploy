import type { Rule } from "../../rules/index.js";
import type { CloudProvider } from "../types.js";
import { statefulEc2Rule, webFargateRule, workerFargateRule } from "./rules/compute.js";
import {
  missingDatabaseRule,
  mongodbDocumentdbRule,
  mysqlRdsRule,
  postgresRdsRule,
  redisElasticacheRule,
} from "./rules/datastore.js";
import { ecrRule, secretsManagerRule, serviceDiscoveryCloudMapRule } from "./rules/network.js";
import { sharedVolumeEfsRule, staticS3Rule } from "./rules/storage.js";

export const awsRules: Rule[] = [
  webFargateRule,
  workerFargateRule,
  statefulEc2Rule,
  postgresRdsRule,
  mysqlRdsRule,
  redisElasticacheRule,
  mongodbDocumentdbRule,
  missingDatabaseRule,
  sharedVolumeEfsRule,
  staticS3Rule,
  serviceDiscoveryCloudMapRule,
  secretsManagerRule,
  ecrRule,
];

export const awsRulePack: CloudProvider = {
  id: "aws",
  rules: awsRules,
};
