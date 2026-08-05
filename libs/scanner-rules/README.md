# scanner-rules

The rule engine: parsed manifest in, findings out. No I/O, no framework, no
database — which is what makes it the one part of the domain that can be tested
exhaustively and cheaply (CLAUDE.md).

| File              | What it holds                                                  |
| ----------------- | -------------------------------------------------------------- |
| `package-lock.ts` | lockfile v2/v3 parser; reconstructs dependency chains          |
| `advisories.ts`   | the static CVE fixture (SPEC.md §41 — deliberately not a feed) |
| `version.ts`      | semver ordering, enough of it to test an advisory's bounds     |
| `rules.ts`        | the rules themselves, and the registry the engine iterates     |
| `engine.ts`       | parse → run rules → dedupe → sort                              |

Two rules run today, both over `package-lock.json`:

- **NPM-CVE-001** — the resolved version falls inside an advisory's affected range.
- **NPM-SRC-001** — the dependency came from somewhere other than the public
  registry. Not automatically wrong, so `medium`, but it bypasses provenance and
  the advisory data the first rule depends on.

## Adding a rule

Implement `Rule<PackageLockContext>` and add it to `PACKAGE_LOCK_RULES`. The
engine composes whatever is in that array; nothing else changes. Findings must be
members of the `Finding` union in `libs/shared-types` — a new finding kind is a
contract change and must break both the API and the web build.

```bash
nx test scanner-rules
nx build scanner-rules
```
