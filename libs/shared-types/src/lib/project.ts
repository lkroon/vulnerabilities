import type { SeverityCounts } from './severity';

/**
 * A project as shown in the dashboard list (SPEC.md §205 screen 1).
 *
 * Mirrors the `PK = ORG#<orgId>, SK = PROJECT#<projectId>` item from §107, plus
 * the rolled-up counts from the project's most recent scan so the list can render
 * without opening any scan document.
 */
export interface ProjectSummary {
  orgId: string;
  projectId: string;
  name: string;
  /** `owner/repo`, e.g. `acme/api-gateway`. */
  repo: string;
  defaultBranch: string;
  /** ISO-8601 timestamp of the latest scan, or null if never scanned. */
  latestScanAt: string | null;
  counts: SeverityCounts;
}

/**
 * Response body of `GET /api/orgs/:orgId/projects` (SPEC.md §192).
 *
 * Wrapped in an object rather than returned as a bare array so the shape can
 * gain pagination fields later without breaking either side of the boundary.
 */
export interface ListProjectsResponse {
  projects: ProjectSummary[];
}
