# Git Workflow

## Branches

- `main` is always green (every CI gate passes) and deployable. **Never commit directly to `main`.**
- Feature branches: `feat/phase-N-short-desc` (e.g. `feat/phase-2-compose-ingest`);
  also `fix/`, `docs/`, `chore/`, `test/` for non-feature work.
- Start every branch from the latest `main`:

  ```bash
  git checkout main && git pull origin main
  git checkout -b feat/phase-N-short-desc
  ```

- Stacked phases: if phase N+1 builds on phase N, branch phase N+1 off phase N's
  branch, open its PR against that branch, and merge PRs in order.

## Commits (Conventional Commits)

Format: `type(scope): subject` — types: `feat`, `fix`, `docs`, `style`,
`refactor`, `perf`, `test`, `chore`.

Commit **per logical change**, never one big phase dump. TDD order within a phase:

1. `test(<scope>): …` — failing tests written from the phase handoff
2. `feat(<scope>): …` — minimal implementation to green
3. `fix(<scope>): …` — review findings / quality-gate fixes

## Pull Requests

- Push the branch and open a PR against its base (`main`, or the previous phase
  branch when stacked). PR title uses conventional format; description follows:
  Summary / Changes / Testing / Checklist.
- **The human reviews and approves; agents never merge or force-push without approval.**
- Merge with `--no-ff` (preserves branch topology), delete the branch afterwards.

## Keeping Updated

```bash
git fetch origin && git rebase origin/main   # before starting work
git pull --rebase origin main                # when main moved
```

---

## Main rules

# 1. Divide and Conquer
During planning to execute a task, work should be divided in smaller pieces. Delegated to agents to execute the work and then assembled, tested and reviewed. 

Use sub-agents where useful.
Spawn one agent to inspect the authentication flow
and another to review the tests, then implement the fixes.

- Divide bigger task into a smaller task
- Merge and assess the result.

# 2. Don't looooop forever
If you cannot find the solution, spawn an agent and diagnosis the problem together. 

Here are some mandatory hand-offs you should always perform to understand what was achieved. 

- Example 1
```json
{
  "agent": "planner",
  "task": "Add rate limiting to the authentication endpoints.",
  "findings": {
    "framework": "Spring Boot 3.4",
    "authentication": "JWT authentication already implemented",
    "redis": "Redis is already available in docker-compose",
    "rate_limiting": "No current rate limiting implementation exists"
  },
  "decision": {
    "approach": "Use Redis-backed token bucket rate limiting",
    "reason": "The application may run across multiple instances, so the rate limit state should be shared."
  },
  "relevant_files": [
    "src/main/java/com/example/auth/AuthController.java",
    "src/main/java/com/example/security/SecurityConfig.java",
    "docker-compose.yml",
    "pom.xml"
  ],
  "requirements": {
    "login": {
      "endpoint": "POST /auth/login",
      "limit": 5,
      "window_seconds": 60,
      "scope": "IP address"
    },
    "register": {
      "endpoint": "POST /auth/register",
      "limit": 3,
      "window_seconds": 60,
      "scope": "IP address"
    },
    "rate_limit_response": {
      "status": 429
    },
    "excluded": [
      "Authenticated API endpoints"
    ],
    "testing_required": true
  },
  "risks": [
    "X-Forwarded-For can be spoofed unless trusted proxy configuration is enforced.",
    "Redis failure should not make authentication completely unavailable."
  ],
  "handoff": {
    "target_agent": "implementer",
    "next_action": "Inspect the referenced files, confirm the assumptions, implement the solution, run tests, and report the results.",
    "allow_adaptation": true,
    "preserve_requirements": true
  }
}
```
- Example 2

``` json
{
  "agent": "implementer",
  "received_task": "Add rate limiting to the authentication endpoints.",
  "status": "completed",
  "verification": {
    "framework_confirmed": "Spring Boot 3.4",
    "jwt_auth_confirmed": true,
    "redis_confirmed": true,
    "assumptions_changed": []
  },
  "implementation": {
    "approach": "Redis-backed token bucket rate limiting",
    "files_created": [
      "src/main/java/com/example/security/RedisRateLimiter.java",
      "src/main/java/com/example/security/AuthRateLimitFilter.java"
    ],
    "files_modified": [
      "src/main/java/com/example/security/SecurityConfig.java",
      "pom.xml"
    ]
  },
  "behaviour": {
    "login": {
      "endpoint": "POST /auth/login",
      "limit": 5,
      "window_seconds": 60,
      "scope": "IP address",
      "exceeded_response": 429
    },
    "register": {
      "endpoint": "POST /auth/register",
      "limit": 3,
      "window_seconds": 60,
      "scope": "IP address",
      "exceeded_response": 429
    }
  },
  "tests": {
    "command": "./mvnw test",
    "passed": true,
    "cases": [
      "Login requests within limit succeed",
      "Sixth login attempt within 60 seconds returns 429",
      "Register requests within limit succeed",
      "Fourth register attempt within 60 seconds returns 429",
      "Authenticated endpoints are not affected"
    ]
  },
  "remaining_issues": [
    {
      "issue": "Trusted proxy handling",
      "description": "X-Forwarded-For should only be trusted when requests originate from the configured reverse proxy."
    }
  ],
  "handoff": {
    "target_agent": "reviewer",
    "recommended_action": "Review security implications, Redis failure behaviour, concurrency handling, and proxy IP extraction."
  }
}
```

# 3. Failure instances.
An agent MUST classify a task as failed when it cannot satisfy all mandatory
requirements of the received handoff.

Do not mark a task as successful merely because code was written.

A task is considered FAILED if any of the following are true:

1. A mandatory requirement cannot be implemented.
2. Required validation does not pass.
3. The project does not build after the changes.
4. Required tests fail and cannot be repaired within the task scope.
5. A required dependency, credential, tool, file, or service is unavailable.
6. A critical assumption from the handoff is false and prevents completion.
7. The agent lacks permission to perform a required action.
8. The implementation would violate an explicit constraint.
9. Only part of the mandatory task was completed.
10. The agent cannot confidently verify that the requested behaviour works.

Warnings, optional improvements, and non-blocking issues do NOT constitute failure.

When failure occurs, return structured failure information instead of attempting
to hide, ignore, or reinterpret the failed requirement.

- Failure Response Contract

On failure, return JSON using this structure:

```json
{
  "status": "failed",
  "failure": {
    "type": "validation_failure",
    "stage": "testing",
    "reason": "Integration tests fail because Redis is unavailable.",
    "blocking": true,
    "recoverable": true
  },
  "completed": [
    "Implemented RedisRateLimiter",
    "Added login rate limiting"
  ],
  "incomplete": [
    "Integration test verification"
  ],
  "evidence": {
    "command": "./mvnw test",
    "exit_code": 1,
    "error": "Connection refused: localhost:6379"
  },
  "recommended_next_action": "Start Redis or provide a test Redis instance, then rerun the tests."
}
```