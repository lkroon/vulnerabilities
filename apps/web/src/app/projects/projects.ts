import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import {
  SEVERITIES,
  totalFindings,
  type ListProjectsResponse,
  type SeverityCounts,
} from '@config-scanner/shared-types';
import { ProjectsApi } from './projects-api';

/**
 * SPEC.md §205 screen 1 — project list with latest severity counts.
 *
 * Standalone, zoneless, signals for state, `inject()` over constructor
 * injection, `@if`/`@for` in the template. No NgModule anywhere.
 */
@Component({
  selector: 'cs-projects',
  imports: [DatePipe, RouterLink],
  templateUrl: './projects.html',
  styleUrl: './projects.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Projects {
  private readonly api = inject(ProjectsApi);

  /** Hardcoded until auth lands — the org will come from the Cognito token. */
  private static readonly ORG_ID = 'acme';

  private readonly response = toSignal(
    this.api
      .listByOrg(Projects.ORG_ID)
      .pipe(catchError(() => of<ListProjectsResponse | null>(null))),
    { initialValue: undefined },
  );

  protected readonly severities = SEVERITIES;
  protected readonly loading = computed(() => this.response() === undefined);
  protected readonly failed = computed(() => this.response() === null);
  protected readonly projects = computed(() => this.response()?.projects ?? []);

  protected total(counts: SeverityCounts): number {
    return totalFindings(counts);
  }
}
