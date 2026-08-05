/**
 * Just enough semver to compare two *concrete* versions.
 *
 * A lockfile records resolved versions (`4.17.20`), never ranges (`^4.17.0`),
 * and advisories are expressed as `[introducedIn, fixedIn)` bounds. So the only
 * operation this library needs is "is this exact version inside that interval",
 * which is an ordering question — not range parsing, and not satisfiability.
 *
 * That is why there is no `semver` dependency. Pulling in a full range parser
 * would add a dependency whose 90% is unreachable from this code path, and the
 * interesting part (the ordering rules below) would still have to be understood
 * to trust the result.
 *
 * Known limitations, deliberate:
 * - Build metadata (`+sha`) is ignored, per semver §10.
 * - Prereleases sort before their release (`1.0.0-rc.1` < `1.0.0`), per §11.
 * - Anything that is not `x.y.z[-pre]` is not comparable — see `compareVersions`.
 */

interface ParsedVersion {
  release: [number, number, number];
  /** Dot-separated prerelease identifiers, empty for a final release. */
  prerelease: string[];
}

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }

  const [, major, minor, patch, prerelease] = match;
  return {
    release: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

/**
 * Compare two prerelease identifier lists (semver §11.4).
 *
 * Numeric identifiers compare numerically and rank below alphanumeric ones; a
 * longer list wins when every shared identifier is equal.
 */
function comparePrerelease(a: string[], b: string[]): number {
  // An absent prerelease outranks a present one: 1.0.0 > 1.0.0-rc.1.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      return Number(left) - Number(right) < 0 ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left < right ? -1 : 1;
  }

  return a.length - b.length === 0 ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * Order two versions: negative if `a` precedes `b`, 0 if equal, positive if it
 * follows.
 *
 * Returns `null` when either side is not a plain semver version — npm lockfiles
 * can carry `file:`, `link:` and git-sha "versions". Returning `null` rather
 * than guessing forces the caller to decide what an uncomparable version means;
 * see `isVersionAffected`, which treats it as "cannot prove affected".
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return null;
  }

  for (let i = 0; i < 3; i++) {
    if (left.release[i] !== right.release[i]) {
      return left.release[i] < right.release[i] ? -1 : 1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

/** A half-open version interval: affected if `>= introducedIn` and `< fixedIn`. */
export interface AffectedRange {
  /** Inclusive lower bound. `null` means every version up to `fixedIn`. */
  introducedIn: string | null;
  /** Exclusive upper bound. `null` means no fix is published — every later version is affected. */
  fixedIn: string | null;
}

/**
 * Is `version` inside the advisory's affected interval?
 *
 * Half-open on purpose: `fixedIn` is the first *safe* version, which is how npm
 * audit and the GitHub Advisory Database both express it, so a fixture entry can
 * be copied from an advisory without re-deriving the boundary.
 *
 * An uncomparable version (`file:../local`, a git sha) returns `false`: an
 * unprovable claim should not become a critical finding on someone's dashboard.
 * The supply-chain rule catches those packages instead, which is the finding
 * that actually applies to them.
 */
export function isVersionAffected(
  version: string,
  range: AffectedRange,
): boolean {
  if (range.introducedIn !== null) {
    const afterStart = compareVersions(version, range.introducedIn);
    if (afterStart === null || afterStart < 0) {
      return false;
    }
  }

  if (range.fixedIn !== null) {
    const beforeFix = compareVersions(version, range.fixedIn);
    if (beforeFix === null || beforeFix >= 0) {
      return false;
    }
    return true;
  }

  // No fix published: everything at or after the lower bound is affected. With
  // no lower bound either, the version still has to be parseable to count.
  return parseVersion(version) !== null;
}
