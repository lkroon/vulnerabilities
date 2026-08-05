import {
  GSI1_NAME,
  PACKAGE_INDEX_TTL_DAYS,
  orgIdFromPk,
  orgPk,
  orgProjectsQuery,
  packageFromKey,
  packageIndexGsi1,
  packageIndexKey,
  packageKey,
  packageUsageQuery,
  projectByIdQuery,
  projectGsi1,
  projectIdFromKey,
  projectKey,
  projectScansQuery,
  scanKey,
  scannedAtFromSk,
  ttlFrom,
} from './keys';

describe('key construction', () => {
  it('builds the project item key from SPEC.md §107', () => {
    expect(projectKey('acme', 'api-gateway')).toEqual({
      PK: 'ORG#acme',
      SK: 'PROJECT#api-gateway',
    });
  });

  it('builds the scan item key from SPEC.md §108', () => {
    expect(scanKey('api-gateway', '2026-07-24T09:00:00Z')).toEqual({
      PK: 'PROJECT#api-gateway',
      SK: 'SCAN#2026-07-24T09:00:00Z',
    });
  });

  it('builds the package index key and its GSI1 projection from SPEC.md §109', () => {
    expect(packageIndexKey('api-gateway', 'lodash', '4.17.20')).toEqual({
      PK: 'PROJECT#api-gateway',
      SK: 'PKG#lodash@4.17.20',
    });
    expect(packageIndexGsi1('api-gateway', 'lodash', '4.17.20')).toEqual({
      GSI1PK: 'PKG#lodash@4.17.20',
      GSI1SK: 'PROJECT#api-gateway',
    });
  });

  it('projects the project item into GSI1 for id → org lookup', () => {
    expect(projectGsi1('acme', 'api-gateway')).toEqual({
      GSI1PK: 'PROJECT#api-gateway',
      GSI1SK: 'ORG#acme',
    });
  });

  it('rejects identifiers containing the key separator', () => {
    // 'a#b' would produce PROJECT#a#b, which collides with any future nested
    // key and lets one id impersonate another. Fail at construction.
    expect(() => orgPk('acme#evil')).toThrow(/must not contain/);
    expect(() => packageKey('lodash', '4.17.20#x')).toThrow(/must not contain/);
  });

  it('rejects empty identifiers', () => {
    expect(() => orgPk('')).toThrow(/must not be empty/);
  });

  it('keeps scoped package names intact', () => {
    expect(packageKey('@angular/core', '22.0.4')).toBe(
      'PKG#@angular/core@22.0.4',
    );
  });
});

describe('key parsing', () => {
  it('round-trips org, project and scan keys', () => {
    expect(orgIdFromPk(orgPk('acme'))).toBe('acme');
    expect(projectIdFromKey(projectKey('acme', 'api-gateway').SK)).toBe(
      'api-gateway',
    );
    expect(scannedAtFromSk(scanKey('p', '2026-07-24T09:00:00Z').SK)).toBe(
      '2026-07-24T09:00:00Z',
    );
  });

  it('splits a package key on the last @ so scoped names survive', () => {
    expect(packageFromKey('PKG#lodash@4.17.20')).toEqual({
      name: 'lodash',
      version: '4.17.20',
    });
    expect(packageFromKey(packageKey('@angular/core', '22.0.4'))).toEqual({
      name: '@angular/core',
      version: '22.0.4',
    });
  });

  it('refuses to parse a key of the wrong type', () => {
    expect(() => orgIdFromPk('PROJECT#x')).toThrow(/Not an org key/);
    expect(() => scannedAtFromSk('PKG#lodash@1.0.0')).toThrow(/Not a scan key/);
    expect(() => packageFromKey('PKG#nonsense')).toThrow(/Malformed/);
  });
});

describe('query builders', () => {
  it('lists an org’s projects — access pattern 4', () => {
    const query = orgProjectsQuery('acme');

    expect(query.KeyConditionExpression).toBe(
      '#pk = :pk AND begins_with(#sk, :sk)',
    );
    expect(query.ExpressionAttributeValues).toEqual({
      ':pk': 'ORG#acme',
      ':sk': 'PROJECT#',
    });
  });

  it('lists a project’s scans without matching its package rows', () => {
    const query = projectScansQuery('api-gateway');

    expect(query.ExpressionAttributeValues).toEqual({
      ':pk': 'PROJECT#api-gateway',
      ':sk': 'SCAN#',
    });
    // Scans and PKG# rows share a partition. The prefix is the only thing
    // keeping them apart, so a change to it must fail here.
    expect(query.ExpressionAttributeValues[':sk']).not.toBe('PKG#');
  });

  it('queries GSI1 for blast radius — access pattern 5', () => {
    const query = packageUsageQuery('lodash', '4.17.20');

    expect(query.IndexName).toBe(GSI1_NAME);
    expect(query.ExpressionAttributeValues).toEqual({
      ':pk': 'PKG#lodash@4.17.20',
    });
  });

  it('resolves a project id to its org through the same index', () => {
    const query = projectByIdQuery('api-gateway');

    expect(query.IndexName).toBe(GSI1_NAME);
    expect(query.ExpressionAttributeValues).toEqual({
      ':pk': 'PROJECT#api-gateway',
      ':sk': 'ORG#',
    });
  });

  it('sorts scan timestamps chronologically as plain strings', () => {
    // The reason the sort key is an ISO-8601 string: lexicographic order is
    // chronological order, so "latest scan" is Limit 1 on a descending query.
    const keys = [
      scanKey('p', '2026-07-24T09:00:00Z').SK,
      scanKey('p', '2026-01-02T23:59:59Z').SK,
      scanKey('p', '2026-07-24T10:00:00Z').SK,
    ].sort();

    expect(keys).toEqual([
      'SCAN#2026-01-02T23:59:59Z',
      'SCAN#2026-07-24T09:00:00Z',
      'SCAN#2026-07-24T10:00:00Z',
    ]);
  });
});

describe('ttlFrom', () => {
  it('returns seconds since epoch, not milliseconds', () => {
    const from = new Date('2026-07-24T00:00:00Z');

    // DynamoDB ignores a TTL attribute it cannot read as epoch *seconds*, and
    // ignoring it silently means rows never expire. Off by 1000 is the whole bug.
    expect(ttlFrom(from, 0)).toBe(from.getTime() / 1000);
    expect(ttlFrom(from, PACKAGE_INDEX_TTL_DAYS)).toBe(
      from.getTime() / 1000 + 90 * 86400,
    );
  });
});
