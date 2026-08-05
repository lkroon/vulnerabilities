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

/**
 * Request body of `POST /api/orgs/:orgId/projects` (SPEC.md §220).
 *
 * `orgId` is not in the body — it is in the path, and accepting it twice invites
 * the two to disagree. The API declares a `class-validator` DTO that
 * `implements` this interface rather than redeclaring the fields (CLAUDE.md):
 * decorators cannot live here without dragging `class-validator` into the
 * Angular bundle, but `implements` still makes a contract change a compile
 * error on both sides.
 */
export interface CreateProjectRequest {
  /** URL-safe identifier, unique within the org. Becomes the `PROJECT#` key. */
  projectId: string;
  name: string;
  /** `owner/repo`, e.g. `acme/api-gateway`. */
  repo: string;
  defaultBranch: string;
}

/** Response of `POST /api/orgs/:orgId/projects`. */
export interface CreateProjectResponse {
  project: ProjectSummary;
}
