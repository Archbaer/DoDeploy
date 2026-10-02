import { z } from "zod";

const PORT = z.number().int().min(1).max(65535);

const IPV4_CIDR =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;

export const metaSchema = z.object({
  name: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
  source: z.enum(["compose", "interview", "mixed"]).default("compose"),
  provider: z.enum(["aws", "gcp", "azure"]).default("aws"),
});

export const portSchema = z.object({
  container: PORT,
  host: PORT.optional(),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
  public: z.boolean().default(false),
});

export const healthcheckSchema = z.object({
  command: z.array(z.string()).min(1),
  intervalSeconds: z.number().positive().default(30),
  timeoutSeconds: z.number().positive().default(5),
  retries: z.number().int().min(1).default(3),
});

export const computeUnitSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["compose", "interview"]),
  kind: z.enum(["web", "worker", "cron", "stateful"]),
  image: z.string().min(1).optional(),
  buildContext: z.string().min(1).optional(),
  ports: z.array(portSchema).default([]),
  cpu: z.number().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).default({}),
  secrets: z.array(z.string()).default([]),
  healthcheck: healthcheckSchema.optional(),
  dependsOn: z.array(z.string()).default([]),
});

export const datastoreSchema = z.object({
  name: z.string().min(1),
  engine: z.enum(["postgres", "mysql", "redis", "mongodb", "other"]),
  version: z.string().optional(),
  detected: z.boolean(),
});

export const storageNodeSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["shared-volume", "local-volume", "static-assets", "uploads"]),
  source: z.enum(["compose", "interview"]),
  sharedBy: z.array(z.string()).default([]),
  sizeGb: z.number().int().positive().optional(),
});

export const securityGroupRuleSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  port: PORT,
});

export const networkIRSchema = z.object({
  vpcCidr: z
    .string()
    .regex(IPV4_CIDR, "must be a valid IPv4 CIDR, e.g. 10.0.0.0/16")
    .default("10.0.0.0/16"),
  availabilityZones: z.number().int().min(1).max(6).default(2),
  publicIngress: z.boolean().default(false),
  loadBalancer: z.enum(["application", "network", "none"]).default("none"),
  serviceDiscovery: z.boolean().default(false),
  securityGroupRules: z.array(securityGroupRuleSchema).default([]),
});

export const recommendationSchema = z.object({
  ruleId: z.string().min(1),
  severity: z.enum(["info", "suggestion", "warning"]),
  message: z.string().min(1),
  rationale: z.string().min(1),
  costTier: z.enum(["free", "low", "medium", "high"]).optional(),
  accepted: z.boolean().optional(),
});

export const projectIRSchema = z.object({
  meta: metaSchema,
  compute: z.array(computeUnitSchema).default([]),
  datastores: z.array(datastoreSchema).default([]),
  storage: z.array(storageNodeSchema).default([]),
  network: networkIRSchema.prefault({}),
});

export const enrichedIRSchema = projectIRSchema.extend({
  recommendations: z.array(recommendationSchema).default([]),
});

export const diagnosticSchema = z.object({
  stage: z.enum(["parse", "normalize", "rules", "interview", "render"]),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  ruleId: z.string().optional(),
});

export type Meta = z.infer<typeof metaSchema>;
export type Port = z.infer<typeof portSchema>;
export type Healthcheck = z.infer<typeof healthcheckSchema>;
export type ComputeUnit = z.infer<typeof computeUnitSchema>;
export type Datastore = z.infer<typeof datastoreSchema>;
export type StorageNode = z.infer<typeof storageNodeSchema>;
export type SecurityGroupRule = z.infer<typeof securityGroupRuleSchema>;
export type NetworkIR = z.infer<typeof networkIRSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type ProjectIR = z.infer<typeof projectIRSchema>;
export type EnrichedIR = z.infer<typeof enrichedIRSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type DiagnosticStage = Diagnostic["stage"];
export type DiagnosticSeverity = Diagnostic["severity"];
export type CostTier = NonNullable<Recommendation["costTier"]>;
