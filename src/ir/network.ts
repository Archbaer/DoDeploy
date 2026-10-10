import type { Datastore, NetworkIR, ProjectIR } from "./schema.js";

const ENGINE_PORTS: Record<Datastore["engine"], number | undefined> = {
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
  other: undefined,
};

export function deriveNetwork(
  compute: ProjectIR["compute"],
  datastores: ProjectIR["datastores"],
  storage: ProjectIR["storage"],
): NetworkIR {
  const securityGroupRules: NetworkIR["securityGroupRules"] = [];
  for (const unit of compute) {
    for (const dep of unit.dependsOn) {
      const datastore = datastores.find((item) => item.name === dep);
      const port = datastore
        ? ENGINE_PORTS[datastore.engine]
        : compute.find((item) => item.name === dep)?.ports[0]?.container;
      if (port !== undefined) securityGroupRules.push({ from: unit.name, to: dep, port });
    }
  }
  const publicIngress = compute.some((unit) => unit.ports.some((port) => port.public));
  return {
    vpcCidr: "10.0.0.0/16",
    availabilityZones: 2,
    publicIngress,
    loadBalancer: publicIngress ? "application" : "none",
    serviceDiscovery: compute.some((unit) => unit.dependsOn.length > 0) || storage.length > 0,
    securityGroupRules,
  };
}
