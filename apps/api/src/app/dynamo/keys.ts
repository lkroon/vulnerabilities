/**
 * The single-table key design (SPEC.md §104), expressed as pure functions.
 *
 * Every key string in the application is built here. Nothing else in the codebase
 * writes `PROJECT#${id}` inline, because a key typo produces no error — it
 * produces a query that returns nothing, which reads exactly like "no data yet".
 * Centralising the construction makes the design testable without a database,
 * which is what CLAUDE.md asks for.
 *
 * ```
 * PK = ORG#<orgId>          SK = PROJECT#<projectId>   → project metadata
 * PK = PROJECT#<projectId>  SK = SCAN#<ISO timestamp>  → immutable scan snapshot
 * PK = PROJECT#<projectId>  SK = PKG#<name>@<version>  → sparse index row
 *                           GSI1PK = PKG#<name>@<ver>
 *                           GSI1SK = PROJECT#<projectId>
 * ```
 *
 * GSI1 is *overloaded*: it carries the package rows for blast radius
 * (`GSI1PK = PKG#…`) and the project rows for id → org lookup
 * (`GSI1PK = PROJECT#…`). One index serving two access patterns is the point of
 * a generic index name — the alternative is a second GSI, which is a second
 * write cost on every project write for one lookup.
 */

export const TABLE_KEYS = {
  partition: 'PK',
  sort: 'SK',
  gsi1Partition: 'GSI1PK',
  gsi1Sort: 'GSI1SK',
} as const;

export const GSI1_NAME = 'GSI1';

/** Prefixes are exported so tests assert on the design, not on a copy of it. */
export const PREFIX = {
  org: 'ORG#',
  project: 'PROJECT#',
  scan: 'SCAN#',
  pkg: 'PKG#',
} as const;

/**
 * Identifiers must not contain `#`.
 *
 * A `#` inside an id would make `PROJECT#a#b` ambiguous with a nested key and
 * let one project's id collide with another's — the NoSQL equivalent of SQL
 * injection through a key. Rejected at construction rather than sanitised,
 * because silently rewriting an id makes the stored key differ from the one the
 * caller thinks it wrote.
 */
function assertKeySafe(kind: string, value: string): string {
  if (value.length === 0) {
    throw new Error(`${kind} must not be empty`);
  }
  if (value.includes('#')) {
    throw new Error(`${kind} must not contain '#': ${value}`);
  }
  return value;
}

export function orgPk(orgId: string): string {
  return `${PREFIX.org}${assertKeySafe('orgId', orgId)}`;
}

export function projectSk(projectId: string): string {
  return `${PREFIX.project}${assertKeySafe('projectId', projectId)}`;
}

export function projectPk(projectId: string): string {
  return `${PREFIX.project}${assertKeySafe('projectId', projectId)}`;
}

export function scanSk(scannedAt: string): string {
  return `${PREFIX.scan}${assertKeySafe('scannedAt', scannedAt)}`;
}

/**
 * `PKG#<name>@<version>`.
 *
 * `@` separates name from version even though scoped packages already contain
 * one (`@scope/name@1.0.0`) — parsing splits on the *last* `@`, which is
 * unambiguous because a version can never contain one.
 */
export function packageKey(name: string, version: string): string {
  return `${PREFIX.pkg}${assertKeySafe('package name', name)}@${assertKeySafe(
    'package version',
    version,
  )}`;
}

/** The composite key of a project item. */
export function projectKey(orgId: string, projectId: string) {
  return { PK: orgPk(orgId), SK: projectSk(projectId) };
}

/** The composite key of a scan item. */
export function scanKey(projectId: string, scannedAt: string) {
  return { PK: projectPk(projectId), SK: scanSk(scannedAt) };
}

/** The composite key of a package index row. */
export function packageIndexKey(
  projectId: string,
  name: string,
  version: string,
) {
  return { PK: projectPk(projectId), SK: packageKey(name, version) };
}

/** GSI1 attributes for a package index row — blast radius (access pattern 5). */
export function packageIndexGsi1(
  projectId: string,
  name: string,
  version: string,
) {
  return {
    GSI1PK: packageKey(name, version),
    GSI1SK: projectPk(projectId),
  };
}

