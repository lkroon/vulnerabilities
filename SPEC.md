# Config Scanner — Implementation Spec

> Hand this file to Claude Code as the starting brief. It contains the goals,
> the decisions already made, the reasoning behind them, and a milestone plan.
> Keep it in the repo root as `SPEC.md` so the reasoning stays next to the code.

---

## 1. Why this project exists

This is a portfolio project built to close a specific gap: I am a Python/Vue/PostgreSQL
engineer applying for a **full-stack TypeScript** role (NestJS + Angular + NoSQL + Pulumi,
AI-security product). The app is the evidence that the gap is closing.

**Every design decision must be explainable in an interview.** A working feature I
cannot justify is worth less than a smaller feature I can defend. Where a tradeoff
exists, the README records both sides and why I chose one.

Secondary goal: demonstrate a deliberate AI-assisted development workflow — repo
conventions, agent instructions, and reviewable output.

## 2. What it does

Scan a repository's dependency manifests and IaC files, store each scan as an
immutable snapshot, and show findings plus drift over time in a dashboard.

Domain deliberately chosen to overlap with shift-left security / IaC scanning.

### In scope (v1)

- Register a project (org + repo reference)
- Trigger a scan by uploading a manifest file (`package-lock.json`, `*.tf`, `Dockerfile`)
- Rule-based findings from a small local ruleset + a static CVE fixture file
- Dashboard: project list, latest scan, findings detail, severity-over-time chart
- "Blast radius": which projects are affected by a given package version
- Auth (single provider, JWT)

### Explicitly NOT in scope

- Real CVE feed integration (use a fixture; note this in the README)
- Git provider integration / webhooks (upload only)
- Multi-tenancy beyond an org partition key
- Remediation workflow, ticketing, notifications
- Pretty design work beyond clean and consistent

Scope discipline is the point. **One domain, ~6 endpoints, deployed and documented
beats a half-finished platform.**

## 3. Stack decisions (already made — do not re-litigate)

| Area             | Choice                                                                     | Why                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo         | **Nx**                                                                     | Purpose-built for the Angular+NestJS combo; enables the shared types lib                                                         |
| Shared contracts | `libs/shared-types`                                                        | The headline TypeScript argument: one contract, compile-time enforced on both sides of the network boundary                      |
| Backend          | **NestJS**                                                                 | Target-role stack; DI + module model transfers from Angular                                                                      |
| Validation       | `class-validator` + global `ValidationPipe`                                | Runtime validation at the boundary — the analogue of Pydantic. Decorators are needed because TS types are erased at compile time |
| Frontend         | **Angular** (standalone components, signals, new control flow, `inject()`) | Target-role stack. Must be written modern — no NgModules, no constructor-injection-everywhere                                    |
| Database         | **DynamoDB** (single-table)                                                | See §5. Deliberately not Postgres                                                                                                |
| IaC              | **Pulumi** (TypeScript)                                                    | Target-role stack; infra in the same language as the app                                                                         |
| CI               | GitHub Actions                                                             | Already know it; `pulumi preview` on PR, `pulumi up` on main                                                                     |
| Testing          | Jest + supertest (API), Playwright (one happy-path E2E)                    | Enough to prove the habit, not a coverage exercise                                                                               |

### Deployment target — pick one before starting

**Option A (recommended): AWS serverless.** DynamoDB on-demand + Lambda (Nest via
`@codegenie/serverless-express`) + API Gateway + S3/CloudFront for the Angular bundle.
The data model in §5 is DynamoDB-native, and free tier keeps this at roughly zero cost.

**Option B: existing Hetzner k8s cluster + MongoDB.** Zero marginal cost, and lets me
compare Pulumi-authored resources against the Helm charts I write at work — which is
itself a good interview answer. Requires translating §5 to Mongo (compound shard key
`{projectId, scannedAt}`, same access patterns).

Decide once, record the reason in the README, do not hedge.

## 4. Repo layout

```
apps/
  api/                 NestJS
  web/                 Angular
  scanner/             (optional) worker; can start as a service inside api
libs/
  shared-types/        DTOs, finding unions, API contracts — imported by BOTH
  scanner-rules/       rule definitions + fixture CVE data
infra/                 Pulumi program (TypeScript)
CLAUDE.md              agent instructions / conventions
SPEC.md                this file
README.md              architecture + tradeoffs (interview artifact)
```

## 5. Data model

Access patterns come first. The keys serve the patterns; entities do not drive the design.

### Access patterns

1. Latest scan for a project (dashboard landing)
2. Scan history for a project, newest first (drift chart)
3. One scan with all its findings
4. All projects in an org
5. Which projects are affected by package X@version (blast radius)

### Single-table key design

