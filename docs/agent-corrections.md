# Agent corrections log

Raw material for the AI-workflow write-up in M5 (SPEC.md §247). Each entry records
something an agent got wrong, or would have got wrong, and why — not just the fix.

The interesting entries are the ones where the agent's advice was _correct in
general_ and wrong _here_. Those are the cases that argue for reading agent
configuration rather than trusting it.

---

## 2026-07-26 — A scaffolder-installed skill contradicted the workspace architecture

**What:** `create-nx-workspace` installed seven Nx agent skills into `.agents/skills/`
and a byte-identical copy into `.github/skills/`. One of them,
`link-workspace-packages`, carries this instruction in its dispatch description:

> DO NOT patch around with tsconfig paths or manual package.json edits — use the
> package manager's workspace commands to fix actual linking.

**Why that is wrong here:** this workspace deliberately has no `workspaces` key in
`package.json` and resolves cross-project imports through tsconfig `paths`. That
is not a shortcut — Angular does not support TypeScript project references
(angular/angular#37276) and `@nx/angular` refuses to initialise against Nx 23's
default solution setup. The tsconfig `paths` mapping is the _required_ approach.

**Why it would have bitten:** the skill's stated triggers include `TS2307` and
"cannot find module" on `@org/*` imports — exactly the error produced by a typo in
`@config-scanner/shared-types`. Had it fired, it would have advised re-adding npm
workspaces, which breaks the Angular build and silently reverts the conversion.

**Fix:** disabled via `skillOverrides` in `.claude/settings.json`. Also disabled
`monitor-ci` (301 lines orchestrating Nx Cloud, which this workspace does not use —
created with `--nxCloud=skip`) and `nx-import` (238 lines about merging repositories,
irrelevant here and pure context cost).

**Generalisation:** skill dispatch is probabilistic and fails silently. Unlike a lint
rule, a wrong skill produces no error — it just steers. Vendor-generated agent
config deserves the same review as vendor-generated code.

---

## 2026-07-26 — Nx 23 presets ignore CLI flags

**What:** `create-nx-workspace` in Nx 23 maps legacy presets to GitHub template
repositories ("Mapping legacy preset 'apps' to template 'nrwl/empty-template'").
The template path silently ignores `--no-workspaces`, `--aiAgents`,
`--workspaceType`, and `--unitTestRunner`.

**Consequence:** `--aiAgents claude` still produced config for five vendors
(`.cursor`, `.gemini`, `.codex`, `.opencode`, plus `opencode.json` and `AGENTS.md`);
`--unitTestRunner=jest` on the Angular template still produced vitest.

**Fix:** verified the flags were ineffective by inspecting the generated output
rather than trusting exit code 0, then converted the workspace manually and proved
the result by generating both apps and running a build before applying it to the repo.

**Generalisation:** a zero exit code is not evidence the flags took effect. Check the
artifact, not the status code.

---

## 2026-07-26 — Angular app generated without a dev proxy; agent's own verification was too narrow

**Caught by:** me (the human), not the agent.

**What:** `apps/web` was generated without `--backendProject=api`, so no
`proxy.conf.json` was produced and the `serve` target had no `proxyConfig`. Requests
to `http://localhost:4200/api` hit the Angular dev server's SPA fallback and returned
**`index.html` with HTTP 200**, not a 404.

**Why that is worse than a 404:** a 404 fails loudly at the first fetch. A 200 of
HTML means the browser accepts the response and fails later, inside JSON parsing,
with an error that points nowhere near the actual cause. The failure is displaced
from the defect.

**Where the agent's verification fell short:** it probed `:3000/api` and `:4200/`,
both of which returned 200, and reported "it runs" — technically true. It never
probed the cross-origin path `:4200/api`, which is the one the frontend will
actually use. Checking each service in isolation proved nothing about the seam
between them, and the seam is where the bug was.

**Fix:** added `apps/web/proxy.conf.json` routing `/api` to `http://localhost:3000`,
wired into the `serve` target via `proxyConfig`. Verified `:4200/api` now returns
`{"message":"Hello API"}` with `content-type: application/json`.

**Generalisation:** verify the integration path, not just the endpoints. And treat a
200 as a real result to inspect, not a pass — content type and body matter. This one
also argues for the M1 acceptance criterion being "the Angular screen renders data
fetched from Nest", not "both servers start".

---

## 2026-07-26 — `nx serve` reported success while serving nothing

**Caught by:** me (the human).

**What:** with `web` already served, a second invocation of `nx serve api` printed

```
Waiting for api:serve:development in another nx process
NX   Successfully ran target serve for project api
```

and exited. Nothing was listening on `:3000`. Exit code 0, "Successfully ran", no
server.

**Cause:** Nx 23 deduplicates _continuous_ tasks across processes — if `api:serve`
is registered as running elsewhere, a second invocation waits rather than starting a
duplicate. The agent had earlier stopped servers by killing PIDs directly, which
never let Nx deregister the task, so the registry claimed a dead process still owned
it.

**Fix:** `nx reset` clears the stale state. The durable fix is to run both in one Nx
process — `nx run-many -t serve --projects=api,web`, now wrapped as `npm run dev`.

**Generalisation:** two of the four entries in this log are the same failure —
**a green result that wasn't**. Nx flags ineffective CLI flags with exit 0, the
Angular dev server returns 200 for a missing API route, and `nx serve` reports
success while serving nothing. Trusting exit codes and status codes over observed
behaviour is the single most repeated mistake so far. Check the artifact.
