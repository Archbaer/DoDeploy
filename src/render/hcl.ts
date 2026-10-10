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
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$\{/g, "$$${")
    .replace(/%\{/g, "%%{")}"`;
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

/**
 * Align adjacent single-line attributes emitted by our templates. Multiline
 * expressions start their own group; heredoc contents are kept byte-for-byte.
 * This is deliberately limited to generated templates, not an HCL parser.
 */
export function alignAttributes(source: string): string {
  const lines = source.split("\n");
  let group: { index: number; indent: string; key: string; value: string }[] = [];
  let heredoc: string | undefined;
  const flush = () => {
    const width = Math.max(0, ...group.map(({ key }) => key.length));
    for (const { index, indent, key, value } of group) {
      lines[index] = `${indent}${key.padEnd(width)} = ${value}`;
    }
    group = [];
  };
  for (const [index, line] of lines.entries()) {
    if (heredoc !== undefined) {
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    const match = /^( *)([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      flush();
      continue;
    }
    const [, indent = "", key = "", value = ""] = match;
    const delimiter = /^<<-?(\w+)$/.exec(value)?.[1];
    if (/[[{]$/.test(value)) {
      flush();
      lines[index] = `${indent}${key} = ${value}`;
      continue;
    }
    if (group[0]?.indent !== indent) flush();
    group.push({ index, indent, key, value });
    heredoc = delimiter;
  }
  flush();
  return lines.join("\n");
}

export function alignFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([name, source]) => [name, alignAttributes(source)]),
  );
}
