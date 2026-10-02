import { awsRulePack } from "./aws/index.js";
import type { CloudProvider } from "./types.js";

export const providers: Partial<Record<CloudProvider["id"], CloudProvider>> = {
  aws: awsRulePack,
};
