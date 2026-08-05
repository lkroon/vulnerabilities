import { ManifestParseError, parsePackageLock } from './package-lock';

/**
 * A lockfile shaped the way npm 9 writes them: hoisted, so the `packages` keys
 * say where a package is installed, not who required it.
 */
const HOISTED_LOCK = JSON.stringify({
  name: 'acme-api',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'acme-api',
      dependencies: { express: '^4.19.0' },
      devDependencies: { jest: '^30.0.0' },
    },
    'node_modules/express': {
      version: '4.19.2',
      resolved: 'https://registry.npmjs.org/express/-/express-4.19.2.tgz',
      dependencies: { 'body-parser': '1.20.2', 'serve-static': '1.15.0' },
    },
    'node_modules/body-parser': {
      version: '1.20.2',
      resolved:
        'https://registry.npmjs.org/body-parser/-/body-parser-1.20.2.tgz',
    },
    'node_modules/serve-static': {
      version: '1.15.0',
      resolved:
        'https://registry.npmjs.org/serve-static/-/serve-static-1.15.0.tgz',
    },
    'node_modules/jest': {
      version: '30.3.0',
      resolved: 'https://registry.npmjs.org/jest/-/jest-30.3.0.tgz',
      dev: true,
    },
    // Installed, but nothing requires it. npm leaves these behind after a
    // dependency is dropped without a fresh install.
    'node_modules/orphaned': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/orphaned/-/orphaned-1.0.0.tgz',
    },
  },
});

describe('parsePackageLock', () => {
  it('reconstructs the dependency chain through hoisting', () => {
    const packages = parsePackageLock(HOISTED_LOCK);
    const bodyParser = packages.find((pkg) => pkg.name === 'body-parser');

    // The lockfile key is `node_modules/body-parser` — flat. The chain has to
    // come from re-running resolution, not from splitting the key.
    expect(bodyParser?.path).toEqual(['acme-api', 'express', 'body-parser']);
    expect(bodyParser?.version).toBe('1.20.2');
  });

  it('walks devDependencies of the root and marks them dev', () => {
    const packages = parsePackageLock(HOISTED_LOCK);
    const jest = packages.find((pkg) => pkg.name === 'jest');

    expect(jest?.dev).toBe(true);
    expect(jest?.path).toEqual(['acme-api', 'jest']);
    expect(packages.find((pkg) => pkg.name === 'express')?.dev).toBe(false);
  });

  it('ignores packages nothing depends on', () => {
    // Reachability, not directory listing: a package no dependency chain
    // reaches is not part of the application.
    expect(parsePackageLock(HOISTED_LOCK).map((pkg) => pkg.name)).not.toContain(
      'orphaned',
    );
  });

  it('reports each resolved package exactly once', () => {
    const lock = JSON.stringify({
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', dependencies: { a: '1.0.0', b: '1.0.0' } },
        'node_modules/a': {
          version: '1.0.0',
          dependencies: { shared: '1.0.0' },
        },
        'node_modules/b': {
          version: '1.0.0',
          dependencies: { shared: '1.0.0' },
        },
        'node_modules/shared': { version: '1.0.0' },
      },
    });

    const shared = parsePackageLock(lock).filter(
      (pkg) => pkg.name === 'shared',
    );
    expect(shared).toHaveLength(1);
    // Breadth-first, so the reported chain is the shortest one and does not
    // depend on key ordering in the file.
    expect(shared[0].path).toEqual(['root', 'a', 'shared']);
  });

  it('prefers a nested copy over the hoisted one, as node resolution does', () => {
    const lock = JSON.stringify({
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', dependencies: { a: '1.0.0', lodash: '4.17.21' } },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/a': {
          version: '1.0.0',
          dependencies: { lodash: '4.17.20' },
        },
        // a needs an incompatible lodash, so npm nests a second copy.
        'node_modules/a/node_modules/lodash': { version: '4.17.20' },
      },
    });

    const versions = parsePackageLock(lock)
      .filter((pkg) => pkg.name === 'lodash')
      .map((pkg) => pkg.version)
      .sort();

    // Both copies are installed and both must be scanned — the vulnerable one
    // is the nested copy, and a parser that only read the top level would miss
    // it entirely.
    expect(versions).toEqual(['4.17.20', '4.17.21']);
  });

  it('derives scoped package names from the location key', () => {
    const lock = JSON.stringify({
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', dependencies: { '@acme/utils': '1.0.0' } },
        'node_modules/@acme/utils': { version: '1.0.0' },
      },
    });

    expect(parsePackageLock(lock)[0].name).toBe('@acme/utils');
  });

  it('skips workspace link entries', () => {
    const lock = JSON.stringify({
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', dependencies: { 'my-lib': '*' } },
        'node_modules/my-lib': { resolved: 'libs/my-lib', link: true },
        'libs/my-lib': { name: 'my-lib', version: '0.0.1' },
      },
    });

    expect(parsePackageLock(lock)).toEqual([]);
  });

  it('rejects invalid JSON with a client-fixable error', () => {
    expect(() => parsePackageLock('{ not json')).toThrow(ManifestParseError);
  });

  it('rejects lockfile v1 by name rather than failing obscurely', () => {
    const v1 = JSON.stringify({
      name: 'old',
      lockfileVersion: 1,
      dependencies: { lodash: { version: '4.17.20' } },
    });

    expect(() => parsePackageLock(v1)).toThrow(/version 1 is not supported/);
  });

  it('rejects a JSON file that is not a lockfile at all', () => {
    expect(() => parsePackageLock(JSON.stringify({ name: 'x' }))).toThrow(
      /no "packages" section/,
    );
    expect(() => parsePackageLock(JSON.stringify([1, 2]))).toThrow(
      /must be a JSON object/,
    );
  });

  it('rejects a lockfile with no root entry', () => {
    expect(() =>
      parsePackageLock(JSON.stringify({ lockfileVersion: 3, packages: {} })),
    ).toThrow(/no root/);
  });
});
