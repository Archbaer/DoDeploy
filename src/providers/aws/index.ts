import type { Rule } from "../../rules/index.js";
import type { CloudProvider } from "../types.js";
import {
  appRunnerRule,
  ec2BoxRule,
  statefulEc2Rule,
  webFargateRule,
  workerFargateRule,
} from "./rules/compute.js";
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
  ec2BoxRule,
  appRunnerRule,
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

import { renderAws } from "./render.js";

export const awsRulePack: CloudProvider = {
  id: "aws",
  rules: awsRules,
  render: renderAws,
};
