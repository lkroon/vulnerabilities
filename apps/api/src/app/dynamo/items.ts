import type {
  Finding,
  ProjectSummary,
  ScanStatus,
  ScanSummary,
  ManifestType,
  SeverityCounts,
  PackageUsage,
} from '@config-scanner/shared-types';

/**
 * The stored shape of each entity.
 *
 * These are deliberately *not* the shared contracts. An item carries `PK`, `SK`,
 * `GSI1PK`, `type` and `ttl` — storage mechanics that no API client should ever
 * see, and that would leak the key design into the frontend if returned as-is.
 * The mappers below are the boundary; they are the only place that knows both
 * shapes.
 */
interface BaseItem {
  PK: string;
  SK: string;
}

export interface ProjectItem extends BaseItem {
  GSI1PK: string;
  GSI1SK: string;
  type: 'project';
  orgId: string;
  projectId: string;
  name: string;
  repo: string;
  defaultBranch: string;
  createdAt: string;
  /**
   * Latest-scan rollup, denormalised onto the project.
   *
   * The project list renders severity counts for every project (SPEC.md §205).
   * Without this the list would be one query per project to find its newest
   * scan — the N+1 that key designs exist to prevent. The cost is one extra
   * write per scan, paid on the write path where latency does not matter, and
   * there is no update-anomaly risk because scans are immutable: the projection
   * can only ever be stale by one write, never wrong.
   */
  latestScanAt?: string;
  latestCounts: SeverityCounts;
}

export interface ScanItem extends BaseItem {
  type: 'scan';
  projectId: string;
  scannedAt: string;
  status: ScanStatus;
  manifest: ManifestType;
  commit: string | null;
  durationMs: number;
  counts: SeverityCounts;
  findingCount: number;
  /** Present when the findings fit inside the item (the normal case). */
  findings?: Finding[];
  /** Present instead of `findings` when the payload spilled to object storage (SPEC.md §165). */
  findingsRef?: string;
}

export interface PackageIndexItem extends BaseItem {
  GSI1PK: string;
  GSI1SK: string;
  type: 'pkgIndex';
  orgId: string;
  projectId: string;
  name: string;
  version: string;
  /** Date, not timestamp — the row is an upsert and the day is the useful granularity. */
  lastSeen: string;
  /** Epoch *seconds*. DynamoDB ignores a TTL it cannot read as seconds. */
  ttl: number;
}

export function toProjectSummary(item: ProjectItem): ProjectSummary {
  return {
    orgId: item.orgId,
    projectId: item.projectId,
    name: item.name,
    repo: item.repo,
    defaultBranch: item.defaultBranch,
    // Absent rather than null in storage: DynamoDB can compare a missing
    // attribute (`attribute_not_exists`) but not a NULL against a string, and
    // the rollup update needs "only if this scan is newer" to be expressible.
    latestScanAt: item.latestScanAt ?? null,
    counts: item.latestCounts,
  };
}

export function toScanSummary(item: ScanItem): ScanSummary {
  return {
    projectId: item.projectId,
    scannedAt: item.scannedAt,
    status: item.status,
    manifest: item.manifest,
    commit: item.commit,
    durationMs: item.durationMs,
    counts: item.counts,
    findingCount: item.findingCount,
  };
}

export function toPackageUsage(item: PackageIndexItem): PackageUsage {
  return {
    orgId: item.orgId,
    projectId: item.projectId,
    lastSeen: item.lastSeen,
  };
}

/**
 * Attributes a scan *summary* needs — used as a DynamoDB `ProjectionExpression`.
 *
 * The history query (access pattern 2) must never pull `findings`: a scan
 * document can approach 400KB, and the drift chart only needs `counts`.
 * Projecting keeps the read charge proportional to what the screen displays
 * rather than to the size of the findings arrays it ignores.
 */
export const SCAN_SUMMARY_ATTRIBUTES = [
  'type',
  'projectId',
  'scannedAt',
  'status',
  'manifest',
  'commit',
  'durationMs',
  'counts',
  'findingCount',
] as const;
