import { awsRulePack } from "./aws/index.js";
import { azureRulePack } from "./azure/index.js";
import { gcpRulePack } from "./gcp/index.js";
import type { CloudProvider } from "./types.js";

export const providers: Partial<Record<CloudProvider["id"], CloudProvider>> = {
  aws: awsRulePack,
  gcp: gcpRulePack,
  azure: azureRulePack,
};