```
PK = ORG#<orgId>          SK = PROJECT#<projectId>   → project metadata
PK = PROJECT#<projectId>  SK = SCAN#<ISO timestamp>  → immutable scan snapshot
PK = PROJECT#<projectId>  SK = PKG#<name>@<version>  → sparse index row
                          GSI1PK = PKG#<name>@<ver>
                          GSI1SK = PROJECT#<projectId>
```

Pattern → query:

- (1) `PK = PROJECT#x, SK begins_with SCAN#`, descending, limit 1
- (2) same, unbounded; summary counts drive the chart without opening `findings`
- (3) single `GetItem`
- (4) `PK = ORG#y, SK begins_with PROJECT#`
- (5) GSI1: `GSI1PK = PKG#lodash@4.17.20`

### Example items

```json
{
  "PK": "ORG#acme",
  "SK": "PROJECT#api-gateway",
  "type": "project",
  "name": "API Gateway",
  "repo": "acme/api-gateway",
  "defaultBranch": "main"
}
```

```json
{
  "PK": "PROJECT#api-gateway",
  "SK": "SCAN#2026-07-24T09:00:00Z",
  "type": "scan",
  "status": "completed",
  "commit": "a3f19c2",
  "durationMs": 4210,
  "counts": { "critical": 1, "high": 3, "medium": 7 },
  "findings": [
    {
      "kind": "npm_cve",
      "package": "lodash",
      "version": "4.17.20",
      "cve": "CVE-2021-23337",
      "severity": "high",
      "fixedIn": "4.17.21",
      "path": ["app", "express", "lodash"]
    },
    {
      "kind": "terraform_misconfig",
      "resource": "aws_s3_bucket.logs",
      "rule": "S3-001",
      "severity": "critical",
      "message": "public read access enabled",
      "file": "modules/logging/main.tf",
      "line": 42
    },
    {
      "kind": "dockerfile",
      "rule": "DL3002",
      "severity": "medium",
      "message": "last USER should not be root",
      "file": "Dockerfile",
      "line": 18
    }
  ]
}
```

```json
{
  "PK": "PROJECT#api-gateway",
  "SK": "PKG#lodash@4.17.20",
  "type": "pkgIndex",
  "GSI1PK": "PKG#lodash@4.17.20",
  "GSI1SK": "PROJECT#api-gateway",
  "lastSeen": "2026-07-24",
  "ttl": 1790000000
}
```

The three findings share almost no fields. That heterogeneity is the argument for a
document model, and it should be visible in the seed data.

### Rules that must be implemented

- **Findings are embedded** in the scan document. They are never read without their
  scan and are immutable, so denormalisation carries no update-anomaly cost.
- **Size ceiling.** DynamoDB items cap at 400KB. If `findings` exceeds a threshold,
  write the payload to object storage and store `findingsRef` instead. Include at
  least one seeded example of this so the escape hatch is demonstrated, not just described.
- **`PKG#` rows are upserts** keyed on project+package, so row count is bounded by
  distinct dependencies, not by scan count.
- **Only index packages that have findings.** Writing an index row for all ~800
  transitive deps on every scan is write amplification for no benefit — blast radius
  is only ever asked about vulnerable packages. This is the single most important
  efficiency decision in the model.
- **TTL on `PKG#` rows** (~90 days), refreshed on each scan, so removed dependencies
  expire instead of haunting blast-radius queries forever.

### Tradeoffs to record in the README

