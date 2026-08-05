import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ListScansResponse,
  ScanDetailResponse,
} from '@config-scanner/shared-types';

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

  /**
   * Full scan with findings (`GET /api/scans/:projectId/:scannedAt`,
   * SPEC.md §224). `scannedAt` is a route segment, so it is URI-encoded like
   * every other parameter — timestamps carry colons which Express tolerates,
   * but encoding is the uniform rule.
   */
  getDetail(
    projectId: string,
    scannedAt: string,
  ): Observable<ScanDetailResponse> {
    return this.http.get<ScanDetailResponse>(
      `/api/scans/${encodeURIComponent(projectId)}/${encodeURIComponent(scannedAt)}`,
    );
  }
}
