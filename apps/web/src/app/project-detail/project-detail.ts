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
import {
  SEVERITIES,
  totalFindings,
  type ListProjectsResponse,
  type ListScansResponse,
  type SeverityCounts,
} from '@config-scanner/shared-types';
import { ProjectsApi } from '../projects/projects-api';
import { ScansApi } from '../scans/scans-api';
import { DriftChart } from './drift-chart/drift-chart';

/**
 * SPEC.md §205 screen 2 — severity-over-time chart + scan history.
 *
 * `projectId` is a signal input bound by `withComponentInputBinding` in
 * app.config.ts, not read via `ActivatedRoute` — the router reuses this
 * component across navigations to the same route with a different
 * `:projectId`, so fetching reacts to the input changing (`toObservable` +
 * `switchMap`) instead of running once in the constructor.
 */
@Component({
  selector: 'cs-project-detail',
  imports: [DatePipe, RouterLink, DriftChart],
  templateUrl: './project-detail.html',
  styleUrl: './project-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetail {
  private readonly scansApi = inject(ScansApi);
  private readonly projectsApi = inject(ProjectsApi);

  /** Hardcoded until auth lands — matches the projects screen (CLAUDE.md). */
  private static readonly ORG_ID = 'acme';

  readonly projectId = input.required<string>();

  private readonly scansResponse = toSignal(
    toObservable(this.projectId).pipe(
      switchMap((projectId) =>
        this.scansApi
          .listByProject(projectId)
          .pipe(catchError(() => of<ListScansResponse | null>(null))),
      ),
    ),
    { initialValue: undefined },
  );

  private readonly projectsResponse = toSignal(
    this.projectsApi
      .listByOrg(ProjectDetail.ORG_ID)
      .pipe(catchError(() => of<ListProjectsResponse | null>(null))),
    { initialValue: undefined },
  );

  protected readonly severities = SEVERITIES;
  protected readonly loading = computed(
    () => this.scansResponse() === undefined,
  );
  protected readonly failed = computed(() => this.scansResponse() === null);
  protected readonly scans = computed(() => this.scansResponse()?.scans ?? []);
  protected readonly project = computed(() =>
    this.projectsResponse()?.projects.find(
      (p) => p.projectId === this.projectId(),
    ),
  );

  protected total(counts: SeverityCounts): number {
    return totalFindings(counts);
  }
}
