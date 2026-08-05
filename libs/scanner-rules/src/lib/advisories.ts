import type { Severity } from '@config-scanner/shared-types';
import type { AffectedRange } from './version';

/**
 * One advisory in the fixture database.
 *
 * Shaped after a GitHub Advisory Database record so the fixture can be replaced
 * by a real feed without the rule changing: the rule already asks the questions
 * a feed answers.
 */
export interface Advisory extends AffectedRange {
  cve: string;
  package: string;
  severity: Severity;
  title: string;
}

/**
 * Static CVE fixture (SPEC.md §41 — explicitly not a live feed).
 *
 * These are real advisories against real packages, snapshotted rather than
 * fetched. The reason is scope, not laziness: a live feed means an ingestion
 * pipeline, a cache, a rate limit and a staleness policy, none of which
 * demonstrate anything the rule engine does not already demonstrate. The
 * README records it as a known limitation.
 *
 * The lower bound is `null` where the advisory covers every published version
 * below the fix, which is the common case.
 */
export const ADVISORIES: readonly Advisory[] = [
  {
    cve: 'CVE-2021-23337',
    package: 'lodash',
    severity: 'high',
    title: 'Command injection via template',
    introducedIn: null,
    fixedIn: '4.17.21',
  },
  {
    cve: 'CVE-2021-44906',
    package: 'minimist',
    severity: 'critical',
    title: 'Prototype pollution',
    introducedIn: null,
    fixedIn: '1.2.6',
  },
  {
    cve: 'CVE-2022-25883',
    package: 'semver',
    severity: 'medium',
    title: 'Regular expression denial of service in range parsing',
    introducedIn: null,
    fixedIn: '7.5.2',
  },
  {
    cve: 'CVE-2024-4068',
    package: 'braces',
    severity: 'high',
    title: 'Uncontrolled resource consumption',
    introducedIn: null,
    fixedIn: '3.0.3',
  },
  {
    cve: 'CVE-2024-4067',
    package: 'micromatch',
    severity: 'medium',
    title: 'Regular expression denial of service',
    introducedIn: null,
    fixedIn: '4.0.8',
  },
  {
    cve: 'CVE-2024-37890',
    package: 'ws',
    severity: 'high',
    title: 'Denial of service when handling a request with many HTTP headers',
    introducedIn: '8.0.0',
    fixedIn: '8.17.1',
  },
  {
    cve: 'CVE-2024-45296',
    package: 'path-to-regexp',
    severity: 'high',
    title: 'Backtracking regular expression',
    introducedIn: null,
    fixedIn: '0.1.10',
  },
  {
    cve: 'CVE-2024-45590',
    package: 'body-parser',
    severity: 'high',
    title: 'Denial of service via URL-encoded payload',
    introducedIn: null,
    fixedIn: '1.20.3',
  },
  {
    cve: 'CVE-2024-43799',
    package: 'send',
    severity: 'medium',
    title: 'Template injection leading to XSS',
    introducedIn: null,
    fixedIn: '0.19.0',
  },
  {
    cve: 'CVE-2024-43800',
    package: 'serve-static',
    severity: 'medium',
    title: 'Template injection leading to XSS',
    introducedIn: null,
    fixedIn: '1.16.0',
  },
  {
    cve: 'CVE-2024-43796',
    package: 'express',
    severity: 'medium',
    title: 'XSS via response.redirect',
    introducedIn: null,
    fixedIn: '4.20.0',
  },
  {
    cve: 'CVE-2024-21538',
    package: 'cross-spawn',
    severity: 'high',
    title: 'Regular expression denial of service',
    introducedIn: null,
    fixedIn: '7.0.5',
  },
  {
    cve: 'CVE-2024-47764',
    package: 'cookie',
    severity: 'low',
    title: 'Out-of-bounds character acceptance in cookie name',
    introducedIn: null,
    fixedIn: '0.7.0',
  },
  {
    cve: 'CVE-2024-28863',
    package: 'tar',
    severity: 'medium',
    title: 'Denial of service while parsing a malicious tar file',
    introducedIn: null,
    fixedIn: '6.2.1',
  },
  {
    cve: 'CVE-2025-27152',
    package: 'axios',
    severity: 'high',
    title: 'Absolute URL in a request bypasses baseURL, leaking credentials',
    introducedIn: null,
    fixedIn: '1.8.2',
  },
];

/**
 * Advisories grouped by package name.
 *
 * A scan walks every entry in a lockfile — commonly ~800 packages — so the
 * lookup has to be by name rather than a scan of the advisory list per package.
 * Built once at module load because the fixture is immutable.
 */
export const ADVISORIES_BY_PACKAGE: ReadonlyMap<string, readonly Advisory[]> =
  (() => {
    const index = new Map<string, Advisory[]>();
    for (const advisory of ADVISORIES) {
      const existing = index.get(advisory.package);
      if (existing) {
        existing.push(advisory);
      } else {
        index.set(advisory.package, [advisory]);
      }
    }
    return index;
  })();
