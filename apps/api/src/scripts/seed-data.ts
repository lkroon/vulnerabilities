import type { Finding, SeverityCounts } from '@config-scanner/shared-types';
import { countBySeverity } from '@config-scanner/shared-types';

/**
 * Seed fixtures for local development (SPEC.md §268).
 *
 * Two things are deliberate here.
 *
 * **The findings are heterogeneous.** npm CVEs, an off-registry dependency, a
 * Terraform misconfiguration and Dockerfile lint failures share almost no
 * fields, and they sit in one array inside one item. That is the argument for a
 * document model made visible rather than asserted (SPEC.md §187). The Terraform
 * and Dockerfile findings cannot be *produced* yet — v1 scans lockfiles only —
 * so the seed is where they come from.
 *
 * **One scan spills.** `api-gateway`'s oldest scan carries enough findings to
 * exceed the inline limit, so the `findingsRef` escape hatch is exercised by the
 * seed rather than merely described (SPEC.md §196).
 */

export interface SeedProject {
  projectId: string;
  name: string;
  repo: string;
  defaultBranch: string;
  scans: SeedScan[];
}

export interface SeedScan {
  scannedAt: string;
  commit: string;
  durationMs: number;
  findings: Finding[];
}

export const SEED_ORG = 'acme';

function cve(
  pkg: string,
  version: string,
  id: string,
  severity: Finding['severity'],
  fixedIn: string | null,
  path: string[],
): Finding {
  return {
    kind: 'npm_cve',
    severity,
    package: pkg,
    version,
    cve: id,
    fixedIn,
    path,
  };
}

/**
 * The current state of `api-gateway`: 1 critical, 3 high, 7 medium, 2 low.
 *
 * The counts are chosen, not generated — the projects screen and its e2e test
 * assert on them, and a fixture whose numbers drift every time the advisory list
 * changes makes those tests worthless.
 */
const API_GATEWAY_LATEST: Finding[] = [
  {
    kind: 'terraform_misconfig',
    severity: 'critical',
    resource: 'aws_s3_bucket.logs',
    rule: 'S3-001',
    message: 'public read access enabled',
    file: 'modules/logging/main.tf',
    line: 42,
  },
  cve('lodash', '4.17.20', 'CVE-2021-23337', 'high', '4.17.21', [
    'api-gateway',
    'express-openapi',
    'lodash',
  ]),
  cve('braces', '3.0.2', 'CVE-2024-4068', 'high', '3.0.3', [
    'api-gateway',
    'chokidar',
    'braces',
  ]),
  cve('cross-spawn', '7.0.3', 'CVE-2024-21538', 'high', '7.0.5', [
    'api-gateway',
    'execa',
    'cross-spawn',
  ]),
  cve('express', '4.19.2', 'CVE-2024-43796', 'medium', '4.20.0', [
    'api-gateway',
    'express',
  ]),
  cve('semver', '7.5.1', 'CVE-2022-25883', 'medium', '7.5.2', [
    'api-gateway',
    'npm-check',
    'semver',
  ]),
  cve('micromatch', '4.0.5', 'CVE-2024-4067', 'medium', '4.0.8', [
    'api-gateway',
    'chokidar',
    'micromatch',
  ]),
  {
    kind: 'npm_supply_chain',
    severity: 'medium',
    package: 'acme-internal-utils',
    version: '1.4.0',
    rule: 'NPM-SRC-001',
    message:
      'Resolved from a local path or git reference rather than the public npm registry',
    resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
  },
  {
    kind: 'terraform_misconfig',
    severity: 'medium',
    resource: 'aws_s3_bucket.logs',
    rule: 'S3-002',
    message: 'versioning is not enabled',
    file: 'modules/logging/main.tf',
    line: 48,
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
    kind: 'dockerfile',
    severity: 'medium',
    rule: 'DL3008',
    message: 'pin versions in apt-get install',
    file: 'Dockerfile',
    line: 9,
  },
  cve('cookie', '0.6.0', 'CVE-2024-47764', 'low', '0.7.0', [
    'api-gateway',
    'express',
    'cookie',
  ]),
  {
    kind: 'dockerfile',
    severity: 'low',
    rule: 'DL3007',
    message: 'using latest is prone to errors — pin the tag',
    file: 'Dockerfile',
    line: 1,
  },
];

/** The same project two scans ago — worse, so the drift chart has a slope. */
const API_GATEWAY_PREVIOUS: Finding[] = [
  ...API_GATEWAY_LATEST,
  cve('minimist', '1.2.5', 'CVE-2021-44906', 'critical', '1.2.6', [
    'api-gateway',
    'mkdirp',
    'minimist',
  ]),
  cve('ws', '8.11.0', 'CVE-2024-37890', 'high', '8.17.1', [
    'api-gateway',
    'ws',
  ]),
  cve('tar', '6.1.11', 'CVE-2024-28863', 'medium', '6.2.1', [
    'api-gateway',
    'node-gyp',
    'tar',
  ]),
  cve('body-parser', '1.20.2', 'CVE-2024-45590', 'high', '1.20.3', [
    'api-gateway',
    'express',
    'body-parser',
  ]),
  cve('path-to-regexp', '0.1.7', 'CVE-2024-45296', 'high', '0.1.10', [
    'api-gateway',
    'express',
    'path-to-regexp',
  ]),
  cve('send', '0.18.0', 'CVE-2024-43799', 'medium', '0.19.0', [
    'api-gateway',
    'express',
    'send',
  ]),
];

