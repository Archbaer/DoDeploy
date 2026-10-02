## Summary

Phase 3: the cost-aware rules engine and the AWS rule pack. Rules are pure functions over the cloud-agnostic IR; the engine executes each in isolation (a throwing or malformed rule becomes a diagnostic, never a crash), validates every output against the Zod recommendation schema, and produces an `EnrichedIR`.

## Changes

- `src/rules/` — `Rule` type (pure `(ir) => recommendations[]`, engine stamps `ruleId`), `applyRules` engine with per-rule isolation + output validation
- `src/providers/types.ts` — `CloudProvider` interface (id + rulePack); core imports only this
- `src/providers/aws/rules/` — 13 rules across compute (Fargate+ALB web, Fargate worker, EC2 warning for stateful), datastores (RDS Postgres/MySQL, ElastiCache, DocumentDB with compatibility caveat), gap detection (`aws.gap.missing-database` — flags undeclared databases referenced by env/secret URLs), storage (EFS, S3+CloudFront), network/service discovery (Cloud Map), secrets (Secrets Manager), build (ECR) — every rule carries `rationale` + `costTier`
- `src/providers/registry.ts` — provider registry (`Partial` until GCP/Azure land in Phase 4)
- 14 new tests: engine isolation (poisoned rule, malformed output), golden-IR AWS expectations, namespacing

## Testing

- TDD: failing tests first (lefhhook blocks the purely-red commit — noted before), 74/74 green
- Coverage 96% stmts / 85% branches; full gate chain green

## Checklist

- [x] Tests added/updated
- [x] No breaking changes (additive modules)

## Notes for reviewers

- The "no DB in compose" scenario from your original vision is `aws.gap.missing-database`: it scans env values for `postgres://…`-style URLs and secret keys like `DATABASE_URL`, and warns with an RDS suggestion — this pattern will extend to GCP/Azure packs in Phase 4.
