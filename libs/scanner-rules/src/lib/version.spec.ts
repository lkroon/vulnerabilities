import { compareVersions, isVersionAffected, parseVersion } from './version';

describe('parseVersion', () => {
  it('parses a plain release', () => {
    expect(parseVersion('4.17.21')).toEqual({
      release: [4, 17, 21],
      prerelease: [],
    });
  });

  it('parses a prerelease and ignores build metadata', () => {
    expect(parseVersion('1.0.0-rc.1+build.5')).toEqual({
      release: [1, 0, 0],
      prerelease: ['rc', '1'],
    });
  });

  it('rejects the non-semver versions npm lockfiles actually contain', () => {
    for (const version of ['file:../local', 'latest', '1.2', 'v1.2.3', '']) {
      expect(parseVersion(version)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.10')).toBeLessThan(0);
    expect(compareVersions('4.17.21', '4.17.21')).toBe(0);
    expect(compareVersions('4.17.21', '4.17.20')).toBeGreaterThan(0);
  });

  it('compares numerically, not lexically', () => {
    // The bug this guards: '9' > '10' as strings, so a lexical compare would
    // call 1.9.0 newer than 1.10.0 and miss every advisory in between.
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
  });

  it('sorts a prerelease below its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('orders prerelease identifiers by semver rules', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10')).toBeLessThan(0);
    // Numeric identifiers rank below alphanumeric ones (semver §11.4.3).
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
    // A longer identifier list wins when the shared prefix is equal (§11.4.4).
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('returns null rather than guessing when a version is uncomparable', () => {
    expect(compareVersions('file:../local', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', 'not-a-version')).toBeNull();
  });
});

describe('isVersionAffected', () => {
  it('treats fixedIn as exclusive — the first safe version', () => {
    const range = { introducedIn: null, fixedIn: '4.17.21' };
    expect(isVersionAffected('4.17.20', range)).toBe(true);
    expect(isVersionAffected('4.17.21', range)).toBe(false);
    expect(isVersionAffected('5.0.0', range)).toBe(false);
  });

  it('treats introducedIn as inclusive', () => {
    const range = { introducedIn: '8.0.0', fixedIn: '8.17.1' };
    expect(isVersionAffected('7.5.10', range)).toBe(false);
    expect(isVersionAffected('8.0.0', range)).toBe(true);
    expect(isVersionAffected('8.17.0', range)).toBe(true);
    expect(isVersionAffected('8.17.1', range)).toBe(false);
  });

  it('affects everything from the lower bound when no fix is published', () => {
    const range = { introducedIn: '2.0.0', fixedIn: null };
    expect(isVersionAffected('1.9.9', range)).toBe(false);
    expect(isVersionAffected('99.0.0', range)).toBe(true);
  });

  it('counts a prerelease of the fixed version as still affected', () => {
    // 4.17.21-rc.1 precedes 4.17.21, so it does not contain the fix.
    expect(
      isVersionAffected('4.17.21-rc.1', {
        introducedIn: null,
        fixedIn: '4.17.21',
      }),
    ).toBe(true);
  });

  it('does not claim an uncomparable version is affected', () => {
    // A git-resolved dependency cannot be proven vulnerable by version alone.
    // Reporting it anyway would put an unfalsifiable critical on a dashboard;
    // the supply-chain rule is what flags these instead.
    expect(
      isVersionAffected('file:../local', {
        introducedIn: null,
        fixedIn: '4.17.21',
      }),
    ).toBe(false);
    expect(
      isVersionAffected('nonsense', { introducedIn: null, fixedIn: null }),
    ).toBe(false);
  });
});
