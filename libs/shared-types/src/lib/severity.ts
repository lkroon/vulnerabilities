/**
 * Severity levels, ordered most to least urgent.
 *
 * Declared `as const` so `Severity` is a union of literals rather than `string`.
 * That is what makes exhaustive `switch` narrowing work in the Angular templates
 * (SPEC.md §208) and what makes a contract change a compile error rather than a
 * runtime surprise.
 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export type Severity = (typeof SEVERITIES)[number];

/**
 * Counts per severity. `Record` over the union means adding a severity to
 * SEVERITIES breaks every construction site until it is handled — which is the
 * point.
 */
export type SeverityCounts = Record<Severity, number>;

export const EMPTY_SEVERITY_COUNTS: SeverityCounts = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
};

/** Total findings across all severities. */
export function totalFindings(counts: SeverityCounts): number {
  return SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
}
