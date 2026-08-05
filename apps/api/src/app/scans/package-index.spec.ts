import type { Finding } from '@config-scanner/shared-types';
import { PACKAGE_INDEX_TTL_DAYS, ttlFrom } from '../dynamo/keys';
import { packageIndexRows } from './package-index';

const SCANNED_AT = new Date('2026-07-24T09:00:00.000Z');

function cve(pkg: string, version: string, id: string): Finding {
  return {
    kind: 'npm_cve',
    severity: 'high',
    package: pkg,
    version,
    cve: id,
    fixedIn: null,
    path: ['root', pkg],
  };
}

describe('packageIndexRows', () => {
  it('indexes only packages that produced a finding', () => {
    // The efficiency decision the model turns on (SPEC.md §198): a lockfile
    // resolves ~800 packages, and none of the clean ones get a row.
    const rows = packageIndexRows(
      'acme',
      'api-gateway',
      [cve('lodash', '4.17.20', 'CVE-2021-23337')],
      SCANNED_AT,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      PK: 'PROJECT#api-gateway',
      SK: 'PKG#lodash@4.17.20',
      GSI1PK: 'PKG#lodash@4.17.20',
      GSI1SK: 'PROJECT#api-gateway',
      type: 'pkgIndex',
      orgId: 'acme',
      name: 'lodash',
      version: '4.17.20',
    });
  });

  it('writes one row per package version, not per finding', () => {
    const rows = packageIndexRows(
      'acme',
      'api-gateway',
      [
        cve('lodash', '4.17.20', 'CVE-2021-23337'),
        cve('lodash', '4.17.20', 'CVE-2020-8203'),
      ],
      SCANNED_AT,
    );

    expect(rows).toHaveLength(1);
  });

  it('keeps different versions of the same package apart', () => {
    const rows = packageIndexRows(
      'acme',
      'api-gateway',
      [cve('lodash', '4.17.20', 'CVE-1'), cve('lodash', '4.17.15', 'CVE-1')],
      SCANNED_AT,
    );

    expect(rows.map((row) => row.SK)).toEqual([
      'PKG#lodash@4.17.20',
      'PKG#lodash@4.17.15',
    ]);
  });

  it('indexes off-registry dependencies too', () => {
    const rows = packageIndexRows(
      'acme',
      'api-gateway',
      [
        {
          kind: 'npm_supply_chain',
          severity: 'medium',
          package: 'internal-utils',
          version: '1.0.0',
          rule: 'NPM-SRC-001',
          message: 'resolved from git',
          resolved: 'git+ssh://git@github.com/acme/internal-utils.git',
        },
      ],
      SCANNED_AT,
    );

    expect(rows[0].SK).toBe('PKG#internal-utils@1.0.0');
  });

  it('ignores findings that are not about a package', () => {
    // Terraform and Dockerfile findings are about a file. Blast radius asks
    // "who else has this package version", so there is nothing to index.
    const rows = packageIndexRows(
      'acme',
      'api-gateway',
      [
        {
          kind: 'terraform_misconfig',
          severity: 'critical',
          resource: 'aws_s3_bucket.logs',
          rule: 'S3-001',
          message: 'public read access enabled',
          file: 'main.tf',
          line: 42,
        },
      ],
      SCANNED_AT,
    );

    expect(rows).toEqual([]);
  });

  it('stamps lastSeen and a 90-day TTL from the scan time', () => {
    const [row] = packageIndexRows(
      'acme',
      'api-gateway',
      [cve('lodash', '4.17.20', 'CVE-1')],
      SCANNED_AT,
    );

    expect(row.lastSeen).toBe('2026-07-24');
    expect(row.ttl).toBe(ttlFrom(SCANNED_AT, PACKAGE_INDEX_TTL_DAYS));
  });
});
