import type { Finding } from './finding';
import type { SeverityCounts } from './severity';

/**
 * Manifest kinds the scanner understands.
 *
 * v1 implements `package-lock.json` only (SPEC.md §266 — "rule engine over one
 * manifest type"). The other two are declared because the finding union already
 * models them and the seed data exercises them; the parsers arrive later.
 */
export const MANIFEST_TYPES = [
  'package-lock.json',
  'terraform',
  'dockerfile',
] as const;

export type ManifestType = (typeof MANIFEST_TYPES)[number];

export type ScanStatus = 'completed' | 'failed';

/**
 * A scan without its findings — the shape the history list and the drift chart
 * read (SPEC.md §118, access pattern 2).
 *
 * `counts` is stored denormalised on the item precisely so those two screens
 * never have to open `findings`, which is the expensive part of the document.
 */
export interface ScanSummary {
  projectId: string;
  /** ISO-8601, and also the `SCAN#<timestamp>` sort key suffix. */
  scannedAt: string;
  status: ScanStatus;
  manifest: ManifestType;
  /** Commit the manifest came from, when the uploader supplied one. */
  commit: string | null;
  durationMs: number;
  counts: SeverityCounts;
  findingCount: number;
}

/**
 * A scan with its findings (SPEC.md §119, access pattern 3).
 *
 * `findingsExternal` reports whether the findings were small enough to live
 * inside the DynamoDB item or had to spill to object storage (SPEC.md §165).
 * Either way `findings` is populated — where the bytes live is a storage
 * decision, and resolving the reference is the API's job, not the client's. The
 * flag is exposed only so the escape hatch is observable rather than folklore.
 */
export interface ScanDetail extends ScanSummary {
  findings: Finding[];
  findingsExternal: boolean;
}

/** Response of `GET /api/projects/:id/scans` (SPEC.md §222). Newest first. */
export interface ListScansResponse {
  scans: ScanSummary[];
}

/** Response of `GET /api/projects/:id/scans/latest` (SPEC.md §223). */
export interface LatestScanResponse {
  /** Null when the project exists but has never been scanned. */
  scan: ScanSummary | null;
}

/** Response of `GET /api/scans/:projectId/:timestamp` (SPEC.md §224). */
export interface ScanDetailResponse {
  scan: ScanDetail;
}

/**
 * Non-file fields of the `POST /api/projects/:id/scans` multipart body
 * (SPEC.md §225). The manifest itself is the uploaded file, not a field.
 */
export interface CreateScanRequest {
  /** Optional commit SHA the manifest was taken from. */
  commit?: string;
}

/** Response of `POST /api/projects/:id/scans`. */
export interface CreateScanResponse {
  scan: ScanDetail;
}
