<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---

# Config Scanner — agent instructions

Read `SPEC.md` before making design decisions. It holds the reasoning; this file
holds the rules. Where they disagree, SPEC.md wins and this file is wrong — say so.

## The one rule that matters

**Every decision must be explainable in an interview.** A working feature that
cannot be justified is worth less than a smaller feature that can be. If you
cannot articulate why an approach was chosen over the obvious alternative, stop
and flag it rather than writing it.

## Stack constraints (settled — do not re-litigate)

These were decided in SPEC.md §3 and in the planning session. Treat them as fixed
inputs, not open questions.

| Area             | Choice                                                    |
| ---------------- | --------------------------------------------------------- |
| Monorepo         | Nx 23, `apps/` + `libs/` layout                           |
| Backend          | NestJS                                                    |
| Frontend         | Angular (standalone, signals, zoneless)                   |
| Shared contracts | `libs/shared-types`                                       |
| Validation       | `class-validator` + global `ValidationPipe`               |
| Database         | DynamoDB, single-table (SPEC.md §5)                       |
| Deployment       | **AWS serverless** — Lambda + API Gateway + S3/CloudFront |
| Auth             | **AWS Cognito**, provisioned from Pulumi                  |
| IaC              | Pulumi (TypeScript)                                       |
| CI               | GitHub Actions                                            |
| Testing          | Jest + supertest (API), Playwright (one happy-path E2E)   |

The scanner is a **service inside `apps/api`** for v1, with rules in
`libs/scanner-rules`. Extract it to `apps/scanner` only if it earns it.

## Cost ceiling — HIGH IMPORTANCE

Experimentation must never produce a bill of $10 or more. This outranks
architectural elegance and convenience.

- Guardrails land in the Pulumi program **before** any workload: budget alarms at
  $5 and $10, Lambda reserved concurrency cap, DynamoDB on-demand max throughput
  caps, CloudWatch log retention of 7 days, API Gateway throttling.
- Never provision anything that bills per-hour while idle. No NAT Gateway, no
  VPC-attached Lambda, no idle load balancers. Flag the cost of any such resource
  before creating it.
- "Low traffic" is not a substitute for a cap. Runaway loops generate surprise
  bills, not steady state.
- `pulumi up`, `pulumi destroy`, and `aws` commands prompt for confirmation by
  design. Do not try to route around that.
- M1–M3 are entirely local (DynamoDB Local in Docker). No AWS spend before M4.

## TypeScript workspace setup — read before touching tsconfig

This workspace deliberately does **not** use Nx's TypeScript "solution setup"
(project references). Angular does not support it (angular/angular#37276), and
`@nx/angular` refuses to initialise when it is present.

Concretely: root `package.json` has no `workspaces` key, `tsconfig.base.json`
uses classic `paths` mapping, and the `@nx/js/typescript` plugin is absent from
`nx.json`. **Do not add any of them back.** If a generator or migration tries to,
that is a regression — stop and raise it.

`emitDecoratorMetadata` and `experimentalDecorators` are on because Nest DI and
`class-validator` require them.

## Shared contracts

- All cross-boundary types live in `libs/shared-types`, imported as
  `@config-scanner/shared-types`.
- **Never redeclare a DTO inside an app.** A contract change must break both the
  API and the web build. That mutual breakage is the headline TypeScript argument
  of this project — protect it.
- Findings are a discriminated union on `kind`. Render them via exhaustive
  narrowing; never cast.

## Angular style — modern only

- Standalone components. **No NgModules.**
- Signals for component state. RxJS retained for HTTP.
- `@if` / `@for` control flow. Not `*ngIf` / `*ngFor`.
- `inject()` over constructor injection.
- Typed reactive forms.

Reject NgModule-era patterns even if a generator or a training-data habit
produces them.

## NestJS

- Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`.
- DTOs carry `class-validator` decorators — TS types are erased at runtime, so
  decorators are what actually validate. This is the Pydantic analogue.
- Every endpoint is authenticated. No public write paths (SPEC.md §9).
- Validate file uploads for both size and type.

## Testing

Unit tests are required for:

- The **rule engine** in `libs/scanner-rules`
- The **key-design query builders** (PK/SK construction, GSI1 lookups)

These two carry the actual domain logic. Coverage elsewhere is not a goal —
`nx affected -t test` should stay fast.

## Data model rules (SPEC.md §5)

- Findings are **embedded** in the scan document — immutable, never read without
  their scan.
- If `findings` exceeds the size threshold, write to S3 and store `findingsRef`.
  Seed at least one example so the escape hatch is demonstrated, not just described.
- **Only index packages that have findings.** Writing `PKG#` rows for all ~800
  transitive deps per scan is write amplification for no benefit. This is the
  single most important efficiency decision in the model.
- `PKG#` rows are upserts with a ~90 day TTL, refreshed per scan.

## Workflow

- Each milestone (SPEC.md §10) lands as one reviewable PR.
- Ship M1–M2 before touching M3+. A deployed narrow app beats a broad local one.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Run `npx nx affected -t lint test build` before proposing a commit.
- Node version is pinned in `.nvmrc` (22). `nvm use` before running anything.

## Keep a correction log

SPEC.md §254 asks for notes on where the agent needed correcting — it is raw
material for the AI-workflow write-up in M5, which is the weakest interview topic.
When corrected on something non-obvious, append it to `docs/agent-corrections.md`
with what was wrong and why. Do not silently absorb the correction.
