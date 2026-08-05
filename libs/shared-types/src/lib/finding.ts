import {
  EMPTY_SEVERITY_COUNTS,
  type Severity,
  type SeverityCounts,
} from './severity';

/**
 * A dependency with a known advisory (SPEC.md §146).
 *
 * `path` is the dependency chain that pulled the package in — the difference
 * between "we depend on this" and "something we depend on depends on this",
 * which is the first question asked about any transitive finding.
 */
export interface NpmCveFinding {
  kind: 'npm_cve';
  severity: Severity;
  package: string;
  version: string;
  cve: string;
  /** First version that is not affected, or null when no fix is published. */
  fixedIn: string | null;
  path: string[];
}

/** A dependency resolved from somewhere other than the public registry (SPEC.md §146). */
export interface NpmSupplyChainFinding {
  kind: 'npm_supply_chain';
  severity: Severity;
  package: string;
  version: string;
  rule: string;
  message: string;
  /** The `resolved` URL from the lockfile that triggered the rule. */
  resolved: string;
}

/** An IaC misconfiguration (SPEC.md §155). Not produced in v1 — see `libs/scanner-rules`. */
export interface TerraformMisconfigFinding {
  kind: 'terraform_misconfig';
  severity: Severity;
  resource: string;
  rule: string;
  message: string;
  file: string;
  line: number;
}

/** A Dockerfile lint failure (SPEC.md §163). Not produced in v1. */
export interface DockerfileFinding {
  kind: 'dockerfile';
  severity: Severity;
  rule: string;
  message: string;
  file: string;
  line: number;
}

/**
 * The finding union, discriminated on `kind` (SPEC.md §187, CLAUDE.md).
 *
 * The members share almost no fields beyond `kind` and `severity`. That
 * heterogeneity is the argument for a document model rather than a table with
 * forty nullable columns, and it is what makes exhaustive narrowing in the
 * Angular templates worth showing. Render via narrowing; never cast.
 */
export type Finding =
  | NpmCveFinding
  | NpmSupplyChainFinding
  | TerraformMisconfigFinding
  | DockerfileFinding;

export type FindingKind = Finding['kind'];

/**
 * Roll findings up into the counts stored on the scan summary.
 *
 * Lives in the shared lib because both sides need it: the API writes the counts
 * onto the scan item so the dashboard can render a project list without opening
 * a single findings array (SPEC.md §118), and the web app recomputes them when
 * filtering a scan it already holds.
 */
export function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { ...EMPTY_SEVERITY_COUNTS };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
