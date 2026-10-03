# Budget-Aware Interview + AWS Cheap Compute Targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `dodeploy generate` a budget-aware interview with per-service compute targets (EC2 $ / App Runner $$ / Fargate $$$) and AWS renderers for the two new cheap targets.

**Architecture:** New IR fields (`meta.budget`, `compute[].target`) flow from CLI/interview through the existing generate pipeline; the AWS renderer partitions compute units by target and emits extra `ec2.tf` / `apprunner.tf` files alongside the unchanged Fargate path.

**Tech Stack:** TypeScript, zod, commander, @clack/prompts, vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-budget-aware-interview-design.md`

## Global Constraints

- TypeScript ESM (`"type": "module"`), imports use `.js` suffixes.
- Tests: vitest, run with `npx vitest run <file>`.
- Commit style: Conventional Commits, `test(...)` before `feat(...)` per task pair.
- zod v4 (`import { z } from "zod"`).
- Never commit to `main`; work stays on `feat/budget-aware-interview`.
- IR changes must keep `projectIRSchema.parse({ meta: { name, source } })` valid (defaults required).

## File Structure

- `src/ir/schema.ts` — add `budget` to `metaSchema`, `target` to `computeUnitSchema` (modified)
- `src/interview/interview.ts` — budget question, per-service target menu, context-aware questions (modified)
- `src/generate.ts` — `GenerateOptions.budget`, plumbed into IR + interview (modified)
- `src/cli.ts` — `--budget` flag (modified)
- `src/providers/aws/render.ts` — partition by target, filter Fargate sections, emit `ec2.tf` / `apprunner.tf` (modified)
- `src/providers/aws/rules/compute.ts` — target-aware rules with cost tiers (modified)
- `tests/ir/schema.test.ts`, `tests/interview/interview.test.ts`, `tests/generate.test.ts`, `tests/render/aws-render.test.ts`, `tests/providers/aws-rules.test.ts` (modified)

---

### Task 1: IR schema — `budget` and `target` fields

**Files:**
- Modify: `src/ir/schema.ts`
- Test: `tests/ir/schema.test.ts`

**Interfaces:**
- Produces: `metaSchema` gains `budget: "cheapest" | "balanced" | "production"` (default `"balanced"`); `computeUnitSchema` gains optional `target: "fargate" | "apprunner" | "ec2"`. Types `Budget` and `ComputeTarget` exported.

- [ ] **Step 1: Write the failing tests**

Read `tests/ir/schema.test.ts` first and match its style. Add:

```ts
it("defaults budget to balanced and omits target", () => {
  const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
  expect(ir.meta.budget).toBe("balanced");
  expect(ir.compute).toEqual([]);
});

it("accepts a compute target", () => {
  const ir = projectIRSchema.parse({
    meta: { name: "x", source: "compose", budget: "cheapest" },
    compute: [{ name: "web", source: "compose", kind: "web", target: "ec2" }],
  });
  expect(ir.meta.budget).toBe("cheapest");
  expect(ir.compute[0]?.target).toBe("ec2");
});

