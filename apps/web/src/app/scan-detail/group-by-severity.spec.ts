import type { Finding } from '@config-scanner/shared-types';
import { groupBySeverity } from './group-by-severity';

function finding(
  kind: Finding['kind'],
  severity: Finding['severity'],
): Finding {
  switch (kind) {
    case 'npm_cve':
      return { kind, severity, package: 'lodash', version: '4.17.20', cve: 'CVE-2021-23337', fixedIn: null, path: ['api-gateway', 'lodash'] };
    case 'npm_supply_chain':
      return { kind, severity, package: 'acme-internal-utils', version: '1.4.0', rule: 'NPM-SRC-001', message: 'resolved from git', resolved: 'git+ssh://git@example.com/x.git' };
    case 'terraform_misconfig':
      return { kind, severity, resource: 'aws_s3_bucket.logs', rule: 'S3-001', message: 'public read', file: 'main.tf', line: 42 };
    case 'dockerfile':
      return { kind, severity, rule: 'DL3007', message: 'using latest', file: 'Dockerfile', line: 1 };
  }
}

describe('groupBySeverity', () => {
  it('returns one group per severity in SEVERITIES order (critical → low)', () => {
    const groups = groupBySeverity([
      finding('npm_cve', 'low'),
      finding('npm_cve', 'high'),
      finding('dockerfile', 'critical'),
    ]);

    expect(groups.map((g) => g.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
    expect(groups[0].findings).toHaveLength(1);
    expect(groups[1].findings).toHaveLength(1);
    expect(groups[2].findings).toHaveLength(0);
    expect(groups[3].findings).toHaveLength(1);
  });

  it('preserves input order within a group', () => {
    const first = finding('npm_cve', 'high');
    const second = finding('terraform_misconfig', 'high');
    const groups = groupBySeverity([second, first]);

    expect(groups[1].findings).toEqual([second, first]);
  });

  it('returns all-empty groups for no findings', () => {
    const groups = groupBySeverity([]);

    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.findings.length === 0)).toBe(true);
  });
});
