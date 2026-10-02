# DoDeploy

Turn a `docker-compose.yaml` (or a guided interview) into deployable
[Terraform](https://www.terraform.io/) for **AWS, GCP and Azure** — through a
cloud-agnostic, Zod-validated intermediate representation. Never a 1:1 YAML → cloud
mapping: a rules engine makes cost-aware service recommendations and an interactive
interview fills the gaps.

```
docker-compose.yaml ──► PARSE ──► IR (Zod) ──► RULES ──► INTERVIEW ──► Terraform HCL
```

> Status: early development (Phase 0 groundwork). `analyze` / `generate` are stubs.

## Usage

```bash
npm install
npm run dev -- --help        # run from source
npm run build && npm start   # build + run bundled CLI
```

```text
dodeploy                     banner + help
dodeploy analyze [path]      parse a compose file, report findings (Phase 2)
dodeploy generate            interview → render Terraform (Phase 6)
```

## Development

```bash
npm run dev            # tsx watch-style runs (tsx src/bin.ts …)
npm test               # vitest
npm run test:coverage  # vitest + v8 coverage (80% thresholds)
npm run lint           # biome check
npm run format         # biome format --write
npm run typecheck      # tsc --noEmit (strict)
npm run ci             # versions → lint → typecheck → coverage → build
```

Pre-commit hooks (lefthook) run biome + typecheck automatically.

## Quality & security

- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Biome lint + format, TDD (vitest, coverage thresholds)
- All dependencies **pinned to exact versions** (`.npmrc` `save-exact`,
  `scripts/check-exact-versions.mjs` enforced in CI) — see [DEPENDENCIES.md](./DEPENDENCIES.md)
- CI: `npm ci`, biome, typecheck, tests, build, `audit-ci` (high+),
  [OSV-Scanner](https://google.github.io/osv-scanner/), Dependabot

## License

MIT
