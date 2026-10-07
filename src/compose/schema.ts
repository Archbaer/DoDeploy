import { z } from "zod";

const shortPort = z.union([z.string(), z.number()]);

export const composePortSchema = z.union([
  shortPort,
  z.object({
    target: z.number().int().min(1).max(65535),
    published: z.union([z.string(), z.number()]).optional(),
    protocol: z.string().optional(),
    host_ip: z.string().optional(),
  }),
]);

export const composeEnvironmentSchema = z
  .union([
    z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    z.array(z.string()),
  ])
  .transform((env) => {
    if (!Array.isArray(env)) {
      return Object.fromEntries(
        Object.entries(env).map(([key, value]) => [
          key,
          value === null ? "" : typeof value === "string" ? value : String(value),
        ]),
      );
    }
    return Object.fromEntries(
      env.map((entry) => {
        const index = entry.indexOf("=");
        return index === -1 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
      }),
    );
  });

export const composeServiceSchema = z
  .object({
    image: z.string().min(1).optional(),
    build: z
      .union([
        z.string(),
        // Standard build options are accepted; unrecognized keys are stripped, not rejected.
        z.object({
          context: z.string().optional(),
          dockerfile: z.string().optional(),
          target: z.string().optional(),
          args: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
        }),
      ])
      .optional(),
    ports: z.array(composePortSchema).default([]),
    environment: composeEnvironmentSchema.default({}),
    volumes: z
      .array(
        z.union([
          z.string(),
          z.object({
            type: z.string().optional(),
            source: z.string().optional(),
            target: z.string().min(1),
          }),
        ]),
      )
      .default([]),
    depends_on: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).default([]),
    networks: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).default([]),
    healthcheck: z
      .object({
        test: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
        interval: z.string().optional(),
        timeout: z.string().optional(),
        retries: z.number().int().min(1).optional(),
        disable: z.boolean().optional(),
      })
      .optional(),
    restart: z.string().optional(),
    profiles: z.array(z.string()).default([]),
    deploy: z
      .object({
        resources: z
          .object({
            limits: z
              .object({
                cpus: z.union([z.string(), z.number()]).optional(),
                memory: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine((s) => s.image !== undefined || s.build !== undefined, {
    message: "service must define either image or build",
  })
  .transform((s) => ({
    ...s,
    dependsOn: Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on),
    // Map form (aliases etc.) keeps only the network names; attachment details are deferred.
    networks: Array.isArray(s.networks) ? s.networks : Object.keys(s.networks),
  }));

export const composeFileSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  services: z.record(z.string(), composeServiceSchema).refine((s) => Object.keys(s).length > 0, {
    message: "compose file must define at least one service",
  }),
  volumes: z.record(z.string(), z.unknown()).optional(),
  networks: z.record(z.string(), z.unknown()).optional(),
});

export type ComposeFile = z.infer<typeof composeFileSchema>;
export type ComposeService = ComposeFile["services"][string];
export type ComposePort = ComposeService["ports"][number];
