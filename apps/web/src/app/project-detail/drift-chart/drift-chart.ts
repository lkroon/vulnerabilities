import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { ScanSummary } from '@config-scanner/shared-types';
import { layoutDriftChart, type DriftChartSize } from './drift-chart-layout';

const CHART_SIZE: DriftChartSize = { width: 480, height: 160 };

/**
 * Stacked-bar severity-over-time chart (SPEC.md §205 screen 2).
 *
 * Rendering is a thin `@for` over `layoutDriftChart`'s output — the geometry
 * is computed once in a pure, unit-tested function (drift-chart-layout.ts) so
 * the template has nothing left to get subtly wrong.
 */
@Component({
  selector: 'cs-drift-chart',
  imports: [DatePipe],
  templateUrl: './drift-chart.html',
  styleUrl: './drift-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DriftChart {
  readonly scans = input.required<ScanSummary[]>();

  protected readonly layout = computed(() =>
    layoutDriftChart(this.scans(), CHART_SIZE),
  );
}
