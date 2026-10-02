# Dependencies

Every dependency must be justified here before being added. Versions are pinned
exactly in `package.json` (enforced by `scripts/check-exact-versions.mjs` and CI),
and `package-lock.json` is committed — CI installs with `npm ci`.

## Runtime

| Package | Version | Why | Alternatives considered |
|---|---|---|---|
| `commander` | 15.0.0 | CLI commands, options, `--help` generation | `yargs` (heavier, mutable API), `cac` (less mature) |
| `chalk` | 6.0.1 | Terminal colors for UI/report output | ANSI codes by hand (chalk handles TTY detection/Windows) |
| `figlet` | 1.12.0 | ASCII-art banner | Hand-drawn strings (no per-title flexibility) |
| `gradient-string` | 3.0.0 | Gradient coloring for the banner | `ink` (whole React runtime, far too heavy for a CLI) |
| `zod` | 4.6.5 | Schema validation for the compose model, IR, and interview answers — single source of truth for every stage boundary | `ajv` (JSON-schema only, weaker DX), `valibot` (viable, but zod's ecosystem & inference maturity won) |

## Development

| Package | Version | Why |
|---|---|---|
| `typescript` | 7.0.2 | Language + typechecking (`tsc --noEmit` gate) |
| `tsup` | 8.5.1 | Bundles `src/bin.ts` → single ESM bin with shebang |
| `tsx` | 4.23.15 | Zero-config TS runner for dev (`npm run dev`) and test spawns |
| `vitest` / `@vitest/coverage-v8` | 5.0.3 | Test runner + v8 coverage with thresholds |
| `@biomejs/biome` | 2.5.15 | Lint + format in one fast tool (replaces eslint+prettier) |
| `lefthook` | 2.1.16 | Git hooks (biome + typecheck pre-commit) — Go binary, no runtime deps |
| `audit-ci` | 7.1.0 | `npm audit` wrapper that fails CI on high/critical vulns without noise |
| `@types/node`, `@types/figlet` | 26.6.4 / 1.7.0 | Type definitions (figlet ships none; gradient-string ships its own) |

## Policy

- No `^`/`~`/range specs — ever. `.npmrc` has `save-exact=true`.
- New runtime deps need a row in this table + passing `audit-ci` + OSV scan.
- Prefer the standard library when a package adds < ~20 lines of value.
- Vulnerability scanning: `audit-ci` (CI, high threshold) + OSV-Scanner
  (`google/osv-scanner-action`, every PR + weekly via Dependabot security updates).
