import type { Finding } from '@config-scanner/shared-types';

/**
 * Where findings live when they are too big for the DynamoDB item.
 *
 * DynamoDB caps an item at 400KB (SPEC.md §194). A scan of a large monorepo can
 * produce thousands of findings, so the model needs an escape hatch: write the
 * array to object storage and keep a reference on the item. The scan summary —
 * counts, timestamp, status — always stays in DynamoDB, because that is what
 * every list and chart reads and it must stay queryable.
 *
 * The interface exists so M4 can swap the local filesystem implementation for S3
 * without the scan service knowing. Two methods, both about bytes: any storage
 * that can hold a JSON blob under a key satisfies it.
 */
export interface FindingsStore {
  put(key: string, findings: readonly Finding[]): Promise<void>;
  get(key: string): Promise<Finding[]>;
}

/** Nest injection token — an interface has no runtime identity to inject by. */
export const FINDINGS_STORE = 'FINDINGS_STORE';

/**
 * Spill threshold, in bytes of serialised findings.
 *
 * Well below the 400KB item limit on purpose. The limit applies to the *whole*
 * item — keys, attribute names, counts, and DynamoDB's own per-attribute
 * overhead — and the document client's encoding is larger than the raw JSON
 * measured here. 128KB leaves room for all of it and still keeps the common case
 * (a handful of findings) inside the item, where it costs one read instead of
 * two.
 */
export const MAX_INLINE_FINDINGS_BYTES = 128 * 1024;

/** The object key a scan's spilled findings are written to. */
export function findingsKey(projectId: string, scannedAt: string): string {
  return `scans/${projectId}/${scannedAt}.json`;
}

/** Does this findings array have to spill out of the item? */
export function exceedsInlineLimit(findings: readonly Finding[]): boolean {
  return (
    Buffer.byteLength(JSON.stringify(findings), 'utf8') >
    MAX_INLINE_FINDINGS_BYTES
  );
}
