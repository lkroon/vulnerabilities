/**
 * `package-lock.json` parsing.
 *
 * The scanner reads the lockfile rather than `package.json` because the lockfile
 * is the only file that says what is *actually installed*: exact versions,
 * transitive dependencies, and where each copy came from. `package.json` states
 * intent (`^4.17.0`), and intent is not what gets deployed.
 */

/** Raised when the upload is not a lockfile this scanner can read. */
export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

/** A package as resolved by npm, flattened out of the lockfile. */
export interface ResolvedPackage {
  name: string;
  version: string;
  /**
   * Dependency chain from the root project to this package, root first.
   * `['acme-api', 'express', 'body-parser']` reads "we depend on express, which
   * depends on body-parser" — the difference between a direct and a transitive
   * finding, and the first question anyone asks about one.
   */
  path: string[];
  /** The `resolved` URL npm recorded, or null for workspace/link entries. */
  resolved: string | null;
  /** True when the package is only reachable through devDependencies. */
  dev: boolean;
}

/** Raw lockfile entry shape (v2/v3 `packages` map). Only the fields used here. */
interface LockPackageEntry {
  name?: string;
  version?: string;
  resolved?: string;
  dev?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PackageLockFile {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<string, LockPackageEntry>;
}

/** The location key of a package installed at `<dir>/node_modules/<name>`. */
function locationFor(dir: string, name: string): string {
  return dir === '' ? `node_modules/${name}` : `${dir}/node_modules/${name}`;
}

/** The directory a location key lives in — `a/node_modules/b` → `a`. */
function parentDirOf(location: string): string {
  const index = location.lastIndexOf('/node_modules/');
  return index === -1 ? '' : location.slice(0, index);
}

/**
 * Resolve `name` as required from `fromLocation`, following Node's algorithm:
 * look in the requiring package's own `node_modules`, then walk up towards the
 * root.
 *
 * This is what makes hoisting survivable. npm installs a shared dependency once
 * at the top level, so the lockfile's key (`node_modules/braces`) records where
 * the bytes are, not who asked for them. Reconstructing the chain means
 * re-running resolution rather than reading the key.
 */
function resolveFrom(
  packages: Record<string, LockPackageEntry>,
  fromLocation: string,
  name: string,
): string | null {
  let dir = fromLocation;
  for (;;) {
    const candidate = locationFor(dir, name);
    if (candidate in packages) {
      return candidate;
    }
    if (dir === '') {
      return null;
    }
    dir = parentDirOf(dir);
  }
}

/** The package name for a location key: `a/node_modules/@scope/b` → `@scope/b`. */
function nameFromLocation(location: string): string {
  const index = location.lastIndexOf('node_modules/');
  return index === -1
    ? location
    : location.slice(index + 'node_modules/'.length);
}

/**
 * Flatten a lockfile into the packages that are actually reachable from the root.
 *
 * Breadth-first, so the first path found to a package is the shortest one — the
 * most useful chain to show a human, and stable regardless of key ordering in
 * the file. Each *installed location* is reported once, which is not the same as
 * each version: npm nests a second copy of a package when two dependents need
 * incompatible ranges, and both copies are really on disk. Collapsing the
 * duplicate findings that produces is the rule engine's job, not the parser's —
 * see `dedupeFindings`.
 *
 * Only lockfile v2 and v3 are supported. v1 (npm 6, EOL 2022) uses a completely
 * different nested `dependencies` layout; supporting it would mean a second
 * parser for a format no supported npm produces.
 */
export function parsePackageLock(content: string): ResolvedPackage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ManifestParseError('File is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ManifestParseError('Lockfile must be a JSON object.');
  }

  const lock = parsed as PackageLockFile;

  if (!lock.packages) {
    const version = lock.lockfileVersion;
    throw new ManifestParseError(
      version !== undefined && version < 2
        ? `Lockfile version ${version} is not supported — regenerate with npm 7 or later.`
        : 'Not a package-lock.json: no "packages" section.',
    );
  }

  const packages = lock.packages;
  const root = packages[''];
  if (!root) {
    throw new ManifestParseError('Lockfile has no root ("") entry.');
  }

  const rootName = root.name ?? lock.name ?? 'root';
  const resolved: ResolvedPackage[] = [];
  const seen = new Set<string>();

  interface QueueItem {
    location: string;
    path: string[];
    dev: boolean;
  }

  const directDev = new Set(Object.keys(root.devDependencies ?? {}));
  const queue: QueueItem[] = [];

  const enqueueDependenciesOf = (item: QueueItem) => {
    const entry = packages[item.location];
    if (!entry) return;

    // optionalDependencies are included: an optional dependency that npm did
    // install is installed, and a CVE in it is as real as any other.
    const dependencies = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      // Only the root's devDependencies are traversed. A transitive package's
      // devDependencies are not installed by npm, so following them would
      // invent packages that are not on disk.
      ...(item.location === '' ? entry.devDependencies : undefined),
    };

    for (const name of Object.keys(dependencies)) {
      const location = resolveFrom(packages, item.location, name);
      if (!location || seen.has(location)) {
        continue;
      }
      seen.add(location);
      queue.push({
        location,
        path: [...item.path, name],
        dev: item.dev || (item.location === '' && directDev.has(name)),
      });
    }
  };

  enqueueDependenciesOf({ location: '', path: [rootName], dev: false });

  for (let head = 0; head < queue.length; head++) {
    const item = queue[head];
    const entry = packages[item.location];
    if (!entry) continue;

    // `link: true` entries point at a workspace directory; the real entry is
    // elsewhere in the file and gets visited on its own.
    if (!entry.link && entry.version) {
      resolved.push({
        name: entry.name ?? nameFromLocation(item.location),
        version: entry.version,
        path: item.path,
        resolved: entry.resolved ?? null,
        // The lockfile's own `dev` flag is authoritative when present: npm
        // computes it across every path to the package, where this walk only
        // knows the first path it found.
        dev: entry.dev ?? item.dev,
      });
    }

    enqueueDependenciesOf(item);
  }

  return resolved;
}
