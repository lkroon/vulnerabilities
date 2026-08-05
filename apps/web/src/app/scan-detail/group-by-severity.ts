import {
  SEVERITIES,
  type Finding,
  type Severity,
} from '@config-scanner/shared-types';

/**
 * One severity bucket of a scan's findings, in `SEVERITIES` order
 * (critical → low) — the order SPEC.md §236 screen 3 renders them in.
 */
export interface SeverityGroup {
  severity: Severity;
  findings: Finding[];
}

/**
 * Bucket findings by severity for the scan detail screen.
 *
 * Pure and framework-free so it is unit-testable without `TestBed`, mirroring
 * `drift-chart-layout`. Always returns one group per severity in `SEVERITIES`
 * order — whether a group has zero findings is a display decision, so the
 * template skips empty groups rather than this helper dropping them. That keeps
 * the four headings stable and lets the template decide.
 */
export function groupBySeverity(
  findings: readonly Finding[],
): SeverityGroup[] {
  return SEVERITIES.map((severity) => ({
    severity,
    findings: findings.filter((finding) => finding.severity === severity),
  }));
}
