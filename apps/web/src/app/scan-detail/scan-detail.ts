import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import type { ScanDetailResponse } from '@config-scanner/shared-types';
import { ScansApi } from '../scans/scans-api';
import { FindingItem } from './finding-item/finding-item';
import { groupBySeverity } from './group-by-severity';

/**
 * SPEC.md §236 screen 3 — findings grouped by severity, rendered per `kind`
 * through the `Finding` discriminated union (CLAUDE.md: exhaustive narrowing,
 * never cast). The narrowing lives in `FindingItem`, one branch per union
 * member; this screen's job is fetching the scan and bucketing it.
 *
 * Both route params are signal inputs bound by `withComponentInputBinding`,
 * so navigating between scans of the same project reuses this component and
 * the request re-fires on the input change (`toObservable` + `switchMap`).
 */
@Component({
  selector: 'cs-scan-detail',
  imports: [DatePipe, RouterLink, FindingItem],
  templateUrl: './scan-detail.html',
  styleUrl: './scan-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScanDetail {
  private readonly scansApi = inject(ScansApi);

  readonly projectId = input.required<string>();
  readonly scannedAt = input.required<string>();

  private readonly params = computed(() => ({
    projectId: this.projectId(),
    scannedAt: this.scannedAt(),
  }));

  private readonly response = toSignal(
    toObservable(this.params).pipe(
      switchMap(({ projectId, scannedAt }) =>
        this.scansApi
          .getDetail(projectId, scannedAt)
          .pipe(catchError(() => of<ScanDetailResponse | null>(null))),
      ),
    ),
    { initialValue: undefined },
  );

  protected readonly loading = computed(() => this.response() === undefined);
  protected readonly failed = computed(() => this.response() === null);
  protected readonly scan = computed(() => this.response()?.scan ?? null);
  protected readonly groups = computed(() =>
    groupBySeverity(this.scan()?.findings ?? []),
  );
}
