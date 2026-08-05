import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ListScansResponse } from '@config-scanner/shared-types';

/**
 * HTTP access to the scan endpoints, shared by the project-detail and
 * scan-detail screens — both read through `/api/.../scans...` paths. Response
 * types come from `libs/shared-types`, never redeclared here (CLAUDE.md).
 */
@Injectable({ providedIn: 'root' })
export class ScansApi {
  private readonly http = inject(HttpClient);

  listByProject(projectId: string): Observable<ListScansResponse> {
    return this.http.get<ListScansResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/scans`,
    );
  }
}
