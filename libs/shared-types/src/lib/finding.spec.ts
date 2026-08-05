import { countBySeverity, type Finding } from './finding';
import { EMPTY_SEVERITY_COUNTS } from './severity';

const FINDINGS: Finding[] = [
  {
    kind: 'npm_cve',
    severity: 'high',
    package: 'lodash',
    version: '4.17.20',
    cve: 'CVE-2021-23337',
    fixedIn: '4.17.21',
    path: ['app', 'express', 'lodash'],
  },
  {
    kind: 'terraform_misconfig',
    severity: 'critical',
    resource: 'aws_s3_bucket.logs',
    rule: 'S3-001',
    message: 'public read access enabled',
    file: 'modules/logging/main.tf',
    line: 42,
  },
  {
    kind: 'dockerfile',
    severity: 'medium',
    rule: 'DL3002',
    message: 'last USER should not be root',
    file: 'Dockerfile',
    line: 18,
  },
  {
    kind: 'npm_supply_chain',
    severity: 'medium',
    package: 'internal-utils',
    version: '1.0.0',
    rule: 'NPM-SRC-001',
    message: 'resolved from a git URL rather than the registry',
    resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
  },
];

describe('countBySeverity', () => {
  it('counts each severity across mixed finding kinds', () => {
    expect(countBySeverity(FINDINGS)).toEqual({
      critical: 1,
      high: 1,
      medium: 2,
      low: 0,
    });
  });

  it('returns zeroes for no findings', () => {
    expect(countBySeverity([])).toEqual(EMPTY_SEVERITY_COUNTS);
  });

  it('does not mutate the shared empty-counts constant', () => {
    countBySeverity(FINDINGS);
    expect(EMPTY_SEVERITY_COUNTS).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it('narrows on kind without casting', () => {
    // The point of the discriminated union: this compiles only because `kind`
    // narrows the member, and it stops compiling if a member loses a field.
    const described = FINDINGS.map((finding) => {
      switch (finding.kind) {
        case 'npm_cve':
          return `${finding.package}@${finding.version} ${finding.cve}`;
        case 'npm_supply_chain':
          return `${finding.package}@${finding.version} ${finding.rule}`;
        case 'terraform_misconfig':
          return `${finding.resource} ${finding.rule}`;
        case 'dockerfile':
          return `${finding.file}:${finding.line} ${finding.rule}`;
      }
    });

    expect(described).toEqual([
      'lodash@4.17.20 CVE-2021-23337',
      'aws_s3_bucket.logs S3-001',
      'Dockerfile:18 DL3002',
      'internal-utils@1.0.0 NPM-SRC-001',
    ]);
  });
});
