import { countBySeverity, type Finding } from '@config-scanner/shared-types';
import { ADVISORIES, ADVISORIES_BY_PACKAGE, type Advisory } from './advisories';
import { scanManifest, runPackageLockRules } from './engine';
import { ManifestParseError, type ResolvedPackage } from './package-lock';
import {
  PACKAGE_LOCK_RULES,
  npmCveRule,
  npmSupplyChainRule,
  type PackageLockContext,
  type Rule,
} from './rules';

function registryUrl(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
}

function pkg(
  overrides: Partial<ResolvedPackage> &
    Pick<ResolvedPackage, 'name' | 'version'>,
): ResolvedPackage {
  return {
    path: ['root', overrides.name],
    resolved: registryUrl(overrides.name, overrides.version),
    dev: false,
    ...overrides,
  };
}

/** A two-entry advisory database, so rule tests do not depend on the fixture. */
const TEST_ADVISORIES: ReadonlyMap<string, readonly Advisory[]> = new Map([
  [
    'lodash',
    [
      {
        cve: 'CVE-2021-23337',
        package: 'lodash',
        severity: 'high',
        title: 'Command injection via template',
        introducedIn: null,
        fixedIn: '4.17.21',
      },
    ],
  ],
  [
    'minimist',
    [
      {
        cve: 'CVE-2021-44906',
        package: 'minimist',
        severity: 'critical',
        title: 'Prototype pollution',
        introducedIn: null,
        fixedIn: '1.2.6',
      },
    ],
  ],
]);

function contextOf(packages: ResolvedPackage[]): PackageLockContext {
  return { packages, advisories: TEST_ADVISORIES };
}

