import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Finding } from '@config-scanner/shared-types';
import type { PackageIndexItem, ProjectItem, ScanItem } from '../dynamo/items';
import {
  FINDINGS_STORE,
  MAX_INLINE_FINDINGS_BYTES,
} from '../findings/findings-store';
import { ProjectsService } from '../projects/projects.service';
import { ScansRepository } from './scans.repository';
import { ScansService } from './scans.service';

/**
 * These tests exercise the scan write path against fakes rather than DynamoDB.
 *
 * The DynamoDB behaviour that matters — conditional writes, TTL, the GSI — is
 * verified by the key-design unit tests and by the api-e2e suite running against
 * DynamoDB Local. What is left here is the orchestration: what spills, what gets
 * indexed, and which errors become which status codes.
 */

const PROJECT: ProjectItem = {
  PK: 'ORG#acme',
  SK: 'PROJECT#api-gateway',
  GSI1PK: 'PROJECT#api-gateway',
  GSI1SK: 'ORG#acme',
  type: 'project',
  orgId: 'acme',
  projectId: 'api-gateway',
  name: 'API Gateway',
  repo: 'acme/api-gateway',
  defaultBranch: 'main',
  createdAt: '2026-04-01T00:00:00.000Z',
  latestCounts: { critical: 0, high: 0, medium: 0, low: 0 },
};

/** A lockfile with one vulnerable direct dependency the fixture database knows. */
function lockfileWith(packages: Record<string, string>): Buffer {
  const entries = Object.entries(packages);

  return Buffer.from(
    JSON.stringify({
      name: 'acme-api',
      lockfileVersion: 3,
      packages: {
        '': { name: 'acme-api', dependencies: Object.fromEntries(entries) },
        ...Object.fromEntries(
          entries.map(([name, version]) => [
            `node_modules/${name}`,
            {
              version,
              resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
            },
          ]),
        ),
      },
    }),
  );
}

/**
 * A lockfile where `count` dependents each nest their own vulnerable copy of
 * `name`, at a distinct version. Every version is below the advisory's fix, so
 * every copy is a separate finding.
 */
function lockfileWithNestedCopies(name: string, count: number): Buffer {
  const dependents = Array.from({ length: count }, (_, i) => `dependent-${i}`);

  return Buffer.from(
    JSON.stringify({
      name: 'acme-api',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'acme-api',
          dependencies: Object.fromEntries(
            dependents.map((dep) => [dep, '1.0.0']),
          ),
        },
        ...Object.fromEntries(
          dependents.flatMap((dep, i) => [
            [
              `node_modules/${dep}`,
              {
                version: '1.0.0',
                resolved: `https://registry.npmjs.org/${dep}/-/${dep}-1.0.0.tgz`,
                dependencies: { [name]: `1.${i}.0` },
              },
            ],
            [
              `node_modules/${dep}/node_modules/${name}`,
              {
                version: `1.${i}.0`,
                resolved: `https://registry.npmjs.org/${name}/-/${name}-1.${i}.0.tgz`,
              },
            ],
          ]),
        ),
      },
    }),
  );
}

function upload(buffer: Buffer, originalname = 'package-lock.json') {
  return { originalname, buffer, size: buffer.byteLength };
}

