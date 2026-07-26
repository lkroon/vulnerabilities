import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ListProjectsResponse } from '@config-scanner/shared-types';

/**
 * HTTP access to the projects endpoints.
 *
 * The response type is imported from `libs/shared-types` — never redeclared here
 * (CLAUDE.md). RxJS is retained for HTTP per SPEC.md §211; signals handle state
 * in the component.
 *
 * Paths are same-origin and relative. In dev the Angular proxy forwards `/api`
 * to :3000 (`apps/web/proxy.conf.json`); in production CloudFront routes `/api`
 * to API Gateway. No host is hardcoded on either side.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);

  listByOrg(orgId: string): Observable<ListProjectsResponse> {
    return this.http.get<ListProjectsResponse>(
      `/api/orgs/${encodeURIComponent(orgId)}/projects`,
    );
  }
}
