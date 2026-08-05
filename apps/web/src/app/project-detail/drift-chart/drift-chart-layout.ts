import {
  SEVERITIES,
  totalFindings,
  type ScanSummary,
  type Severity,
} from '@config-scanner/shared-types';

/** Pixels between adjacent bars. */
export const DRIFT_CHART_BAR_GAP = 4;

export interface DriftChartSize {
  width: number;
  height: number;
}

export interface DriftBarSegment {
  severity: Severity;
  y: number;
  height: number;
  count: number;
}

export interface DriftBar {
  scannedAt: string;
  x: number;
  total: number;
  segments: DriftBarSegment[];
}

export interface DriftChartLayout {
  bars: DriftBar[];
  width: number;
  height: number;
  barWidth: number;
}

/**
 * Turn scan summaries into stacked-bar geometry for `DriftChart`'s SVG.
 *
 * Pure and framework-free so it is unit-testable without `TestBed` — the only
 * real logic behind the drift chart is this arithmetic, not the markup.
 *
 * `scans` arrives newest-first, matching `ListScansResponse` (SPEC.md §118);
 * the chart reads left-to-right as time passing, so this reverses it. Severity
 * stacking order (bottom to top) reuses `SEVERITIES` rather than redeclaring
 * it, so critical sits on the baseline as the heaviest segment.
 */
export function layoutDriftChart(
  scans: readonly ScanSummary[],
  { width, height }: DriftChartSize,
): DriftChartLayout {
  const chronological = [...scans].reverse();

  if (chronological.length === 0) {
    return { bars: [], width, height, barWidth: 0 };
  }

  const maxTotal = Math.max(
    1,
    ...chronological.map((scan) => totalFindings(scan.counts)),
  );
  const scale = height / maxTotal;
  const barWidth =
    (width - DRIFT_CHART_BAR_GAP * (chronological.length - 1)) /
    chronological.length;

  const bars: DriftBar[] = chronological.map((scan, index) => {
    let cumulative = 0;
    const segments: DriftBarSegment[] = SEVERITIES.map((severity) => {
      const count = scan.counts[severity];
      const segmentHeight = count * scale;
      const y = height - cumulative - segmentHeight;
      cumulative += segmentHeight;
      return { severity, y, height: segmentHeight, count };
    });

    return {
      scannedAt: scan.scannedAt,
      x: index * (barWidth + DRIFT_CHART_BAR_GAP),
      total: totalFindings(scan.counts),
      segments,
    };
  });

  return { bars, width, height, barWidth };
}