/**
 * GSI1 attributes for a project item — "which org owns this project id?".
 *
 * The scan endpoints are addressed by project id alone (`/api/projects/:id/scans`,
 * SPEC.md §222), but the project item is partitioned by org. Without this
 * projection, resolving a project id would mean scanning the table.
 */
export function projectGsi1(orgId: string, projectId: string) {
  return {
    GSI1PK: projectPk(projectId),
    GSI1SK: orgPk(orgId),
  };
}

/** Query condition for "all projects in an org" — access pattern 4. */
export function orgProjectsQuery(orgId: string) {
  return {
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
    ExpressionAttributeNames: {
      '#pk': TABLE_KEYS.partition,
      '#sk': TABLE_KEYS.sort,
    },
    ExpressionAttributeValues: { ':pk': orgPk(orgId), ':sk': PREFIX.project },
  };
}

/**
 * Query condition for a project's scan history — access patterns 1 and 2.
 *
 * `begins_with(SK, 'SCAN#')` is what keeps the scan rows and the `PKG#` rows in
 * the same partition without ever returning each other. And because the sort key
 * is an ISO-8601 timestamp, lexicographic order *is* chronological order, so
 * "latest scan" is this query with `ScanIndexForward: false, Limit: 1` rather
 * than a sort or a separate "latest" pointer item.
 */
export function projectScansQuery(projectId: string) {
  return {
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
    ExpressionAttributeNames: {
      '#pk': TABLE_KEYS.partition,
      '#sk': TABLE_KEYS.sort,
    },
    ExpressionAttributeValues: {
      ':pk': projectPk(projectId),
      ':sk': PREFIX.scan,
    },
  };
}

/** GSI1 query for blast radius — access pattern 5. */
export function packageUsageQuery(name: string, version: string) {
  return {
    IndexName: GSI1_NAME,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': TABLE_KEYS.gsi1Partition },
    ExpressionAttributeValues: { ':pk': packageKey(name, version) },
  };
}

/** GSI1 query resolving a project id to its owning org. */
export function projectByIdQuery(projectId: string) {
  return {
    IndexName: GSI1_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
    ExpressionAttributeNames: {
      '#pk': TABLE_KEYS.gsi1Partition,
      '#sk': TABLE_KEYS.gsi1Sort,
    },
    ExpressionAttributeValues: {
      ':pk': projectPk(projectId),
      ':sk': PREFIX.org,
    },
  };
}

/** Recover the org id from an `ORG#…` key. */
export function orgIdFromPk(pk: string): string {
  if (!pk.startsWith(PREFIX.org)) {
    throw new Error(`Not an org key: ${pk}`);
  }
  return pk.slice(PREFIX.org.length);
}

/** Recover the project id from a `PROJECT#…` key. */
export function projectIdFromKey(key: string): string {
  if (!key.startsWith(PREFIX.project)) {
    throw new Error(`Not a project key: ${key}`);
  }
  return key.slice(PREFIX.project.length);
}

/** Recover the timestamp from a `SCAN#…` sort key. */
export function scannedAtFromSk(sk: string): string {
  if (!sk.startsWith(PREFIX.scan)) {
    throw new Error(`Not a scan key: ${sk}`);
  }
  return sk.slice(PREFIX.scan.length);
}

/** Recover name and version from a `PKG#<name>@<version>` key. */
export function packageFromKey(key: string): { name: string; version: string } {
  if (!key.startsWith(PREFIX.pkg)) {
    throw new Error(`Not a package key: ${key}`);
  }
  const body = key.slice(PREFIX.pkg.length);
  const at = body.lastIndexOf('@');
  if (at <= 0) {
    throw new Error(`Malformed package key: ${key}`);
  }
  return { name: body.slice(0, at), version: body.slice(at + 1) };
}

/** Seconds-since-epoch TTL, `days` from `from`. DynamoDB TTL is seconds, not ms. */
export function ttlFrom(from: Date, days: number): number {
  return Math.floor(from.getTime() / 1000) + days * 24 * 60 * 60;
}

/**
 * How long a `PKG#` row survives without being refreshed (SPEC.md §203).
 *
 * Every scan re-upserts the rows for packages it still finds, so an entry only
 * expires when the package has been gone for 90 days. That keeps blast-radius
 * answers from being haunted by dependencies that were removed a year ago,
 * without anything having to compute a diff between scans.
 */
export const PACKAGE_INDEX_TTL_DAYS = 90;
