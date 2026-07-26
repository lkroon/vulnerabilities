# Handover — temporary

> **Delete this file when M2 lands.** It captures session state and environment
> facts that are true as of **2026-07-26** and will rot. It does **not** restate
> `SPEC.md` (design + reasoning), `README.md` (tradeoffs), or `CLAUDE.md`
> (working rules) — read those first. This covers only what those three do not.

---

## 1. Where things stand

**M1 is complete and merged to `main`** (PR #2, merge commit `1922c5e`). CI green.

Verified working end to end:

- `libs/shared-types` — `Severity` literal union, `SeverityCounts`,
  `ProjectSummary`, `ListProjectsResponse`
- `GET /api/orgs/:orgId/projects` in Nest, returning fixture data
- Angular projects screen rendering that data through the dev proxy
- 16 unit tests + 4 e2e (1 api-e2e, 3 web-e2e), lint and build clean
- DynamoDB Local + `dynamodb-admin` via `docker-compose.yml`
- The M1 contract proof: renaming a field in `shared-types` fails **both** builds

**Not started:** everything M2 onward. Concretely:

- `infra/` contains only `.gitkeep` — no Pulumi program exists
- **No AWS account has been created yet**
- No AWS SDK, Pulumi, or Cognito dependency is installed
- DynamoDB Local is running but has **zero tables** — nothing persists anything
- `libs/scanner-rules` is a generated stub with no rules in it
- Only one endpoint of the seven in SPEC.md §191 exists

---

## 2. Environment — read before running anything

**Node is not on `PATH` in non-interactive shells.** It is installed via nvm.
Every command needs this prefix or you get `node: command not found`:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
```

This is the single most common way to waste time in this repo. Node 22 is pinned
in `.nvmrc`.

**Playwright system libraries are installed** (the human ran
`sudo npx playwright install-deps chromium`). e2e runs locally. Chromium only —
the config declares one browser project deliberately.

**`jq` is not installed.** Use `node -e` for JSON work.

**Docker is available** and the DynamoDB containers may already be running from a
previous session — `docker compose ps` before assuming.

---

## 3. Load-bearing constraints that fail silently

**Do not re-add TypeScript project references.** No `workspaces` key in root
`package.json`, no `@nx/js/typescript` plugin in `nx.json`, classic `paths` in
`tsconfig.base.json`. Angular does not support project references
(angular/angular#37276) and `@nx/angular` refuses to initialise against them. If
a generator or `nx migrate` reintroduces either, that is a regression — stop and
raise it. Also in `CLAUDE.md`, repeated here because it is the highest-cost
mistake available.

**`tsconfig.base.json` sets `noUnusedLocals: true`.** Nx-generated scaffolding
sometimes violates this and fails the build in a confusing place. It already bit
once (`apps/api-e2e/src/support/global-setup.ts`).

**Both e2e projects want the API on `:3000`** — api-e2e via
`dependsOn: ["api:build", "api:serve"]`, web-e2e via its Playwright `webServer`.
`apps/api-e2e/src/support/global-teardown.ts` must **not** call `killPort`; it
kills a server Nx owns and that web-e2e is using. CI runs e2e with
`--parallel=1` for the same reason.

**The API keeps running after an e2e run.** Nx does not stop continuous tasks at
run end. `npm run reset` frees `:3000`.

---

## 4. The recurring failure mode in this project

Five entries in `docs/agent-corrections.md`, and most are the same shape: **a
green result that was not green.**

- Nx returns exit 0 for CLI flags it silently ignored
- The Angular dev server returned HTTP 200 with `index.html` for a missing API route
- `nx serve` printed "Successfully ran" while serving nothing
- DynamoDB Local reported `healthy` while SQLite could not open its database

Consequence for how to work here: **assert on the artifact, not the status code.**
Check content type and body, not just 2xx. Check the generated file, not just the
exit code. When adding a test, make it fail for the right reason.

`CLAUDE.md` asks for new entries in `docs/agent-corrections.md` when corrected on
something non-obvious. That log is a deliverable for M5 (SPEC.md §247), not
housekeeping.

---

## 5. M2 — next milestone

Goal per SPEC.md §237: scan ingestion, a rule engine over one manifest type, the
key design implemented, seed data including the `findingsRef` spill example.

Suggested order, smallest provable step first:

1. **Table + repository against DynamoDB Local.** Implement the §104 key design
   (`PK`/`SK`, `GSI1`). Replace the fixture array in
   `apps/api/src/app/projects/projects.service.ts` — the method signature is
   designed not to change. A table-creation script is needed; there is none yet.
2. **Unit-test the key-design query builders.** `CLAUDE.md` requires this. They
   are pure functions; test them without a database.
3. **Rule engine in `libs/scanner-rules`** over one manifest type
   (`package-lock.json` is the natural first). Also a required test target.
4. **`POST /api/projects/:id/scans`** — upload → scan → immutable snapshot. This
   is the first endpoint taking input, so it needs `class-validator` DTOs; the
   global `ValidationPipe` is already wired in `apps/api/src/main.ts`.
5. **Seed data**, including one scan whose findings exceed the threshold and spill
   to `findingsRef` (SPEC.md §165). Seed it deliberately — the escape hatch must
   be demonstrated, not just described.

Design decisions already settled, do not reopen: only index packages that
**have findings**; `PKG#` rows are upserts with ~90 day TTL; findings are embedded
in the scan document.

---

## 6. Before touching AWS (M4)

**A $10 hard ceiling is a stated, high-importance constraint.** M1–M3 are entirely
local and cost nothing. When M4 starts:

- Budget alarms at $5 and $10 go into the Pulumi program **before** any workload
- Lambda reserved concurrency cap, DynamoDB on-demand max throughput caps,
  7-day CloudWatch log retention, API Gateway throttling
- Nothing that bills per-hour while idle — no NAT Gateway, no VPC-attached Lambda
- `pulumi up`, `pulumi destroy`, and `aws *` prompt for confirmation by design.
  Do not route around that.

The account will be new, so the post-July-2025 Free plan applies: $100 credits on
signup plus up to $100 from onboarding tasks, six months.

---

## 7. Verification

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
npm run verify                       # lint + test + build (affected)
npx nx run-many -t e2e --parallel=1  # matches CI exactly
npm run dev                          # api :3000, web :4200
```

Sanity check the seam, not just the services:

```bash
curl -i http://localhost:4200/api/orgs/acme/projects   # must be application/json
```

Each milestone lands as one reviewable PR (`CLAUDE.md`). CI must be green before
merge; it runs `format:check --all`, `lint test build`, then e2e serially.
