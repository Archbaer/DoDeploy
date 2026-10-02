# DoDeploy

Turn a `docker-compose.yaml` (or a guided interview) into deployable
[Terraform](https://www.terraform.io/) for **AWS, GCP and Azure** — through a
cloud-agnostic, Zod-validated intermediate representation. Never a 1:1 YAML → cloud
mapping: a rules engine makes cost-aware service recommendations and an interactive
interview fills the gaps.

```
docker-compose.yaml ──► PARSE ──► IR (Zod) ──► RULES ──► INTERVIEW ──► Terraform HCL
```

> Status: functional end-to-end (Phases 0–7). `generate` produces validated Terraform
> (`terraform validate` runs in CI for all three providers); stateful/VM services and
> costly abstractions (Filestore, Cosmos DB) are rendered as explicit `TODO(dodeploy)`
> blocks instead of being faked.

## Quickstart

```bash
npm install && npm run build
npx dodeploy doctor docker-compose.yaml        # check your environment
npx dodeploy analyze docker-compose.yaml --provider aws
npx dodeploy generate docker-compose.yaml --provider aws
cd dodeploy-infra && terraform init && terraform plan
```

`generate` writes `providers.tf`, `variables.tf`, `network.tf`, `compute.tf`,
`data.tf` and `outputs.tf` to `--out <dir>` (default `dodeploy-infra/`). What it
maps, per provider:

| Compose | AWS | GCP | Azure |
|---|---|---|---|
| web/worker services | ECS Fargate + ALB | Cloud Run | Container Apps |
| postgres / mysql | RDS | Cloud SQL | PostgreSQL Flexible Server |
| redis | ElastiCache | Memorystore | Azure Cache for Redis |
| volumes | EFS | *(deferred: TODO block)* | Files (Storage Share) |
| static assets / uploads | S3 + private ACL | GCS | Storage Containers |

No compose file? Drop the path and `generate` runs an interactive interview
(`@clack/prompts`) to fill everything in:

```bash
npx dodeploy generate --provider gcp
```

CI-friendly non-interactive runs:

```bash
npx dodeploy generate docker-compose.yaml --provider aws --no-interview
```

Every recommendation carries a `ruleId`, `rationale` and `costTier` — inspect them
with `analyze` before generating.

## Usage

```bash
npm install
npm run dev -- --help        # run from source
npm run build && npm start   # build + run bundled CLI
```

```text
dodeploy                     banner + help
dodeploy analyze [path]      parse a compose file, report findings + recommendations
dodeploy generate [path]     compose (or interview) → Terraform fileset on disk
dodeploy doctor [path]       check terraform, runtime and compose file health
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
- CI: `npm ci`, biome, typecheck, tests (incl. `terraform fmt/init/validate` on
  generated HCL for all three providers), build, `audit-ci` (high+),
  [OSV-Scanner](https://google.github.io/osv-scanner/), Dependabot

## License

MIT
