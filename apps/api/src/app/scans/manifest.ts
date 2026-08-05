import { BadRequestException } from '@nestjs/common';
import type { ManifestType } from '@config-scanner/shared-types';

/**
 * The largest manifest the API will accept, in bytes.
 *
 * A `package-lock.json` for a large monorepo is a few megabytes; this one is
 * ~1MB. 5MB accepts realistic uploads while keeping the whole file in memory
 * bounded, which matters because the Lambda that will run this has a fixed
 * memory size and the request body is buffered before it is parsed (SPEC.md §258).
 */
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

/**
 * The part of a multer upload this application actually consumes.
 *
 * Declared here rather than typed as `Express.Multer.File`, for two reasons.
 * `@types/multer` publishes its types by augmenting the global `Express`
 * namespace, and `apps/api/tsconfig.app.json` deliberately restricts global type
 * inclusion to `["node"]` — widening it to pick up one interface pulls every
 * ambient Express type in with it. And naming the three fields makes the
 * dependency on the upload middleware explicit and trivially fakeable in tests,
 * where constructing a full multer file object would be noise.
 */
export interface UploadedManifest {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Filename → manifest type.
 *
 * Only `package-lock.json` is implemented in v1 (SPEC.md §266). The others are
 * absent rather than mapped-and-rejected-later, so an unsupported upload fails
 * at the boundary with a list of what is accepted.
 */
const MANIFEST_BY_FILENAME: Record<string, ManifestType> = {
  'package-lock.json': 'package-lock.json',
};

/**
 * Decide what a file is, from its name.
 *
 * Deliberately not from its MIME type. The `Content-Type` on a multipart part is
 * whatever the client wrote there — browsers send `application/json` for a
 * lockfile, curl sends `application/octet-stream`, and neither is evidence.
 * The filename picks the parser, and the parser is the real validation: a file
 * that claims to be a lockfile but is not fails in `parsePackageLock` with a
 * specific error.
 *
 * Only the basename is considered, so an upload named `../../etc/package-lock.json`
 * cannot smuggle a path anywhere — nothing here ever touches the filesystem, but
 * the name does end up in logs.
 */
export function manifestTypeFor(filename: string): ManifestType {
  const basename = filename.split(/[/\\]/).pop() ?? '';
  const manifest = MANIFEST_BY_FILENAME[basename.toLowerCase()];

  if (!manifest) {
    throw new BadRequestException(
      `Unsupported manifest "${basename}". Supported: ${Object.keys(MANIFEST_BY_FILENAME).join(', ')}`,
    );
  }

  return manifest;
}
