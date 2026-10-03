# Budget-Aware Interview + AWS Cheap Compute Targets — Design

Date: 2026-10-03
Branch: `feat/budget-aware-interview`

## Problem

`dodeploy generate` interview has few questions and one AWS container target:
ECS Fargate + ALB. Users following the happy path get an expensive fileset with
no warning and no cheaper alternative. The interview also ignores compose
context — when a compose file is present it asks nothing about what was found.

## Goals

1. Interview asks a **budget priority** question that steers all defaults.
2. Compute target is chosen **per service** from a menu with cost-tier hints
   (`$` / `$$` / `$$$` / `$$$$`).
3. AWS gains two new render targets: **EC2 box** (cheapest) and **App Runner**
   (balanced, web only).
4. Interview is **context-aware**: when a compose file is present, questions
   reference the actual services, ports, volumes and datastores found.
5. Tests simulate **real user journeys**, not just unit behaviour.

## Non-Goals

- GCP / Azure cheap compute paths (Cloud Run / Container Apps are already
  consumption-priced).
- EKS, self-hosted database rendering, App Runner workers.
- Real dollar price numbers — relative tiers only.

## Design

### 1. Budget priority

- `ir/schema.ts`: `metaSchema` gains
  `budget: z.enum(["cheapest", "balanced", "production"]).default("balanced")`.
- CLI: `--budget <level>` flag on `generate`; passed into
  `generateProject({ budget })`.
- Interview: asked right after provider (skipped if `--budget` given).
  `cheapest` → EC2 defaults, `balanced` → App Runner for web / Fargate for
  workers, `production` → Fargate.

### 2. Per-service compute target menu (AWS)

- `ir/schema.ts`: `computeUnitSchema` gains
  `target: z.enum(["fargate", "apprunner", "ec2"]).optional()`.
- Interview, per compute service (named from compose or interview):

  ```
  Service "web" — run on?
    ❯ EC2 box ($)        single VM running docker, cheapest, no HA
      App Runner ($$)    managed, web services only
      ECS Fargate ($$$)  managed + ALB, production-grade
  ```

- Filtering: App Runner only offered for `kind === "web"`. `stateful` keeps the
  existing forced-EC2 rule and is not asked.
- Non-AWS providers: question skipped; existing target implicit.
- Default per service derives from `meta.budget`; user may override.

### 3. AWS render paths

- `target: "ec2"` → new `ec2.tf`: one `t3.small`-class instance, security
  group with the public ports, user-data that installs docker and runs the
  service image(s). All ec2-targeted services share one box. Services with
  `buildContext` produce a deferred TODO (existing mechanism) since the box
  needs a pushed image.
- `target: "apprunner"` → new `apprunner.tf`: one
  `aws_apprunner_service` per web service; requires a pushed image → deferred
  TODO when only a build context exists.
- `target: "fargate"` / unset → existing render path unchanged.
- Mixed targets in one project are legal: one service on EC2, another on
  Fargate.

### 4. Context-aware questions (compose present + interview on)

- Public ports detected → ask "expose publicly via a load balancer? ($$$ ALB
  warning)".
- Named volumes detected → ask storage handling (EFS $$$ vs skip/defer).
- Datastores detected → confirm managed provisioning per engine, with an
  explicit warning that RDS is usually the biggest cost line. No self-host
  rendering.

### 5. Cost hints everywhere

- All interview `SelectOption.hint`s carry `$`-tier prefixes.
- Recommendation messages keep their `costTier`; the generate summary prints
  the tier next to each recommendation (already partially there via
  `analyze`).

## Testing

Pattern: `tests/` uses vitest + `ScriptedDriver`; terraform validation lives in
`tests/render/terraform-validate.test.ts`.

New tests, framed as user journeys:

1. **Interview-only, cheapest budget** — no compose file; answers: cheapest →
   one web service → ec2.tf written, no fargate resources.
2. **Interview-only, production budget** — Fargate path identical to today.
3. **Compose with web + worker + postgres + named volume, balanced** —
   context questions fire (LB, volume, datastore confirm); web → App Runner,
   worker → Fargate; apprunner.tf + fargate compute both present.
4. **Compose, cheapest, mixed targets** — web on EC2, worker on EC2 → single
   ec2.tf hosting both.
5. **Non-interactive `--budget cheapest --provider aws`** — no driver, ec2
   target defaults applied.
6. **App Runner + build context** → deferred TODO listed in CLI output.
7. Existing suites (cli, generate, render semantics, terraform validate) stay
   green; extend terraform-validate with an ec2 fixture if the harness allows.

## Files Touched (expected)

- `src/ir/schema.ts` — `budget`, `target` fields
- `src/cli.ts` — `--budget` flag
- `src/generate.ts` — pass budget through
- `src/interview/interview.ts` — budget question, per-service target menu,
  context-aware questions
- `src/providers/aws/render.ts` (+ maybe new `ec2.ts`, `apprunner.ts`) — new
  render paths
- `src/providers/aws/rules/compute.ts` — target-aware recommendation messages
  with cost tiers
- `tests/interview/`, `tests/generate.test.ts`, `tests/providers/`,
  `tests/render/` — journey tests

## Risks

- App Runner requires images in ECR; interview-only flows have no image →
  deferred TODO, documented in output.
- EC2 box is a single point of failure — interview hint must say "no HA".
- Keeping Fargate default for `production` budget preserves current behaviour
  for existing users.
