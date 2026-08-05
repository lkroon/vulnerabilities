# Config Scanner

Scans a repository's dependency manifests and IaC files, stores each scan as an
immutable snapshot, and surfaces findings plus drift over time in a dashboard.

Domain deliberately chosen to overlap with shift-left security and IaC scanning.

> **Status: M2 complete.** The domain is real — scan ingestion, a rule engine over
> `package-lock.json`, the single-table key design on DynamoDB, and seed data
> including the oversized-findings escape hatch. Frontend screens beyond the
> project list are M3; AWS deployment is M4.
> `SPEC.md` holds the full design reasoning. `CLAUDE.md` holds the working rules.

---

## Stack

| Area             | Choice                                       |
| ---------------- | -------------------------------------------- |
| Monorepo         | Nx 23 (`apps/` + `libs/`)                    |
| Backend          | NestJS                                       |
| Frontend         | Angular (standalone, signals, zoneless)      |
| Shared contracts | `libs/shared-types` — imported by both sides |
| Validation       | `class-validator` + global `ValidationPipe`  |
| Database         | DynamoDB, single-table                       |
| Auth             | AWS Cognito                                  |
| IaC              | Pulumi (TypeScript)                          |
| CI               | GitHub Actions                               |
| Testing          | Jest + supertest, Playwright                 |

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
docker compose up -d    # DynamoDB Local on :8000, dynamodb-admin on :8001
npm run db:create-table # single table + GSI1 + TTL
npm run db:seed         # 3 projects, 5 scans, one of them spilled
npm run dev             # serves api on :3000 and web on :4200
```

`npm run db:reset` drops the table, recreates it and reseeds — the fastest way
back to a known state. Seeding is idempotent, so re-running it replaces the seed
rows without touching anything uploaded by hand.

| URL                       | What                                                 |
| ------------------------- | ---------------------------------------------------- |
| http://localhost:4200     | Angular app                                          |
| http://localhost:4200/api | proxied to Nest — this is the path the frontend uses |
| http://localhost:3000/api | Nest directly (note the `/api` prefix; `/` is a 404) |
| http://localhost:8001     | dynamodb-admin — browse the single table's items     |

**Run both with one command.** `npm run dev` wraps
`nx run-many -t serve --projects=api,web`, which starts both in a single Nx
process. Two separate `nx serve` invocations also work, but if one is killed
uncleanly the other reports `Waiting for <target> in another nx process` and
exits without serving — `npm run reset` clears that stale task state.

The web dev server proxies `/api` to `:3000` via `apps/web/proxy.conf.json`, so
the frontend uses same-origin paths in dev exactly as it will in production,
where CloudFront routes `/api` to API Gateway. No CORS config, no hardcoded host.

Other scripts: `npm run build`, `npm test`, `npm run lint`, and `npm run verify`
(`nx affected -t lint test build`).

## API

```
POST   /api/orgs/:orgId/projects           create a project
GET    /api/orgs/:orgId/projects           list projects with latest severity counts
POST   /api/projects/:id/scans             upload a manifest → run rules → snapshot
GET    /api/projects/:id/scans             scan history (summaries only)
GET    /api/projects/:id/scans/latest      dashboard landing
GET    /api/scans/:projectId/:timestamp    one scan with its findings
GET    /api/packages/:name/:version/usage  blast radius
```

Try it against the seeded data:

```bash
curl -s localhost:3000/api/orgs/acme/projects
curl -s localhost:3000/api/projects/api-gateway/scans
curl -s "localhost:3000/api/scans/api-gateway/2026-07-24T09:00:00.000Z"
curl -s localhost:3000/api/packages/cookie/0.6.0/usage   # two projects affected

# Scan a real lockfile — this repository's own
curl -s -X POST localhost:3000/api/orgs/acme/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"demo","name":"Demo","repo":"acme/demo","defaultBranch":"main"}'
curl -s -X POST localhost:3000/api/projects/demo/scans \
  -F manifest=@package-lock.json -F commit=a3f19c2
