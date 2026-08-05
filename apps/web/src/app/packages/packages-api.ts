import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { PackageUsageResponse } from '@config-scanner/shared-types';

/**
 * HTTP access to the package blast-radius endpoint (SPEC.md §226).
 *
 * Response type comes from `libs/shared-types`, never redeclared here
 * (CLAUDE.md). Scoped packages contain a slash, so the name is URI-encoded —
 * the server route is a single `:name` segment that Express decodes once.
 */
@Injectable({ providedIn: 'root' })
export class PackagesApi {
  private readonly http = inject(HttpClient);

  usage(name: string, version: string): Observable<PackageUsageResponse> {
    return this.http.get<PackageUsageResponse>(
      `/api/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/usage`,
    );
  }
}