/**
 * A scan large enough to spill out of its DynamoDB item.
 *
 * Generated rather than written by hand: what is being demonstrated is a size
 * threshold, and 900 findings is what it takes to cross it. The shape is
 * realistic — a first scan of an untended service, before anyone started fixing
 * things.
 */
function generateOversizedFindings(count: number): Finding[] {
  const severities: Finding['severity'][] = [
    'critical',
    'high',
    'medium',
    'low',
  ];

  return Array.from({ length: count }, (_, index) =>
    cve(
      `legacy-transitive-package-${index}`,
      `1.${index % 20}.${index % 7}`,
      `CVE-2019-${10000 + index}`,
      severities[index % severities.length],
      `1.${index % 20}.${(index % 7) + 1}`,
      ['api-gateway', 'legacy-bundle', `legacy-transitive-package-${index}`],
    ),
  );
}

const BILLING_LATEST: Finding[] = [
  cve('semver', '7.5.1', 'CVE-2022-25883', 'medium', '7.5.2', [
    'billing-worker',
    'semver',
  ]),
  cve('micromatch', '4.0.5', 'CVE-2024-4067', 'medium', '4.0.8', [
    'billing-worker',
    'micromatch',
  ]),
  cve('cookie', '0.6.0', 'CVE-2024-47764', 'low', '0.7.0', [
    'billing-worker',
    'express',
    'cookie',
  ]),
  {
    kind: 'dockerfile',
    severity: 'low',
    rule: 'DL3007',
    message: 'using latest is prone to errors — pin the tag',
    file: 'Dockerfile',
    line: 1,
  },
  {
    kind: 'dockerfile',
    severity: 'low',
    rule: 'DL3009',
    message: 'delete the apt-get lists after installing',
    file: 'Dockerfile',
    line: 11,
  },
  {
    kind: 'terraform_misconfig',
    severity: 'low',
    resource: 'aws_sqs_queue.billing',
    rule: 'SQS-003',
    message: 'no dead-letter queue configured',
    file: 'modules/billing/main.tf',
    line: 22,
  },
  {
    kind: 'terraform_misconfig',
    severity: 'low',
    resource: 'aws_cloudwatch_log_group.billing',
    rule: 'LOG-001',
    message: 'retention is unset — logs are kept forever',
    file: 'modules/billing/main.tf',
    line: 31,
  },
];

const BILLING_PREVIOUS: Finding[] = [
  ...BILLING_LATEST,
  cve('minimist', '1.2.5', 'CVE-2021-44906', 'critical', '1.2.6', [
    'billing-worker',
    'minimist',
  ]),
  cve('lodash', '4.17.20', 'CVE-2021-23337', 'high', '4.17.21', [
    'billing-worker',
    'lodash',
  ]),
  cve('axios', '1.7.9', 'CVE-2025-27152', 'high', '1.8.2', [
    'billing-worker',
    'axios',
  ]),
  cve('tar', '6.1.11', 'CVE-2024-28863', 'medium', '6.2.1', [
    'billing-worker',
    'node-gyp',
    'tar',
  ]),
];

export const SEED_PROJECTS: SeedProject[] = [
  {
    projectId: 'api-gateway',
    name: 'API Gateway',
    repo: 'acme/api-gateway',
    defaultBranch: 'main',
    scans: [
      {
        scannedAt: '2026-05-02T08:15:00.000Z',
        commit: '9d41b0c',
        durationMs: 18240,
        findings: generateOversizedFindings(900),
      },
      {
        scannedAt: '2026-06-18T11:20:00.000Z',
        commit: 'c81f5ea',
        durationMs: 5310,
        findings: API_GATEWAY_PREVIOUS,
      },
      {
        scannedAt: '2026-07-24T09:00:00.000Z',
        commit: 'a3f19c2',
        durationMs: 4210,
        findings: API_GATEWAY_LATEST,
      },
    ],
  },
  {
    projectId: 'billing-worker',
    name: 'Billing Worker',
    repo: 'acme/billing-worker',
    defaultBranch: 'main',
    scans: [
      {
        scannedAt: '2026-06-30T09:45:00.000Z',
        commit: '4b7c118',
        durationMs: 3980,
        findings: BILLING_PREVIOUS,
      },
      {
        scannedAt: '2026-07-25T16:30:00.000Z',
        commit: '77ae0d3',
        durationMs: 2870,
        findings: BILLING_LATEST,
      },
    ],
  },
  {
    // Registered but never scanned. The projects screen distinguishes this from
    // a clean project, and that distinction has an e2e test.
    projectId: 'infra-terraform',
    name: 'Infrastructure',
    repo: 'acme/infra-terraform',
    defaultBranch: 'main',
    scans: [],
  },
];

/** Counts for a seeded scan, computed the same way the API computes them. */
export function seedCounts(scan: SeedScan): SeverityCounts {
  return countBySeverity(scan.findings);
}
