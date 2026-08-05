import type { Finding } from '@config-scanner/shared-types';
import type { PackageIndexItem } from '../dynamo/items';
import {
  PACKAGE_INDEX_TTL_DAYS,
  packageIndexGsi1,
  packageIndexKey,
  ttlFrom,
} from '../dynamo/keys';

/**
 * Index rows for the packages a scan found problems in — and only those
 * (SPEC.md §198).
 *
 * This is the single most important efficiency decision in the model. A lockfile
 * resolves ~800 packages; writing an index row for each on every scan would be
 * ~800 writes to answer a question that is only ever asked about vulnerable
 * packages. Indexing findings instead makes the write cost proportional to the
 * problems found, which is a number that stays small if the product works.
 *
 * De-duplicated by `name@version`: two advisories against one package are two
 * findings but one dependency, and blast radius is a question about the
 * dependency.
 *
 * A free function in its own module rather than a method: it is pure, the seed
 * script needs it too, and keeping it out of the service file means neither of
 * them has to load the other's dependencies.
 */
export function packageIndexRows(
  orgId: string,
  projectId: string,
  findings: readonly Finding[],
  scannedAt: Date,
): PackageIndexItem[] {
  const rows = new Map<string, PackageIndexItem>();
  const lastSeen = scannedAt.toISOString().slice(0, 10);
  const ttl = ttlFrom(scannedAt, PACKAGE_INDEX_TTL_DAYS);

  for (const finding of findings) {
    // Only the npm finding kinds identify a package version. Terraform and
    // Dockerfile findings are about a file, and there is nothing to index.
    if (finding.kind !== 'npm_cve' && finding.kind !== 'npm_supply_chain') {
      continue;
    }

    const key = `${finding.package}@${finding.version}`;
    if (rows.has(key)) continue;

    rows.set(key, {
      ...packageIndexKey(projectId, finding.package, finding.version),
      ...packageIndexGsi1(projectId, finding.package, finding.version),
      type: 'pkgIndex',
      orgId,
      projectId,
      name: finding.package,
      version: finding.version,
      lastSeen,
      ttl,
    });
  }

  return [...rows.values()];
}
