import { EMPTY_SEVERITY_COUNTS, type ScanSummary } from '@config-scanner/shared-types';
import { DRIFT_CHART_BAR_GAP, layoutDriftChart } from './drift-chart-layout';

function scan(
  scannedAt: string,
  overrides: Partial<ScanSummary['counts']>,
): ScanSummary {
  return {
    projectId: 'api-gateway',
    scannedAt,
    status: 'completed',
    manifest: 'package-lock.json',
    commit: null,
    durationMs: 0,
    findingCount: 0,
    counts: { ...EMPTY_SEVERITY_COUNTS, ...overrides },
  };
}

describe('layoutDriftChart', () => {
  it('returns an empty layout for no scans', () => {
    const layout = layoutDriftChart([], { width: 100, height: 100 });
    expect(layout).toEqual({ bars: [], width: 100, height: 100, barWidth: 0 });
  });

  it('reverses newest-first input to chronological order', () => {
    // API order is newest-first: b (2 low) then a (1 critical).
    const b = scan('2026-02-01T00:00:00Z', { low: 2 });
    const a = scan('2026-01-01T00:00:00Z', { critical: 1 });

    const layout = layoutDriftChart([b, a], { width: 100, height: 100 });

    expect(layout.barWidth).toBe(48); // (100 - 4*1) / 2
    expect(layout.bars.map((bar) => bar.scannedAt)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
    ]);
  });

  it('stacks critical on the baseline and scales each segment to its count', () => {
    const b = scan('2026-02-01T00:00:00Z', { low: 2 });
    const a = scan('2026-01-01T00:00:00Z', { critical: 1 });

    const layout = layoutDriftChart([b, a], { width: 100, height: 100 });
    const [barA, barB] = layout.bars;

    // maxTotal = 2, scale = height / maxTotal = 50
    expect(barA.x).toBe(0);
    expect(barA.segments.find((s) => s.severity === 'critical')).toEqual({
      severity: 'critical',
      y: 50,
      height: 50,
      count: 1,
    });
    expect(barA.segments.find((s) => s.severity === 'low')?.height).toBe(0);

    expect(barB.x).toBe(52); // barWidth (48) + gap (4)
    expect(barB.segments.find((s) => s.severity === 'low')).toEqual({
      severity: 'low',
      y: 0,
      height: 100,
      count: 2,
    });
  });

  it('never divides by zero when every scan is clean', () => {
    const clean = scan('2026-01-01T00:00:00Z', {});
    const layout = layoutDriftChart([clean], { width: 100, height: 100 });

    expect(
      layout.bars[0].segments.every((s) => Number.isFinite(s.height)),
    ).toBe(true);
    expect(layout.bars[0].total).toBe(0);
  });

  it('exports the gap used to derive barWidth', () => {
    expect(DRIFT_CHART_BAR_GAP).toBe(4);
  });
});
