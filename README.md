# Config Scanner

Scans a repository's dependency manifests and IaC files, stores each scan as an
immutable snapshot, and surfaces findings plus drift over time in a dashboard.

Domain deliberately chosen to overlap with shift-left security and IaC scanning.

> **Status: M1 in progress.** Workspace scaffolded; no feature code yet.
> `SPEC.md` holds the full design reasoning. `CLAUDE.md` holds the working rules.

---

## Stack

| Area | Choice |
|---|---|
| Monorepo | Nx 23 (`apps/` + `libs/`) |
| Backend | NestJS |
| Frontend | Angular (standalone, signals, zoneless) |
| Shared contracts | `libs/shared-types` — imported by both sides |
| Validation | `class-validator` + global `ValidationPipe` |
| Database | DynamoDB, single-table |
| Auth | AWS Cognito |
| IaC | Pulumi (TypeScript) |
| CI | GitHub Actions |
| Testing | Jest + supertest, Playwright |

## Layout

```
apps/
  api/            NestJS — scanner runs as a service inside this for v1
  web/            Angular
  api-e2e/        supertest
  web-e2e/        Playwright
libs/
  shared-types/   DTOs, finding unions, API contracts — imported by BOTH
  scanner-rules/  rule definitions + fixture CVE data
infra/            Pulumi program
SPEC.md           design reasoning
CLAUDE.md         agent instructions / conventions
```

## Getting started

```bash
nvm use                 # Node 22, pinned in .nvmrc
npm install
npx nx run-many -t build
```

---

## Decisions and tradeoffs

This section is the point of the project. Every choice below has an alternative
that would have been reasonable; what matters is being able to say why.

### Why DynamoDB rather than Postgres

Access patterns were designed first and the keys serve them — entities did not
drive the design. The five patterns (latest scan, scan history, one scan with its
findings, projects in an org, blast radius by package version) are all known in
advance and all satisfied by one table plus one GSI.

Findings are **embedded** in the scan document. They are immutable and never read
without their scan, so denormalisation carries no update-anomaly cost. The three
finding kinds — npm CVE, Terraform misconfiguration, Dockerfile lint — share
almost no fields, and that heterogeneity is the argument for a document model.

**Where relational would win:** ad-hoc analytics ("mean time to remediate by
severity across all orgs last quarter"), any access pattern not designed for, and
mutable finding lifecycle state (open → acknowledged → fixed) with audit history.
The mature design is hybrid — documents on the hot path, changes streamed into
Postgres or a warehouse for BI.

**This is not a badly-used JSON column.** That anti-pattern is mixed types in one
table with no constraints serving as the operational model. This is one entity
type, one known read path, immutable snapshots. Same technology, opposite
situation.

### Why AWS serverless rather than the existing k8s cluster

Both were live options. Hetzner + MongoDB would have had zero marginal cost and
would have allowed a first-hand Pulumi-versus-Helm comparison.

AWS won because the data model above is DynamoDB-native — choosing Mongo would
have meant translating the key design (compound `{projectId, scannedAt}` index, a
secondary index standing in for GSI1, a TTL index) before any domain work could
start. The cost difference turned out to be near zero: Lambda, CloudFront and
DynamoDB storage sit in always-free tiers, so steady state is roughly $0–1/month.

### Why Cognito rather than Auth0

Cognito is provisioned by the same Pulumi program, so auth infrastructure is part
of the IaC story rather than clicked into a third-party dashboard, and
least-privilege IAM follows naturally.

**The tradeoff:** it is the most AWS-coupled choice in the stack and would be the
first thing rewritten if the app moved. Auth0 would have kept the app portable at
the cost of configuration living outside the IaC.

### Cost control as an explicit constraint

A hard ceiling of $10 was set before any infrastructure was written, and the
guardrails are part of the Pulumi program rather than a monitoring habit: budget
alarms at $5 and $10, Lambda reserved concurrency cap, DynamoDB on-demand maximum
throughput caps, 7-day log retention, API Gateway throttling, and nothing that
bills per-hour while idle.

The reasoning: at portfolio traffic the steady-state bill is negligible, so the
real risk is a runaway loop or a log explosion — a failure mode that caps prevent
and that watching a dashboard does not.

### Why the TypeScript setup looks unusual

Nx 23 defaults to a "solution setup" built on TypeScript project references.
Angular does not support it (angular/angular#37276) and `@nx/angular` refuses to
initialise against it. The workspace uses the classic `paths` mapping instead.

This is a tooling constraint rather than a preference, but it is load-bearing —
re-adding `workspaces` to `package.json` or the `@nx/js/typescript` plugin to
`nx.json` will break the Angular build.

---

## Known limitations

Scope discipline is deliberate. One domain, ~6 endpoints, deployed and
documented, beats a half-finished platform.

- **CVE data is a static fixture**, not a live feed.
- **No git provider integration** — manifests are uploaded, not pulled from webhooks.
- **Multi-tenancy stops at an org partition key.**
- No remediation workflow, ticketing, or notifications.
