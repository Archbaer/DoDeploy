/** Sanitize an arbitrary service/volume name into a valid Terraform resource label. */
export function tfName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
