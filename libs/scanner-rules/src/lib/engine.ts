import {
  SEVERITIES,
  type Finding,
  type ManifestType,
} from '@config-scanner/shared-types';
import type { Advisory } from './advisories';
import { ManifestParseError, parsePackageLock } from './package-lock';
import {
  PACKAGE_LOCK_RULES,
  defaultAdvisories,
  type PackageLockContext,
  type Rule,
} from './rules';

/** What a scan produced, before it is turned into a stored document. */
export interface ScanOutcome {
  findings: Finding[];
  /** How many packages the manifest resolved to — context for "0 findings". */
  packagesScanned: number;
}

export interface ScanOptions {
  /** Override the advisory database. Tests use this; production uses the fixture. */
  advisories?: ReadonlyMap<string, readonly Advisory[]>;
  /** Override the rule set. Defaults to every rule registered for the manifest type. */
  rules?: readonly Rule<PackageLockContext>[];
}

const SEVERITY_RANK = new Map(
  SEVERITIES.map((severity, index) => [severity, index]),
);

/**
 * Order findings most urgent first, then by a stable tiebreaker.
 *
 * Sorting here rather than in the UI means the stored document is already in the
 * order it is read in, every consumer agrees on the order, and a scan of the
 * same manifest twice produces byte-identical findings — which is what makes the
 * snapshots comparable over time.
 */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity =
      (SEVERITY_RANK.get(a.severity) ?? 0) -
      (SEVERITY_RANK.get(b.severity) ?? 0);
    if (bySeverity !== 0) return bySeverity;
    return identity(a).localeCompare(identity(b));
  });
}

/** A stable per-finding sort key, derived by narrowing rather than casting. */
function identity(finding: Finding): string {
  switch (finding.kind) {
    case 'npm_cve':
      return `${finding.package}@${finding.version}#${finding.cve}`;
    case 'npm_supply_chain':
      return `${finding.package}@${finding.version}#${finding.rule}`;
    case 'terraform_misconfig':
      return `${finding.file}:${finding.line}#${finding.rule}`;
    case 'dockerfile':
      return `${finding.file}:${finding.line}#${finding.rule}`;
  }
}

/**
 * Collapse findings that are the same problem reported more than once.
 *
 * npm installs a package once per incompatible version *requirement*, so a real
 * lockfile contains several nested copies of, say, `semver@6.3.1` — one under
 * `@babel/core`, one under `@nx/js`, and so on. Each copy is a separate entry in
 * the lockfile and each matches the same advisory, which without this produces
 * four identical rows and, worse, counts one vulnerability four times. Severity
 * counts drive the dashboard and the drift chart, so inflating them makes the
 * headline numbers meaningless.
 *
 * The first occurrence wins, and because the parser walks breadth-first that is
 * the one with the shortest dependency chain — the most useful one to show.
 */
function dedupeFindings(findings: Finding[]): Finding[] {
  const byIdentity = new Map<string, Finding>();

  for (const finding of findings) {
    const key = `${finding.kind}:${identity(finding)}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, finding);
    }
  }

  return [...byIdentity.values()];
}

/** Run the package-lock rule set over already-parsed packages. */
export function runPackageLockRules(
  context: PackageLockContext,
  rules: readonly Rule<PackageLockContext>[] = PACKAGE_LOCK_RULES,
): Finding[] {
  return sortFindings(
    dedupeFindings(rules.flatMap((rule) => rule.evaluate(context))),
  );
}

/**
 * Parse a manifest and run every rule registered for its type.
 *
 * The manifest type is a parameter rather than something sniffed from the
 * content: the caller already knows it from the upload's filename, and guessing
 * at parse time turns a clear 400 ("we do not scan that") into a confusing one
 * ("this is not valid JSON").
 *
 * Throws `ManifestParseError` for anything unreadable — the API maps that to a
 * 400 rather than a 500, because a bad upload is the client's mistake.
 */
export function scanManifest(
  manifest: ManifestType,
  content: string,
  options: ScanOptions = {},
): ScanOutcome {
  if (manifest !== 'package-lock.json') {
    // Declared in the union, not yet implemented (SPEC.md §266 scopes M2 to one
    // manifest type). The union member exists because the seed data and the
    // finding types already model these; the parsers land with M3+.
    throw new ManifestParseError(
      `Scanning ${manifest} manifests is not implemented yet.`,
    );
  }

  const packages = parsePackageLock(content);
  const findings = runPackageLockRules(
    { packages, advisories: options.advisories ?? defaultAdvisories },
    options.rules,
  );

  return { findings, packagesScanned: packages.length };
}
