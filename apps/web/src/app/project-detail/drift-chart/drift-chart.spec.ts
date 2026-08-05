import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY_SEVERITY_COUNTS, type ScanSummary } from '@config-scanner/shared-types';
import { DriftChart } from './drift-chart';

const SCANS: ScanSummary[] = [
  {
    projectId: 'api-gateway',
    scannedAt: '2026-07-24T09:00:00Z',
    status: 'completed',
    manifest: 'package-lock.json',
    commit: 'a3f19c2',
    durationMs: 4210,
    findingCount: 1,
    counts: { ...EMPTY_SEVERITY_COUNTS, critical: 1 },
  },
  {
    projectId: 'api-gateway',
    scannedAt: '2026-06-18T11:20:00Z',
    status: 'completed',
    manifest: 'package-lock.json',
    commit: 'c81f5ea',
    durationMs: 5310,
    findingCount: 2,
    counts: { ...EMPTY_SEVERITY_COUNTS, low: 2 },
  },
];

describe('DriftChart', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriftChart],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders one stacked bar per scan and one axis label per bar', () => {
    const fixture = TestBed.createComponent(DriftChart);
    fixture.componentRef.setInput('scans', SCANS);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.drift-chart__segment')).toHaveLength(8); // 2 bars * 4 severities
    expect(el.querySelectorAll('.drift-chart__label')).toHaveLength(2);
  });

  it('scales the critical segment to its count', () => {
    const fixture = TestBed.createComponent(DriftChart);
    fixture.componentRef.setInput('scans', SCANS);
    fixture.detectChanges();

    const rects = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.drift-chart__segment--critical',
      ),
    );
    // layoutDriftChart reverses newest-first input to chronological order, so
    // rects[0] is the oldest scan (2026-06-18, critical:0) and rects[1] is the
    // newest (2026-07-24, critical:1). scale = 160 / maxTotal(2) = 80.
    expect(rects).toHaveLength(2);
    expect(rects[0].getAttribute('height')).toBe('0');
    expect(rects[1].getAttribute('height')).toBe('80');
  });
});