- Where relational wins: ad-hoc analytics ("mean time to remediate by severity across
  all orgs last quarter"), any access pattern not designed for, and mutable finding
  lifecycle state (open → acknowledged → fixed) with audit history.
- The mature design is hybrid: documents on the hot path, changes streamed into
  Postgres or a warehouse for BI.
- Distinguish this from a badly-used JSON column: that is mixed types in one table
  with no constraints serving as the operational model. This is one entity type, one
  known read path, immutable snapshots. Same technology, opposite situation.

## 6. API surface (v1)

```
POST   /api/orgs/:orgId/projects          create project
GET    /api/orgs/:orgId/projects          list projects
GET    /api/projects/:id/scans            scan history (summaries only)
GET    /api/projects/:id/scans/latest     dashboard landing
GET    /api/scans/:projectId/:timestamp   full scan incl. findings
POST   /api/projects/:id/scans            upload manifest → run scan
GET    /api/packages/:name/:version/usage blast radius
```

All request/response shapes live in `libs/shared-types` and are imported by the
Angular services. A contract change must break both builds.

## 7. Frontend screens

1. **Projects** — list with latest severity counts
2. **Project detail** — severity-over-time chart + scan list
3. **Scan detail** — findings grouped by severity, rendered per `kind` via a
   discriminated union (this is a genuinely good showcase of TS narrowing in templates)
4. **Package usage** — blast radius lookup

Requirements: standalone components, signals for state, `@if`/`@for` control flow,
typed reactive forms, `inject()`. RxJS retained for HTTP.

## 8. Infrastructure (Pulumi)

- Stacks: `dev` and `prod`, differing by config not by code
- Secrets via `pulumi config set --secret` — nothing sensitive in the repo
- Stack outputs feed app configuration
- CI: `pulumi preview` as a PR check, `pulumi up` on merge to main
- In the README, contrast Pulumi against Helm/ArgoCD: same declarative desired-state
  idea, extended from cluster resources to cloud resources, expressed in a real
  language with types and loops

## 9. Security posture (it is a security-adjacent product — act like it)

- Real auth on every endpoint, no public write paths
- Dependency scanning + secret scanning in CI
- No credentials in the repo; least-privilege IAM from Pulumi
- Input validation on all boundaries; file upload size and type limits

## 10. Milestones

**M1 — skeleton that proves the contract**
Nx workspace, `shared-types` lib, one Nest endpoint, one Angular screen consuming it,
DynamoDB local, Jest running. Deliberately break a shared type and confirm both builds fail.

**M2 — domain**
Scan ingestion, rule engine over one manifest type, key design implemented, seed data
loaded including the `findingsRef` spill example. Tests on the rule engine.

**M3 — frontend**
All four screens, discriminated-union rendering, drift chart.

**M4 — infra**
Pulumi program, both stacks, GitHub Actions pipeline, deployed and publicly reachable.

**M5 — the interview artifact**
README with architecture, key design, tradeoffs, and the "where I'd use relational"
section. Plus a short write-up of the AI-assisted workflow: how the repo is structured
for agents, what I had to correct, where agents consistently failed.

Ship M1–M2 before touching anything in M3+. A deployed narrow app beats a broad local one.

## 11. Working with Claude Code

Create `CLAUDE.md` at the repo root containing:

- The stack decisions from §3, stated as constraints
- Angular style rules (standalone, signals, new control flow — reject NgModule-era patterns)
- "All cross-boundary types live in `libs/shared-types`; never redeclare a DTO in an app"
- Test expectations: rule engine and key-design query builders are unit tested
- Commit convention and the rule that each milestone lands as a reviewable PR

Keep notes as I go on where the agent needed correction. That log is the raw material
for the AI-workflow answer, which is currently my weakest interview topic and the one
their job posting cares most about.

## 12. Open decisions — RESOLVED 2026-07-26

- [x] **Option A — AWS serverless.** Fresh AWS account, so the new Free plan
      applies: $100 credits on signup plus up to $100 from onboarding tasks, over
      six months. Lambda, CloudFront and DynamoDB storage sit in always-free tiers
      that never expire, so steady-state cost at portfolio traffic is roughly
      $0–1/month. Chosen over Option B because §5's key design ships verbatim
      rather than being translated to Mongo. The Hetzner/Mongo alternative is
      recorded in the README as a considered option, not implemented.
- [x] **AWS Cognito.** Provisioned from the same Pulumi program, so auth infra is
      part of the IaC story rather than clicked into a third-party dashboard, and
      §9's least-privilege IAM follows naturally. Free at portfolio scale. The
      tradeoff — it is the most AWS-coupled choice and the first thing that would
      be rewritten if the app ever moved — is recorded in the README.
- [x] **`scanner` is a service inside `api`.** Rules live in
      `libs/scanner-rules`. Extract to `apps/scanner` only if it earns it.

### 12a. Added constraint — cost ceiling (HIGH IMPORTANCE)

Experimentation must never produce a bill of $10 or more. This outranks
architectural elegance. Guardrails land in the Pulumi program *before* any
workload: budget alarms at $5 and $10, Lambda reserved concurrency cap, DynamoDB
on-demand maximum throughput caps, 7-day CloudWatch log retention, API Gateway
throttling, CloudFront PriceClass_100, and a verified `pulumi destroy` path.
Nothing that bills per-hour while idle — no NAT Gateway, no VPC-attached Lambda.

M1–M3 run entirely on DynamoDB Local in Docker. No AWS spend before M4.

### 12b. Deviation from §3 — TypeScript workspace setup

Nx 23's default "solution setup" uses TypeScript project references, which
Angular does not support (angular/angular#37276); `@nx/angular` refuses to
initialise against it. The workspace was therefore converted to the classic
`paths` mapping: no `workspaces` key in root `package.json`, no
`@nx/js/typescript` plugin in `nx.json`. This is a tooling constraint, not a
design choice, but it is load-bearing — see CLAUDE.md before editing tsconfig.