it("rejects an unknown target", () => {
  const result = projectIRSchema.safeParse({
    meta: { name: "x" },
    compute: [{ name: "web", source: "compose", kind: "web", target: "kubernetes" }],
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/schema.test.ts`
Expected: FAIL (budget/target unknown keys or wrong default).

- [ ] **Step 3: Implement**

In `src/ir/schema.ts`:

```ts
export const budgetSchema = z.enum(["cheapest", "balanced", "production"]);
export const computeTargetSchema = z.enum(["fargate", "apprunner", "ec2"]);
```

Add to `metaSchema`: `budget: budgetSchema.default("balanced"),`
Add to `computeUnitSchema`: `target: computeTargetSchema.optional(),`
Add exports at the bottom:

```ts
export type Budget = z.infer<typeof budgetSchema>;
export type ComputeTarget = z.infer<typeof computeTargetSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ir/schema.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/ir/schema.ts tests/ir/schema.test.ts
git commit -m "feat(ir): add meta.budget and compute target fields"
```

---

### Task 2: Interview — budget question

**Files:**
- Modify: `src/interview/interview.ts`
- Test: `tests/interview/interview.test.ts`

**Interfaces:**
- Consumes: `Budget` from Task 1.
- Produces: `runInterview(ir, driver, provider?, budget?)` — new optional 4th param. When `budget` is undefined the interview asks `"What matters most for this deployment?"` with values `cheapest | balanced | production`. Existing 3-arg callers keep working (budget question then fires; existing test queues must be updated — Task 6).

```ts
const BUDGET_OPTIONS = [
  { value: "cheapest" as const, label: "Lowest cost", hint: "$ — single VMs, no HA, dev/hobby" },
  { value: "balanced" as const, label: "Balanced", hint: "$$ — managed where cheap, simple where possible" },
  { value: "production" as const, label: "Production-grade", hint: "$$$ — managed services, load balancers, HA" },
];
```

- [ ] **Step 1: Write the failing test**

Add to `tests/interview/interview.test.ts`:

```ts
it("asks for budget and stores it in meta", async () => {
  const driver = new ScriptedDriver(["gcp", "cheapest", "europe-west1", "vms", "legacy", false, false]);
  const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
  const result = await runInterview(ir, driver);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.meta.budget).toBe("cheapest");
});

it("skips the budget question when a budget is passed in", async () => {
  const driver = new ScriptedDriver(["gcp", "europe-west1", "vms", "legacy", false, false]);
  const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
  const result = await runInterview(ir, driver, undefined, "production");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.meta.budget).toBe("production");
  expect(driver.exhausted()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/interview/interview.test.ts`
Expected: FAIL (ScriptedDriver queue mismatch — budget answer consumed as region).

- [ ] **Step 3: Implement**

In `runInterview`, after the provider block (before region):

```ts
if (budget !== undefined) {
  meta.budget = budget;
} else {
  meta.budget = await driver.select("What matters most for this deployment?", BUDGET_OPTIONS);
  changed = true;
}
```

Note: `changed = true` would flip compose-source IRs to "mixed" even when nothing else changed. Budget is a meta-only preference — do NOT set `changed` for it. Final code:

```ts
if (budget !== undefined) {
  meta.budget = budget;
} else {
  meta.budget = await driver.select("What matters most for this deployment?", BUDGET_OPTIONS);
}
```

Update the signature: `export async function runInterview(ir: ProjectIR, driver: InterviewDriver, provider?: ProjectIR["meta"]["provider"], budget?: Budget)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/interview/interview.test.ts`
Expected: new tests PASS; OLD tests FAIL on queue mismatch (expected — fixed in Task 6). Run only the two new tests with `-t "budget"`.

- [ ] **Step 5: Commit**

```bash
git add src/interview/interview.ts tests/interview/interview.test.ts
git commit -m "feat(interview): ask budget priority, skippable via argument"
```

---

### Task 3: Interview — per-service compute target menu (AWS)

**Files:**
- Modify: `src/interview/interview.ts`
- Test: `tests/interview/interview.test.ts`

**Interfaces:**
- Consumes: `ComputeTarget`, `Budget` (Task 1); runs after compute units exist.
- Produces: for `meta.provider === "aws"`, every non-`stateful` compute unit with `target === undefined` gets asked:
  - web: `ec2` / `apprunner` / `fargate`
  - worker/cron: `ec2` / `fargate`
  Default = first option, ordered by budget:
  - cheapest → `[ec2, ...]`
  - balanced → web: `[apprunner, ec2, fargate]`, worker: `[fargate, ec2]`
  - production → `[fargate, ...]`

Implementation sketch:

```ts
const TARGET_OPTIONS = {
  web: [
    { value: "ec2" as const, label: "EC2 box", hint: "$ — single VM running docker, cheapest, no HA" },
    { value: "apprunner" as const, label: "App Runner", hint: "$$ — managed, web services only, needs a pushed image" },
    { value: "fargate" as const, label: "ECS Fargate", hint: "$$$ — managed + ALB, production-grade" },
  ],
  worker: [
    { value: "ec2" as const, label: "EC2 box", hint: "$ — single VM running docker, cheapest, no HA" },
    { value: "fargate" as const, label: "ECS Fargate", hint: "$$$ — managed, no load balancer" },
  ],
};

const budgetOrder = (budget: Budget, options: typeof TARGET_OPTIONS.web) => {
  if (budget === "cheapest") return options; // ec2 first
  if (budget === "production") return [...options].sort((a) => (a.value === "fargate" ? -1 : 1));
  // balanced: web → apprunner first, worker → fargate first
  return [...options].sort((a) => (a.value === "apprunner" || a.value === "fargate" ? -1 : 1));
};
```

(Exact ordering code left to implementer; clack marks the first option as the default cursor position.)

- [ ] **Step 1: Write the failing test**

```ts
it("asks per-service compute target on AWS with cost hints", async () => {
  const driver = new ScriptedDriver([
    "aws", "cheapest", "us-east-1", "containers", "web, jobs", "web",
    "ec2",   // target for web
    "ec2",   // target for jobs
    false, false,
  ]);
  const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
  const result = await runInterview(ir, driver);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.compute.map((c) => c.target)).toEqual(["ec2", "ec2"]);
});

it("skips the target question for non-AWS providers", async () => {
  const driver = new ScriptedDriver(["gcp", "balanced", "europe-west1", "containers", "api", "web", false, false]);
  const ir = projectIRSchema.parse({ meta: { name: "x", source: "interview" } });
  const result = await runInterview(ir, driver);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.compute[0]?.target).toBeUndefined();
  expect(driver.exhausted()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/interview/interview.test.ts -t "target"`
Expected: FAIL (no target prompt consumed / target unset).

- [ ] **Step 3: Implement**

In `runInterview`, after the compute-creation block, add:

```ts
if (meta.provider === "aws") {
  for (const [index, unit] of compute.entries()) {
    if (unit.kind === "stateful" || unit.target !== undefined) continue;
    const pool = unit.kind === "web" ? TARGET_OPTIONS.web : TARGET_OPTIONS.worker;
    const target = await driver.select(
      `Service "${unit.name}" — run on?`,
      budgetOrder(meta.budget, pool),
    );
    compute[index] = { ...unit, target };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/interview/interview.test.ts -t "target"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interview/interview.ts tests/interview/interview.test.ts
git commit -m "feat(interview): per-service AWS compute target menu with cost hints"
```

---

### Task 4: Interview — context-aware questions (public exposure, datastores, volumes)

**Files:**
- Modify: `src/interview/interview.ts`
- Test: `tests/interview/interview.test.ts`

**Interfaces:**
- Consumes: finalized `compute`, `datastores`, `storage` arrays from earlier blocks.
- Produces:
  1. If any unit has `ports.some(p => p.public)`: `confirm("Public ports detected — expose via load balancer / public ingress? ($$$ on AWS: ALB)", true)`. Answer `false` → set `public: false` on all public ports.
  2. Per datastore: `confirm(`Provision managed service for ${d.engine} "${d.name}"? ($$$ — managed databases are usually the biggest cost line)`, true)`. Answer `false` → remove datastore, push info diagnostic `datastore "${d.name}" skipped by user; run it yourself and wire connection env vars manually`.
  3. If `storage.some(s => s.kind === "shared-volume" || s.kind === "local-volume")`: `confirm("Named volumes detected — keep them in the plan? (persistent storage renders as deferred EFS/$$$ items)", true)`. Answer `false` → drop those storage nodes, info diagnostic.

- [ ] **Step 1: Write the failing test**

```ts
it("drops public exposure when the user declines the load balancer", async () => {
  const driver = new ScriptedDriver([
    "balanced", "us-east-1",
    "fargate",        // target for web (aws default provider)
    false,            // no load balancer
    false,            // no new database needed? (datastores empty → confirm)
    false,            // no storage
  ]);
  const ir = projectIRSchema.parse({
    meta: { name: "shop", source: "compose" },
    compute: [{ name: "web", source: "compose", kind: "web", image: "nginx",
                ports: [{ container: 80, host: 80, public: true }] }],
  });
  const result = await runInterview(ir, driver);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.compute[0]?.ports[0]?.public).toBe(false);
});

it("drops a managed datastore the user declines", async () => {
  const driver = new ScriptedDriver([
    "balanced", "us-east-1",
    "fargate",        // target for web
    true,             // keep LB
    false,            // decline managed postgres
    false,            // no storage
  ]);
  const ir = projectIRSchema.parse({
    meta: { name: "shop", source: "compose" },
    compute: [{ name: "web", source: "compose", kind: "web", image: "nginx",
                ports: [{ container: 80, host: 80, public: true }] }],
    datastores: [{ name: "db", engine: "postgres", detected: true }],
  });
  const result = await runInterview(ir, driver);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.datastores).toEqual([]);
  expect(result.diagnostics.some((d) => d.message.includes("db"))).toBe(true);
});
```

(Exact queue order depends on implementation order in Step 3 — keep the implementation order: budget → region → targets → public-exposure → datastores → volumes → storage-creation. Adjust queues if the implementer orders differently, but keep that order.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/interview/interview.test.ts -t "managed"`
Expected: FAIL (queues misaligned; behaviour missing).

- [ ] **Step 3: Implement**

After the target block, before the datastore-creation block:

```ts
if (compute.some((u) => u.ports.some((p) => p.public))) {
  const keepPublic = await driver.confirm(
    "Public ports detected — expose via load balancer / public ingress? ($$$ on AWS: ALB)",
    true,
  );
  if (!keepPublic) {
    for (const [index, unit] of compute.entries()) {
      compute[index] = { ...unit, ports: unit.ports.map((p) => ({ ...p, public: false })) };
    }
    changed = true;
  }
}
```

Replace the datastore block with creation (unchanged) followed by per-datastore managed confirm (loop over final `datastores`, splice declined ones, push diagnostics). Add the volumes confirm after storage creation. All three set `changed = true` only when they mutate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/interview/interview.test.ts -t "managed"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interview/interview.ts tests/interview/interview.test.ts
git commit -m "feat(interview): context-aware questions for exposure, datastores, volumes"
```

---

### Task 5: Plumb `--budget` through CLI and generate

**Files:**
- Modify: `src/generate.ts`, `src/cli.ts`
- Test: `tests/generate.test.ts`

**Interfaces:**
- Consumes: `runInterview(ir, driver, provider, budget)` (Task 2).
- Produces: `GenerateOptions.budget?: Budget`; CLI `--budget <level>`.

- [ ] **Step 1: Write the failing test**

Add to `tests/generate.test.ts`:

```ts
it("passes --budget through so the interview skips the budget question", async () => {
  const out = mkdtempSync(join(tmpdir(), "dd-gen-budget-"));
  const driver = new ScriptedDriver([
    "us-east-1",      // region (provider+budget given)
    "containers", "api", "web",
    "fargate",        // target for api
    false, false,
  ]);
  const result = await generateProject({
    provider: "aws", budget: "production", outDir: out, interview: true, driver,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(driver.exhausted()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generate.test.ts -t "budget"`
Expected: FAIL (TS error: `budget` not in `GenerateOptions`).

- [ ] **Step 3: Implement**

`src/generate.ts`: add `budget?: Budget | undefined;` to `GenerateOptions`; when set, merge into `ir.meta` alongside the provider merge (`ir = { ...ir, meta: { ...ir.meta, budget: options.budget } }`); pass as 4th arg to `runInterview`.

`src/cli.ts`: add `.option("--budget <level>", "budget priority (cheapest|balanced|production)")` to `generateCommand`; validate like provider (`cheapest|balanced|production`, error + exit 1 otherwise); pass `budget: options.budget` into `generateProject`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generate.test.ts -t "budget"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generate.ts src/cli.ts tests/generate.test.ts
git commit -m "feat(cli,generate): --budget flag plumbed into interview"
```

---

### Task 6: Repair existing scripted-driver queues

**Files:**
- Modify: `tests/interview/interview.test.ts`, `tests/generate.test.ts`, possibly `tests/cli.test.ts`

**Interfaces:**
- Consumes: final interview question order from Tasks 2–4: provider → budget → region → workload/names/kind (interview-source only) → per-service targets (AWS only) → public-exposure (if public ports) → datastore creation (if empty) → per-datastore managed confirm → volumes (if named volumes) → storage creation (if empty).

- [ ] **Step 1: Run the full suite and list every failure**

Run: `npx vitest run tests/interview tests/generate.test.ts tests/cli.test.ts`
Expected: queue-mismatch failures in the pre-existing tests.

- [ ] **Step 2: Fix each queue**

Insert new answers at the right positions. Examples:
- `interview-only path` in `tests/generate.test.ts`: after `"us-east-1"` insert nothing (provider asked first — queue starts `"aws"`, then budget answer, e.g. `"balanced"`), then existing answers, then `"fargate"` per service (`api`, `worker` → 2 answers), then managed-postgres confirm `true`.
- Provider-preservation test (`gcp`/`azure`): budget answer after region? No — budget question comes before region and provider is skipped via mock: queue becomes `[budget, region, "containers", ...]` — GCP/Azure skip target questions.
- Compose-origin tests in `tests/interview/interview.test.ts`: add budget answer at the head (after provider if source is interview), target answers for each non-stateful AWS unit, `true` for keep-public (ports public), etc.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS (whole suite green before moving on).

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(interview,generate): align scripted queues with new questions"
```

---

### Task 7: AWS render — partition by target + EC2 box (`ec2.tf`)

**Files:**
- Modify: `src/providers/aws/render.ts`
- Test: `tests/render/aws-render.test.ts`

**Interfaces:**
- Consumes: `compute[].target` (Task 1).
- Produces:
  - Partition helpers used by all later tasks:
    ```ts
    const fargateUnits = (ir: EnrichedIR) =>
      ir.compute.filter((u) => u.kind !== "stateful" && (u.target === undefined || u.target === "fargate"));
    const ec2Units = (ir: EnrichedIR) => ir.compute.filter((u) => u.target === "ec2");
    const apprunnerUnits = (ir: EnrichedIR) => ir.compute.filter((u) => u.target === "apprunner");
    ```
  - `publicRoutes(ir)` only considers `fargateUnits`.
  - `ecsClusterSection`, `taskDefSection`, `ecsServiceSection` operate on `fargateUnits` and return `""` when empty.
  - New file key `"ec2.tf"` emitted only when `ec2Units(ir).length > 0`.

EC2 box rendering (single instance, public subnet, docker user-data):

```ts
const ec2BoxSection = (ir: EnrichedIR): string => {
  const units = ec2Units(ir);
  if (units.length === 0) return "";
  const ingress = units
    .flatMap((u) => u.ports.filter((p) => p.public))
    .map((p) => `  ingress {
    from_port = ${p.host ?? p.container}
    to_port = ${p.host ?? p.container}
    protocol = ${quote(p.protocol)}
    cidr_blocks = ["0.0.0.0/0"]
  }`)
    .join("\n");
  const runs = units
    .map((u) => {
      const ports = u.ports.map((p) => `-p ${p.host ?? p.container}:${p.container}`).join(" ");
      const env = Object.entries(u.env).map(([k, v]) => `-e ${k}=${v}`).join(" ");
      return `docker run -d --restart unless-stopped --name ${u.name} ${ports} ${env} ${u.image ?? `\${var.${tfName(u.name)}_image}`}`;
    })
    .join("\n");
  return `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_security_group" "ec2_box" {
  name   = "${tfName(ir.meta.name)}-box"
  vpc_id = aws_vpc.main.id
${ingress}
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "box" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.small"
  subnet_id                   = aws_subnet.public_a.id
  vpc_security_group_ids      = [aws_security_group.ec2_box.id]
  associate_public_ip_address = true
  user_data                   = <<-EOF
#!/bin/bash
dnf install -y docker
systemctl enable --now docker
${runs}
EOF
  tags = { Project = var.project_name }
}`;
};
```

Also: add `output "box_public_ip"` to `outputsTf` when ec2 units exist; add a `severity: "info"` diagnostic when ec2 units exist: `ec2 box is a single point of failure (no HA) — cheapest option`.

Do NOT touch: NAT/private subnets (still rendered; a separate `severity: "info"` diagnostic when ec2 units exist AND fargateUnits is empty: `private subnets + NAT gateway (~$$/mo) are unused by EC2-only computes — remove network pieces manually if unneeded`).

- [ ] **Step 1: Write the failing test**

In `tests/render/aws-render.test.ts` (match its existing fixture style — read it first):

```ts
it("renders ec2-targeted services as a single EC2 box and no ECS resources", () => {
  const ir = enriched({
    compute: [
      { name: "web", source: "compose", kind: "web", image: "nginx", target: "ec2",
        ports: [{ container: 80, host: 80, public: true }] },
      { name: "jobs", source: "compose", kind: "worker", image: "worker:v1", target: "ec2" },
    ],
  });
  const result = renderAws(ir);
  expect(result.files["ec2.tf"]).toContain('resource "aws_instance" "box"');
  expect(result.files["ec2.tf"]).toContain("docker run -d");
  expect(result.files["compute.tf"]).not.toContain("aws_ecs_cluster");
  expect(result.files["compute.tf"]).not.toContain("aws_ecs_task_definition");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/aws-render.test.ts -t "EC2 box"`
Expected: FAIL (`ec2.tf` undefined; compute.tf still has ECS).

- [ ] **Step 3: Implement**

Apply the partition helpers + filters + `ec2BoxSection` + conditional `"ec2.tf"` key + outputs/diagnostics as specced above. `renderSections` already drops empty strings, so returning `""` from ECS sections when `fargateUnits` is empty is sufficient.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/render`
Expected: PASS including all pre-existing render tests (their units have no `target` → Fargate path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/providers/aws/render.ts tests/render/aws-render.test.ts
git commit -m "feat(providers/aws): render ec2-target services as a single EC2 box"
```

---

### Task 8: AWS render — App Runner (`apprunner.tf`)

**Files:**
- Modify: `src/providers/aws/render.ts`
- Test: `tests/render/aws-render.test.ts`

**Interfaces:**
- Consumes: `apprunnerUnits` (Task 7), `unitImage`, `tfName`, `quote`.
- Produces: `"apprunner.tf"` key emitted only when `apprunnerUnits(ir).length > 0`; one ECR-access IAM role + one `aws_apprunner_service` per unit; `output "apprunner_<name>_url"` in `outputs.tf`.

```ts
const apprunnerSection = (ir: EnrichedIR): string => {
  const units = apprunnerUnits(ir);
  if (units.length === 0) return "";
  const services = units
    .map((u) => {
      const label = tfName(u.name);
      const port = u.ports[0]?.container ?? 8080;
      return `resource "aws_apprunner_service" "${label}" {
  service_name = ${quote(`${tfName(ir.meta.name)}-${label}`)}
  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr.arn
    }
    image_repository {
      image_identifier      = ${unitImage(u)}
      image_repository_type = "ECR"
      image_configuration {
        port = "${port}"
      }
    }
  }
}`;
    })
    .join("\n\n");
  return `data "aws_partition" "current" {} # reuse from compute.tf partition data source if both files present — terraform allows duplicate data source names only once per config; define here only when no fargate units exist

resource "aws_iam_role" "apprunner_ecr" {
  name_prefix = "dodeploy-apprunner-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_ecr.name
  policy_arn = "arn:\${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

${services}`;
};
```

Important collision: `data "aws_partition" "current"` already exists in `compute.tf` (`ecsClusterSection`). Terraform forbids duplicate data-source names across files in one config. Rule: `ecsClusterSection` emits the partition data source only when fargate units exist; `apprunnerSection` emits it only when fargate units do NOT exist. Move the partition data source into its own helper called from both, gated by `(fargateUnits(ir).length === 0)` in the apprunner file.

Units with `buildContext` and no `image`: `unitImage` already emits the `var.<name>_image` reference with the TODO comment — reuse it; the existing deferred-TODO collection in `generate.ts` picks it up automatically.

- [ ] **Step 1: Write the failing test**

```ts
it("renders apprunner-targeted web services as App Runner services", () => {
  const ir = enriched({
    compute: [
      { name: "web", source: "compose", kind: "web", image: "public.ecr.aws/x/web:v1",
        target: "apprunner", ports: [{ container: 8080, host: 8080, public: true }] },
    ],
  });
  const result = renderAws(ir);
  expect(result.files["apprunner.tf"]).toContain('resource "aws_apprunner_service" "web"');
  expect(result.files["apprunner.tf"]).toContain('image_repository_type = "ECR"');
  expect(result.files["compute.tf"]).not.toContain("aws_ecs_cluster");
  expect(result.files["outputs.tf"]).toContain('output "apprunner_web_url"');
});

it("emits the aws_partition data source exactly once when fargate and apprunner mix", () => {
  const ir = enriched({
    compute: [
      { name: "web", source: "compose", kind: "web", image: "x/web", target: "apprunner" },
      { name: "jobs", source: "compose", kind: "worker", image: "x/jobs", target: "fargate" },
    ],
  });
  const result = renderAws(ir);
  const all = Object.values(result.files).join("\n");
  expect(all.match(/data "aws_partition" "current"/g)?.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/aws-render.test.ts -t "apprunner"`
Expected: FAIL.

- [ ] **Step 3: Implement** as specced above.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/render`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aws/render.ts tests/render/aws-render.test.ts
git commit -m "feat(providers/aws): render apprunner-target web services"
```

---

### Task 9: AWS rules — target-aware recommendations with cost tiers

**Files:**
- Modify: `src/providers/aws/rules/compute.ts`
- Test: `tests/providers/aws-rules.test.ts`

**Interfaces:**
- Consumes: `compute[].target`.
- Produces:
  - `webFargateRule` / `workerFargateRule`: skip units where `target === "ec2" || target === "apprunner"`.
  - New `ec2BoxRule`: for `target === "ec2"` units → `severity: "suggestion"`, `costTier: "low"`, message `Service "<name>": run on a single EC2 box ($ — cheapest, no HA)`, rationale about single-VM docker tradeoff.
  - New `appRunnerRule`: for `target === "apprunner"` → `costTier: "low"`, message `Service "<name>": run on App Runner ($$ — managed, web only, needs a pushed image)`.

- [ ] **Step 1: Write the failing test**

In `tests/providers/aws-rules.test.ts` (read first, match style):

```ts
it("recommends per target with cost tiers and skips Fargate for cheap targets", () => {
  const recs = runRules({
    compute: [
      { name: "web", kind: "web", target: "ec2", /* … */ },
      { name: "api", kind: "web", target: "apprunner", /* … */ },
      { name: "jobs", kind: "worker", /* no target → fargate */ },
    ],
  });
  expect(recs.some((r) => r.ruleId === "aws.compute.ec2-box" && r.costTier === "low")).toBe(true);
  expect(recs.some((r) => r.ruleId === "aws.compute.app-runner")).toBe(true);
  const fargateRecs = recs.filter((r) => r.ruleId === "aws.compute.web-fargate");
  expect(fargateRecs.every((r) => !r.message.includes('"web"') && !r.message.includes('"api"'))).toBe(true);
});
```

(Adapt to the actual helper names in the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/aws-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** rules + register `ec2BoxRule`, `appRunnerRule` in `src/providers/aws/index.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/providers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aws/rules/compute.ts src/providers/aws/index.ts tests/providers/aws-rules.test.ts
git commit -m "feat(providers/aws): target-aware compute rules with cost tiers"
```

---

### Task 10: User-journey tests

**Files:**
- Modify: `tests/generate.test.ts`

**Interfaces:**
- Consumes: everything above.

Journeys (each a full `generateProject` run asserting written files):

1. **Interview-only, cheapest** — answers: provider aws, budget cheapest, region, containers, `web`, kind web, target `ec2`, no db, no storage → `ec2.tf` exists, `compute.tf` has no `aws_ecs_cluster`.
2. **Interview-only, production** — same but budget production, target `fargate` → `compute.tf` has `aws_ecs_cluster`, no `ec2.tf`.
3. **Compose web+worker+postgres+volume, balanced** — fixture `tests/compose/fixtures/web-db-redis.yaml` (read it first; if it lacks a named volume use/create a fitting fixture file — creating a new fixture is allowed): provider aws via mock or queue, budget balanced, region, targets (web→`apprunner`, worker→`fargate`), keep-public `true`, managed confirms `true` per datastore, volume keep `true` → `apprunner.tf` + `compute.tf` ECS both present, `data.tf` has `aws_db_instance`.
4. **Compose, cheapest, all EC2** — same fixture, budget cheapest, all targets `ec2`, keep-public `true`, decline managed datastores (`false` each) → single `ec2.tf` runs both services, `data.tf` has no `aws_db_instance`, diagnostics mention skipped datastores.
5. **Non-interactive `--budget cheapest`** — `generateProject({ composePath, provider: "aws", budget: "cheapest", interview: false })`: document chosen semantics — budget without interview does NOT change targets (units keep `target: undefined` → Fargate) because there is no one to confirm the tradeoff; assert result ok and note in test name that targets stay Fargate. (If you want non-interactive budget to force ec2, that is a spec change — raise it before implementing.)

- [ ] **Step 1: Write the journey tests** (they may pass already — journeys 1–4 exercise Tasks 2–8 end to end)
- [ ] **Step 2: Run** `npx vitest run tests/generate.test.ts` — Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add tests/generate.test.ts
git commit -m "test(generate): user-journey coverage for budget and target flows"
```

---

### Task 11: Full gate

- [ ] **Step 1:** `npx vitest run` — whole suite PASS.
- [ ] **Step 2:** `npm run build` (check `package.json` for the exact script) — PASS.
- [ ] **Step 3:** `npx biome check src tests` (repo uses biome — see `biome.json`) — PASS or fix.
- [ ] **Step 4:** If the terraform-validate harness (`tests/render/terraform-validate.test.ts`) supports adding an ec2 fixture cheaply, add one; otherwise note it as follow-up.
- [ ] **Step 5:** Report results; hand off for review.

---

## Self-Review Notes

- Spec coverage: budget question (T2), target menu + $ hints (T3), ec2 render (T7), apprunner render (T8), context questions (T4), `--budget` flag (T5), rules cost tiers (T9), journey tests (T10), cost hints in options (T2/T3 hints; recommendation tiers T9). Volumes/datastore/LB questions from spec §4 all present in T4.
- Deferred: NAT-gateway skip for EC2-only projects → downgraded to an info diagnostic (T7); terraform-validate ec2 fixture → T11 best-effort.
- Type consistency: `Budget`, `ComputeTarget` defined T1, used everywhere; `runInterview` 4th param defined T2, consumed T5.
