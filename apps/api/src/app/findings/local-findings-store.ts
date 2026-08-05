import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Finding } from '@config-scanner/shared-types';
import type { FindingsStore } from './findings-store';

/**
 * Filesystem-backed findings storage for local development.
 *
 * S3 is the production implementation (M4). This one exists so M2 can be built
 * and demonstrated without an AWS account (SPEC.md §323), and because the seed
 * data has to include a spilled scan — the escape hatch is meant to be
 * exercised, not just documented.
 *
 * Files rather than a second DynamoDB Local table: the point of the design is
 * that these bytes leave the database, and putting them back in a table would
 * demonstrate the opposite.
 */
@Injectable()
export class LocalFindingsStore implements FindingsStore {
  private readonly logger = new Logger(LocalFindingsStore.name);
  private readonly root = resolve(
    process.env.FINDINGS_DIR ?? join(process.cwd(), '.data', 'findings'),
  );

  async put(key: string, findings: readonly Finding[]): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(findings), 'utf8');
    this.logger.log(`Spilled ${findings.length} findings to ${key}`);
  }

  async get(key: string): Promise<Finding[]> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), 'utf8')) as Finding[];
    } catch {
      // The item said the findings were external and they are not there. That
      // is a broken scan document, not an empty one — returning [] would render
      // as "no findings", which is the most dangerous possible lie for a
      // security dashboard to tell.
      throw new NotFoundException(`Findings payload ${key} is missing`);
    }
  }

  /**
   * Map an object key to a path underneath the store root.
   *
   * Two things happen here. Characters that are legal in an S3 key but awkward
   * on a filesystem (`:` in ISO timestamps) are replaced, deterministically, so
   * `put` and `get` agree. And the result is checked to still be inside the
   * root — the keys are built by this application today, but a store that
   * happily reads `../../etc/passwd` when handed a crafted key is a path
   * traversal waiting for the first endpoint that forwards user input.
   */
  private pathFor(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9/._-]/g, '_');
    const path = resolve(this.root, safe);

    if (path !== this.root && !path.startsWith(this.root + '/')) {
      throw new Error(`Refusing to access findings outside the store: ${key}`);
    }

    return path;
  }
}
