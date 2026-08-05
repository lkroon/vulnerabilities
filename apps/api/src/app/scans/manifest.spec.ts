import { BadRequestException } from '@nestjs/common';
import { manifestTypeFor } from './manifest';

describe('manifestTypeFor', () => {
  it('recognises a lockfile', () => {
    expect(manifestTypeFor('package-lock.json')).toBe('package-lock.json');
  });

  it('considers only the basename', () => {
    expect(manifestTypeFor('apps/api/package-lock.json')).toBe(
      'package-lock.json',
    );
    expect(manifestTypeFor('C:\\repos\\acme\\package-lock.json')).toBe(
      'package-lock.json',
    );
  });

  it('rejects manifests with no parser, naming what is supported', () => {
    // Declared in the ManifestType union but not implemented in v1 — the
    // rejection has to be at the boundary, not a 500 from inside the engine.
    expect(() => manifestTypeFor('main.tf')).toThrow(BadRequestException);
    expect(() => manifestTypeFor('Dockerfile')).toThrow(/package-lock.json/);
    expect(() => manifestTypeFor('package.json')).toThrow(
      /Unsupported manifest/,
    );
  });

  it('does not accept a file that merely contains the name', () => {
    expect(() => manifestTypeFor('not-a-package-lock.json.txt')).toThrow(
      BadRequestException,
    );
  });
});