```

Auth is not wired up yet. SPEC.md §254 requires every endpoint to be
authenticated, and that lands with Cognito in M4 — the write paths above are
open until then, which is why nothing is deployed.

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

### What the scanner does, and what it reads

The rule engine in `libs/scanner-rules` is pure: parsed manifest in, findings
out, no I/O. Two rules run over a `package-lock.json` — a match against a static
advisory fixture, and a check that each dependency came from the public registry
rather than a git URL or a private host.

It reads the **lockfile**, not `package.json`. `package.json` states intent
(`^4.17.0`); the lockfile states what is installed, including transitive
dependencies and where each copy came from. Intent is not what gets deployed.

Reconstructing the dependency chain is the non-obvious part. npm hoists shared
dependencies to the top level, so the lockfile key `node_modules/braces` records
where the bytes are, not who asked for them. The parser re-runs Node's resolution
algorithm breadth-first from the root, which yields the shortest chain to each
package — the difference between "we depend on this" and "something we depend on
does", which is the first question anyone asks about a transitive finding.

**There is no `semver` dependency.** A lockfile contains concrete versions and
advisories are `[introducedIn, fixedIn)` intervals, so the only operation needed
is an ordering comparison — not range parsing, not satisfiability. The ~60 lines
that implement it are unit tested against the semver spec's own ordering rules,
including the case that makes a naive implementation wrong: `1.9.0 < 1.10.0`
numerically, but not lexically.

### Only indexing packages that have findings

`PKG#` rows exist to answer blast radius. Writing one per resolved dependency
would mean ~800 writes per scan; indexing only the packages that produced a
finding makes the write cost proportional to the problems found. Blast radius is
only ever asked about vulnerable packages, so the tradeoff costs nothing — the
consequence, recorded in the API contract, is that an empty result means "no
project has a _vulnerable_ copy", not "nobody depends on it".

The rows carry a 90-day TTL refreshed on every scan, so a dependency that was
removed stops haunting the answer without anything having to diff two scans.

### When findings outgrow the item

DynamoDB caps an item at 400KB. Above a 128KB threshold the findings array is
written to object storage and the item keeps a `findingsRef` instead. The summary
— counts, timestamp, status — always stays in DynamoDB, because that is what the
project list and the drift chart read.

The seed data includes one scan that spills, so the escape hatch is exercised
rather than described, and there is an e2e test that uploads a manifest large
enough to trigger it and reads the findings back through the API. Locally the
store is the filesystem; in M4 it becomes S3, behind the same two-method
interface.

### Immutability enforced by the database, not by convention

Scans are snapshots, so every scan write is a conditional `Put`
(`attribute_not_exists(SK)`) — an accidental replay cannot silently rewrite
history, and the same condition doubles as the collision check when two uploads
land in the same millisecond. Project creation uses the same mechanism for
uniqueness: DynamoDB has no unique constraint, and a read-then-write is a race
that two concurrent requests both win.

The one denormalised field, the latest-scan rollup on the project item, is
updated under `latestScanAt < :newScan`. It is what keeps the project list to a
single query instead of one query per project, and because scans are immutable it
can only ever be stale by one write, never wrong.

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

- **CVE data is a static fixture** of ~15 real advisories, not a live feed. The
  rule already asks the questions a feed answers, so swapping it is a data
  change, not a redesign.
- **One manifest type is implemented.** `package-lock.json` is parsed and scanned;
  Terraform and Dockerfile findings are modelled in the shared types and present
  in the seed data, but nothing produces them yet.
- **No auth.** Every endpoint is open until Cognito lands in M4, which is why
  nothing is deployed.
- **No git provider integration** — manifests are uploaded, not pulled from webhooks.
- **Multi-tenancy stops at an org partition key.**
- No remediation workflow, ticketing, or notifications.
- Dev-only dependencies are scanned like any other. npm records the distinction;
  acting on it is a filter that has not been earned yet.
