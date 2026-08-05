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

---

## 2026-07-26 — Agent shipped a known race into CI rather than resolving it

**What:** to make web-e2e a real integration test, the agent added the API to
Playwright's `webServer` array with `reuseExistingServer: true`. All three
web-e2e tests then failed in CI with `[vite] http proxy error:
/api/orgs/acme/projects` repeated nine times.

**Cause:** `nx run-many -t e2e` runs both e2e projects in parallel. api-e2e
starts the API on :3000 through `dependsOn: ["api:build", "api:serve"]`;
web-e2e's Playwright saw :3000 already up and reused it rather than starting its
own; api-e2e then finished and its generated `global-teardown.ts` called
`killPort(3000)`, destroying the server web-e2e was mid-way through using.

The underlying defect is that the teardown killed a server it never started —
Nx owns that process, not Jest.

**Fix:** removed `killPort` from the teardown, and made the CI e2e step serial
(`--parallel=1`) so two processes never race to start the same continuous task.

**Where the agent was actually at fault:** it identified this exact risk before
writing the change — noting that Playwright would spawn a nested `nx serve`
while the outer `nx run-many` was running, and that this was the same
cross-process contention already recorded in the entry above — then shipped it
anyway because it could not run Playwright locally (missing `libnspr4.so`,
requiring sudo). Naming a risk is not mitigating it. The correct move was either
to make the design not share :3000, or to say plainly that the step was unproven
_before_ it reached CI rather than after.

**Generalisation:** an unverifiable change is not the same as a verified one.
When local verification is impossible, either reduce the change until it is
verifiable, or state the uncertainty as a blocker rather than a footnote.

---

## 2026-07-26 — Every unit test passed while the scanner double-counted findings

**Caught by:** running the scanner against a real `package-lock.json` (this
repository's own) rather than the synthetic ones in the tests.

**What:** the first end-to-end scan of a real 1MB lockfile reported eight
findings, four of which were `semver@6.3.1 / CVE-2022-25883` with different
dependency chains. The rule engine's 46 unit tests were green.

**Cause:** npm nests a second copy of a package whenever two dependents need
incompatible ranges, so a real lockfile contains `node_modules/@babel/core/
node_modules/semver`, `node_modules/@nx/js/node_modules/semver`, and so on. Each
is a distinct entry, each matched the advisory, and each became a finding. Every
test fixture was hand-written and hoisted flat, so none of them contained a
nested duplicate — the tests agreed with the code because they shared its
assumption.

**Why it mattered more than a cosmetic repeat:** severity counts are
denormalised onto the scan and the project item, and they drive the project list
and the drift chart. Counting one vulnerability four times does not just add
rows, it makes the headline numbers wrong, and the drift chart would have shown
"improvement" whenever npm happened to dedupe a tree.

**Fix:** the engine now collapses findings on identity (`package@version#cve`),
keeping the first occurrence — which, because the parser walks breadth-first, is
the shortest dependency chain. Both a unit test with a nested duplicate and the
real-lockfile path now cover it.

**Generalisation:** this is the same failure as the four entries above, one level
up. A green test suite is not evidence when every fixture was written by the same
mind as the code — the fixtures encoded the belief being tested. The thing that
found it was the cheapest possible real input: a file already sitting in the repo.
Test data that comes from the world, not from the author, is worth more per line
than another synthetic case.

---

## 2026-07-26 — Deviation worth noting: `ProjectsService` signatures became async

`docs/HANDOVER.md` (now deleted) said the M1 fixture method "is designed not to
change" when DynamoDB replaced it. The response _shape_ did not change, and no
caller's types changed beyond awaiting — but `listByOrg` returns
`Promise<ListProjectsResponse>` rather than `ListProjectsResponse`. Nest handles
both transparently in a controller, so nothing else moved. Recording it because
"the signature does not change" was slightly too strong a claim to leave
unqualified.