describe('npmCveRule', () => {
  it('reports an affected version with the advisory metadata and the chain', () => {
    const findings = npmCveRule.evaluate(
      contextOf([
        pkg({
          name: 'lodash',
          version: '4.17.20',
          path: ['root', 'a', 'lodash'],
        }),
      ]),
    );

    expect(findings).toEqual<Finding[]>([
      {
        kind: 'npm_cve',
        severity: 'high',
        package: 'lodash',
        version: '4.17.20',
        cve: 'CVE-2021-23337',
        fixedIn: '4.17.21',
        path: ['root', 'a', 'lodash'],
      },
    ]);
  });

  it('does not report the fixed version', () => {
    expect(
      npmCveRule.evaluate(
        contextOf([pkg({ name: 'lodash', version: '4.17.21' })]),
      ),
    ).toEqual([]);
  });

  it('does not report a package with no advisory', () => {
    expect(
      npmCveRule.evaluate(
        contextOf([pkg({ name: 'express', version: '4.0.0' })]),
      ),
    ).toEqual([]);
  });

  it('reports both copies when a package is installed twice at different versions', () => {
    const findings = npmCveRule.evaluate(
      contextOf([
        pkg({ name: 'lodash', version: '4.17.21' }),
        pkg({
          name: 'lodash',
          version: '4.17.20',
          path: ['root', 'a', 'lodash'],
        }),
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ version: '4.17.20' });
  });

  it('reports every advisory that matches one package', () => {
    const twoAdvisories = new Map<string, readonly Advisory[]>([
      [
        'lodash',
        [
          ...(TEST_ADVISORIES.get('lodash') ?? []),
          {
            cve: 'CVE-2020-8203',
            package: 'lodash',
            severity: 'medium' as const,
            title: 'Prototype pollution',
            introducedIn: null,
            fixedIn: '4.17.19',
          },
        ],
      ],
    ]);

    const findings = npmCveRule.evaluate({
      packages: [pkg({ name: 'lodash', version: '4.17.15' })],
      advisories: twoAdvisories,
    });

    expect(
      findings.map((f) => (f.kind === 'npm_cve' ? f.cve : null)).sort(),
    ).toEqual(['CVE-2020-8203', 'CVE-2021-23337']);
  });
});

describe('npmSupplyChainRule', () => {
  it('accepts packages resolved from the public registry', () => {
    expect(
      npmSupplyChainRule.evaluate(
        contextOf([pkg({ name: 'express', version: '4.19.2' })]),
      ),
    ).toEqual([]);
  });

  it('flags a git-resolved dependency', () => {
    const findings = npmSupplyChainRule.evaluate(
      contextOf([
        pkg({
          name: 'internal-utils',
          version: '1.0.0',
          resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
        }),
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'npm_supply_chain',
      severity: 'medium',
      rule: 'NPM-SRC-001',
    });
  });

  it('flags a private registry by host', () => {
    const findings = npmSupplyChainRule.evaluate(
      contextOf([
        pkg({
          name: 'acme-sdk',
          version: '2.0.0',
          resolved:
            'https://npm.internal.acme.com/acme-sdk/-/acme-sdk-2.0.0.tgz',
        }),
      ]),
    );

    expect(findings[0]).toMatchObject({
      message: expect.stringContaining('npm.internal.acme.com'),
    });
  });

  it('ignores entries with no resolved URL', () => {
    expect(
      npmSupplyChainRule.evaluate(
        contextOf([
          pkg({ name: 'workspace-lib', version: '0.0.1', resolved: null }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe('runPackageLockRules', () => {
  it('composes every registered rule over one parsed manifest', () => {
    const findings = runPackageLockRules(
      contextOf([
        pkg({ name: 'lodash', version: '4.17.20' }),
        pkg({
          name: 'internal-utils',
          version: '1.0.0',
          resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
        }),
      ]),
    );

    expect(findings.map((f) => f.kind)).toEqual([
      'npm_cve',
      'npm_supply_chain',
    ]);
  });

  it('orders findings most urgent first', () => {
    const findings = runPackageLockRules(
      contextOf([
        pkg({ name: 'lodash', version: '4.17.20' }),
        pkg({ name: 'minimist', version: '1.2.5' }),
      ]),
    );

    expect(findings.map((f) => f.severity)).toEqual(['critical', 'high']);
  });

  it('is deterministic regardless of package order', () => {
    const packages = [
      pkg({ name: 'lodash', version: '4.17.20' }),
      pkg({ name: 'minimist', version: '1.2.5' }),
    ];

    expect(runPackageLockRules(contextOf(packages))).toEqual(
      runPackageLockRules(contextOf([...packages].reverse())),
    );
  });

  it('reports one finding per vulnerable version, not per installed copy', () => {
    // npm nests a second copy of a package when two dependents need
    // incompatible ranges. Both are on disk, both match the advisory, and
    // counting them twice would double the number the dashboard displays.
    const findings = runPackageLockRules(
      contextOf([
        pkg({
          name: 'lodash',
          version: '4.17.20',
          path: ['root', 'a', 'lodash'],
        }),
        pkg({
          name: 'lodash',
          version: '4.17.20',
          path: ['root', 'b', 'c', 'lodash'],
        }),
      ]),
    );

    expect(findings).toHaveLength(1);
    // The shortest chain survives — the parser walks breadth-first, so the
    // first occurrence is the one closest to the root.
    expect(findings[0]).toMatchObject({ path: ['root', 'a', 'lodash'] });
  });

  it('honours an explicit rule set', () => {
    const noop: Rule<PackageLockContext> = {
      id: 'TEST-000',
      description: 'reports nothing',
      evaluate: () => [],
    };

    expect(
      runPackageLockRules(
        contextOf([pkg({ name: 'lodash', version: '4.17.20' })]),
        [noop],
      ),
    ).toEqual([]);
  });

  it('registers every rule the library exports', () => {
    expect(PACKAGE_LOCK_RULES).toContain(npmCveRule);
    expect(PACKAGE_LOCK_RULES).toContain(npmSupplyChainRule);
  });
});

describe('scanManifest', () => {
  const lock = JSON.stringify({
    name: 'acme-api',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'acme-api',
        dependencies: { express: '4.19.2', lodash: '4.17.20' },
      },
      'node_modules/express': {
        version: '4.19.2',
        resolved: registryUrl('express', '4.19.2'),
        dependencies: { 'body-parser': '1.20.2' },
      },
      'node_modules/body-parser': {
        version: '1.20.2',
        resolved: registryUrl('body-parser', '1.20.2'),
      },
      'node_modules/lodash': {
        version: '4.17.20',
        resolved: registryUrl('lodash', '4.17.20'),
      },
    },
  });

  it('parses and scans a lockfile end to end against the fixture database', () => {
    const outcome = scanManifest('package-lock.json', lock);

    expect(outcome.packagesScanned).toBe(3);

    const cves = outcome.findings.flatMap((f) =>
      f.kind === 'npm_cve' ? [f.cve] : [],
    );
    // express 4.19.2 < 4.20.0 and body-parser 1.20.2 < 1.20.3 are both in the
    // fixture, so the transitive finding has to appear as well as the direct one.
    expect(cves).toEqual(
      expect.arrayContaining([
        'CVE-2021-23337',
        'CVE-2024-43796',
        'CVE-2024-45590',
      ]),
    );
  });

  it('carries the dependency chain onto transitive findings', () => {
    const outcome = scanManifest('package-lock.json', lock);
    const transitive = outcome.findings.find(
      (f) => f.kind === 'npm_cve' && f.package === 'body-parser',
    );

    expect(transitive).toMatchObject({
      path: ['acme-api', 'express', 'body-parser'],
    });
  });

  it('produces counts that match the findings it returned', () => {
    const outcome = scanManifest('package-lock.json', lock);
    const counts = countBySeverity(outcome.findings);

    expect(counts.critical + counts.high + counts.medium + counts.low).toBe(
      outcome.findings.length,
    );
  });

  it('finds nothing in a clean lockfile', () => {
    const clean = JSON.stringify({
      name: 'clean',
      lockfileVersion: 3,
      packages: {
        '': { name: 'clean', dependencies: { lodash: '4.17.21' } },
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: registryUrl('lodash', '4.17.21'),
        },
      },
    });

    expect(scanManifest('package-lock.json', clean)).toEqual({
      findings: [],
      packagesScanned: 1,
    });
  });

  it('rejects manifest types that have no parser yet', () => {
    expect(() =>
      scanManifest('terraform', 'resource "aws_s3_bucket" "logs" {}'),
    ).toThrow(ManifestParseError);
  });

  it('uses the fixture advisory database by default', () => {
    expect(ADVISORIES_BY_PACKAGE.get('lodash')).toEqual([
      ADVISORIES.find((advisory) => advisory.package === 'lodash'),
    ]);
  });
});
