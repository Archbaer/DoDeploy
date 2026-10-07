/** Sanitize an arbitrary service/volume name into a valid Terraform resource label. */
export function tfName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return an error message when distinct names sanitize to the same Terraform
 * label (per-resource-type label namespaces make duplicates invalid HCL
 * output). Renderers surface this as an error diagnostic plus a TODO instead
 * of silently emitting duplicate resources.
 */
export function duplicateLabelError(names: string[], what = "service"): string | undefined {
  const seen = new Map<string, string>();
  for (const name of names) {
    const label = tfName(name);
    const existing = seen.get(label);
    if (existing !== undefined) {
      return `${what} names "${existing}" and "${name}" both sanitize to Terraform label "${label}" — rename one of them`;
    }
    seen.set(label, name);
  }
  return undefined;
}

/** Quote a string as an HCL string literal. */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a flat HCL block. Attribute values must be valid HCL expressions —
 * use `quote()` for plain strings.
 */
export function block(type: string, labels: string[], attrs: Record<string, string>): string {
  const header = [type, ...labels.map(quote)].join(" ");
  const body = Object.entries(attrs)
    .map(([key, value]) => `  ${key} = ${value}`)
    .join("\n");
  return `${header} {\n${body}\n}\n`;
}