describe('ScansService', () => {
  let service: ScansService;
  let stored: ScanItem[];
  let indexed: PackageIndexItem[];
  let spilled: Map<string, Finding[]>;
  let rollups: { scannedAt: string; counts: unknown }[];

  beforeEach(async () => {
    stored = [];
    indexed = [];
    spilled = new Map();
    rollups = [];

    const scansRepository: Partial<ScansRepository> = {
      put: async (item) => {
        stored.push(item);
      },
      upsertPackageIndex: async (rows) => {
        indexed.push(...rows);
      },
      get: async (projectId, scannedAt) =>
        stored.find(
          (item) =>
            item.projectId === projectId && item.scannedAt === scannedAt,
        ) ?? null,
      listByProject: async () => stored,
      latest: async () => stored.at(-1) ?? null,
    };

    const projectsService: Partial<ProjectsService> = {
      requireById: async (projectId) => {
        if (projectId !== PROJECT.projectId) {
          throw new NotFoundException(`Project "${projectId}" not found`);
        }
        return PROJECT;
      },
      rollUpScan: async (_orgId, _projectId, scannedAt, counts) => {
        rollups.push({ scannedAt, counts });
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScansService,
        { provide: ScansRepository, useValue: scansRepository },
        { provide: ProjectsService, useValue: projectsService },
        {
          provide: FINDINGS_STORE,
          useValue: {
            put: async (key: string, findings: Finding[]) => {
              spilled.set(key, [...findings]);
            },
            get: async (key: string) => spilled.get(key) ?? [],
          },
        },
      ],
    }).compile();

    service = module.get(ScansService);
  });

  it('stores a scan with its findings inline when they fit', async () => {
    const { scan } = await service.create(
      'api-gateway',
      { commit: 'a3f19c2' },
      upload(lockfileWith({ lodash: '4.17.20' })),
    );

    expect(scan.findingCount).toBe(1);
    expect(scan.counts.high).toBe(1);
    expect(scan.findingsExternal).toBe(false);
    expect(scan.commit).toBe('a3f19c2');

    expect(stored).toHaveLength(1);
    expect(stored[0].findings).toHaveLength(1);
    expect(stored[0].findingsRef).toBeUndefined();
    expect(spilled.size).toBe(0);
  });

  it('spills findings to object storage when they exceed the item budget', async () => {
    // A real shape, not a synthetic one: 1200 dependents each pinning a
    // different vulnerable lodash, which is what npm nesting produces in a
    // neglected monorepo. That crosses the inline threshold and exercises the
    // escape hatch from SPEC.md §194 through the ordinary upload path.
    const { scan } = await service.create(
      'api-gateway',
      {},
      upload(lockfileWithNestedCopies('lodash', 1200)),
    );

    expect(Buffer.byteLength(JSON.stringify(scan.findings))).toBeGreaterThan(
      MAX_INLINE_FINDINGS_BYTES,
    );
    expect(scan.findingsExternal).toBe(true);
    expect(scan.findingCount).toBe(1200);

    // The findings left the item; the summary that every list and chart reads
    // stayed in DynamoDB.
    const item = stored[0];
    expect(item.findings).toBeUndefined();
    expect(item.findingsRef).toBe(`scans/api-gateway/${item.scannedAt}.json`);
    expect(item.counts.high).toBe(1200);
    expect(spilled.get(item.findingsRef as string)).toHaveLength(1200);

    // And reading the scan back resolves the reference transparently.
    const detail = await service.getDetail('api-gateway', item.scannedAt);
    expect(detail.scan.findingsExternal).toBe(true);
    expect(detail.scan.findings).toHaveLength(1200);
  });

  it('indexes the vulnerable packages and rolls the counts up onto the project', async () => {
    await service.create(
      'api-gateway',
      {},
      upload(lockfileWith({ lodash: '4.17.20', express: '4.19.2' })),
    );

    expect(indexed.map((row) => row.SK).sort()).toEqual([
      'PKG#express@4.19.2',
      'PKG#lodash@4.17.20',
    ]);
    expect(rollups).toHaveLength(1);
    expect(rollups[0].counts).toMatchObject({ high: 1, medium: 1 });
  });

  it('writes no index rows for a clean scan', async () => {
    await service.create(
      'api-gateway',
      {},
      upload(lockfileWith({ lodash: '4.17.21' })),
    );

    expect(stored[0].findingCount).toBe(0);
    expect(indexed).toEqual([]);
  });

  it('rejects an unreadable manifest as a client error', async () => {
    await expect(
      service.create('api-gateway', {}, upload(Buffer.from('{ not json'))),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing is stored: a scan that failed to parse must not appear in the
    // history as a clean result.
    expect(stored).toEqual([]);
  });

  it('rejects a manifest type with no parser', async () => {
    await expect(
      service.create(
        'api-gateway',
        {},
        upload(Buffer.from('FROM node:22'), 'Dockerfile'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for a project that does not exist', async () => {
    await expect(
      service.create('ghost', {}, upload(lockfileWith({ lodash: '4.17.20' }))),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listByProject('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s for a scan timestamp that does not exist', async () => {
    await expect(
      service.getDetail('api-gateway', '2020-01-01T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns null rather than 404 for a project that has never been scanned', async () => {
    expect(await service.latest('api-gateway')).toEqual({ scan: null });
  });
});
