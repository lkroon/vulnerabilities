/** One project that depends on the queried package version. */
export interface PackageUsage {
  orgId: string;
  projectId: string;
  /** Date (not timestamp) the package was last seen in a scan of this project. */
  lastSeen: string;
}

/**
 * Response of `GET /api/packages/:name/:version/usage` — blast radius
 * (SPEC.md §226, access pattern 5).
 *
 * Only packages that produced a finding are indexed (SPEC.md §198), so an empty
 * `projects` array means "no project has a *vulnerable* copy of this version",
 * not "nobody depends on it". The endpoint is only ever asked about vulnerable
 * packages, which is what makes that tradeoff free.
 */
export interface PackageUsageResponse {
  package: string;
  version: string;
  projects: PackageUsage[];
}
