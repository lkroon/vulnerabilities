import type { Finding } from '@config-scanner/shared-types';
import { ADVISORIES_BY_PACKAGE, type Advisory } from './advisories';
import type { ResolvedPackage } from './package-lock';
import { isVersionAffected } from './version';

/** Everything a `package-lock.json` rule is allowed to look at. */
export interface PackageLockContext {
  packages: readonly ResolvedPackage[];
  /** Injected rather than imported so tests can drive a rule with a fixture of two entries. */
  advisories: ReadonlyMap<string, readonly Advisory[]>;
}

/**
 * A rule is a pure function from a parsed manifest to findings.
 *
 * Pure, so the engine can be tested without a filesystem, a database or a
 * network — which is the requirement CLAUDE.md puts on this library. The `id`
 * exists so a finding can be traced back to the code that produced it, and so a
 * rule can later be disabled by configuration without deleting it.
 */
export interface Rule<TContext> {
  id: string;
  description: string;
  evaluate(context: TContext): Finding[];
}

/**
 * Known-vulnerable dependency versions, matched against the advisory fixture.
 *
 * Iterates packages and looks the advisory up by name rather than iterating
 * advisories and searching packages: a lockfile carries ~800 entries against a
 * fixture of ~15, and the map lookup keeps this linear in the lockfile rather
 * than quadratic.
 */
export const npmCveRule: Rule<PackageLockContext> = {
  id: 'NPM-CVE-001',
  description: 'Dependency version matches a known advisory',
  evaluate({ packages, advisories }) {
    const findings: Finding[] = [];

    for (const pkg of packages) {
      const candidates = advisories.get(pkg.name);
      if (!candidates) continue;

      for (const advisory of candidates) {
        if (!isVersionAffected(pkg.version, advisory)) continue;

        findings.push({
          kind: 'npm_cve',
          severity: advisory.severity,
          package: pkg.name,
          version: pkg.version,
          cve: advisory.cve,
          fixedIn: advisory.fixedIn,
          path: pkg.path,
        });
      }
    }

    return findings;
  },
};

const REGISTRY_HOSTS = ['registry.npmjs.org'];

/**
 * Dependencies installed from somewhere other than the public registry.
 *
 * A git URL or a tarball on a random host bypasses everything the registry
 * provides — immutable versions, provenance, and the advisory data the rule
 * above depends on. It is not automatically wrong (private packages are
 * legitimate), so it is `medium` and worded as something to know about rather
 * than something that is broken.
 *
 * This rule earns its place by proving the engine is an engine: two rules over
 * one parsed manifest, composed by the runner rather than by a switch inside a
 * single scan function.
 */
export const npmSupplyChainRule: Rule<PackageLockContext> = {
  id: 'NPM-SRC-001',
  description: 'Dependency resolved from outside the public npm registry',
  evaluate({ packages }) {
    const findings: Finding[] = [];

    for (const pkg of packages) {
      if (pkg.resolved === null) continue;

      let host: string | null = null;
      try {
        host = new URL(pkg.resolved).host;
      } catch {
        // `file:` paths and bare specifiers do not parse as URLs. Off-registry
        // by definition, so they are reported with an empty host.
        host = '';
      }

      if (REGISTRY_HOSTS.includes(host)) continue;

      findings.push({
        kind: 'npm_supply_chain',
        severity: 'medium',
        package: pkg.name,
        version: pkg.version,
        rule: 'NPM-SRC-001',
        message: host
          ? `Resolved from ${host} rather than the public npm registry`
          : 'Resolved from a local path or git reference rather than the public npm registry',
        resolved: pkg.resolved,
      });
    }

    return findings;
  },
};

/**
 * The rules that run against a `package-lock.json`.
 *
 * A plain array, exported, so adding a rule is one import and one entry — and so
 * a test can assert on the registry itself rather than on a hardcoded count.
 */
export const PACKAGE_LOCK_RULES: readonly Rule<PackageLockContext>[] = [
  npmCveRule,
  npmSupplyChainRule,
];

/** Default context wiring: the fixture advisory database. */
export const defaultAdvisories = ADVISORIES_BY_PACKAGE;
