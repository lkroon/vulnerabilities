import axios from 'axios';
import type {
  CreateProjectResponse,
  CreateScanResponse,
  LatestScanResponse,
  ListScansResponse,
  PackageUsageResponse,
  ScanDetailResponse,
} from '@config-scanner/shared-types';

/**
 * The M2 acceptance path, against a real Nest server and real DynamoDB Local.
 *
 * Runs in its own org so it cannot disturb the seeded `acme` fixtures that the
 * web e2e suite asserts on, and gives every project a unique id so repeated runs
 * against a persistent local table do not collide.
 *
 * The response types come from `libs/shared-types`. A contract change breaks
 * this suite at compile time, which is the same coupling the M1 test proved —
 * now applied to the endpoints that write.
 */

const ORG = 'e2e';

function uniqueProjectId(suffix: string): string {
  return `e2e-${Date.now()}-${suffix}`;
}

/** A lockfile with one vulnerable direct dependency and one transitive one. */
function lockfile(): string {
  return JSON.stringify({
    name: 'e2e-fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'e2e-fixture', dependencies: { express: '4.19.2' } },
      'node_modules/express': {
        version: '4.19.2',
        resolved: 'https://registry.npmjs.org/express/-/express-4.19.2.tgz',
        dependencies: { cookie: '0.6.0' },
      },
      'node_modules/cookie': {
        version: '0.6.0',
        resolved: 'https://registry.npmjs.org/cookie/-/cookie-0.6.0.tgz',
      },
    },
  });
}

async function createProject(projectId: string): Promise<void> {
  const res = await axios.post<CreateProjectResponse>(
    `/api/orgs/${ORG}/projects`,
    {
      projectId,
      name: `E2E ${projectId}`,
      repo: `acme/${projectId}`,
      defaultBranch: 'main',
    },
  );

  expect(res.status).toBe(201);
}

async function uploadManifest(
  projectId: string,
  content: string,
  filename = 'package-lock.json',
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.append('manifest', new Blob([content]), filename);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  return axios.post<CreateScanResponse>(
    `/api/projects/${projectId}/scans`,
    form,
  );
}

describe('scan ingestion', () => {
  it('uploads a manifest and stores an immutable snapshot', async () => {
    const projectId = uniqueProjectId('upload');
    await createProject(projectId);

    const created = await uploadManifest(
      projectId,
      lockfile(),
      'package-lock.json',
      {
        commit: 'a3f19c2',
      },
    );

    expect(created.status).toBe(201);
    expect(created.headers['content-type']).toContain('application/json');

    const { scan } = created.data;
    expect(scan.status).toBe('completed');
    expect(scan.commit).toBe('a3f19c2');
    expect(scan.findingsExternal).toBe(false);
    expect(scan.findingCount).toBeGreaterThan(0);

    // Both the direct dependency and the transitive one, with the chain that
    // reached it — the parser reconstructs that through npm's hoisting.
    const cves = scan.findings.flatMap((f) =>
      f.kind === 'npm_cve' ? [f] : [],
    );
    expect(cves.map((f) => f.package).sort()).toEqual(['cookie', 'express']);
    expect(cves.find((f) => f.package === 'cookie')?.path).toEqual([
      'e2e-fixture',
      'express',
      'cookie',
    ]);

    // The counts on the summary match the findings that produced them.
    expect(scan.counts.medium + scan.counts.low).toBe(scan.findingCount);
  });

  it('serves the scan through every read pattern', async () => {
    const projectId = uniqueProjectId('reads');
    await createProject(projectId);
    const { data } = await uploadManifest(projectId, lockfile());
    const { scannedAt } = data.scan;

    const history = await axios.get<ListScansResponse>(
      `/api/projects/${projectId}/scans`,
    );
    expect(history.data.scans).toHaveLength(1);
    // History is summaries only — `findings` never travels with the list.
    expect(history.data.scans[0]).not.toHaveProperty('findings');

    const latest = await axios.get<LatestScanResponse>(
      `/api/projects/${projectId}/scans/latest`,
    );
    expect(latest.data.scan?.scannedAt).toBe(scannedAt);

    const detail = await axios.get<ScanDetailResponse>(
      `/api/scans/${projectId}/${scannedAt}`,
    );
    expect(detail.data.scan.findings).toHaveLength(data.scan.findingCount);
  });

  it('answers blast radius from the sparse package index', async () => {
    const projectId = uniqueProjectId('blast');
    await createProject(projectId);
    await uploadManifest(projectId, lockfile());

    const usage = await axios.get<PackageUsageResponse>(
      '/api/packages/cookie/0.6.0/usage',
    );

    expect(usage.data.package).toBe('cookie');
    expect(usage.data.projects.map((p) => p.projectId)).toContain(projectId);

    // Only packages with findings are indexed, so a clean package is absent
    // even though the scan resolved it.
    const clean = await axios.get<PackageUsageResponse>(
      '/api/packages/express/4.21.0/usage',
    );
    expect(clean.data.projects).toEqual([]);
  });

  it('spills a large findings payload out of the item and reads it back', async () => {
    const projectId = uniqueProjectId('spill');
    await createProject(projectId);

    // 1200 dependents each nesting their own vulnerable copy — enough findings
    // to cross the inline limit (SPEC.md §194).
    const dependents = Array.from({ length: 1200 }, (_, i) => `dep-${i}`);
    const oversized = JSON.stringify({
      name: 'e2e-oversized',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'e2e-oversized',
          dependencies: Object.fromEntries(dependents.map((d) => [d, '1.0.0'])),
        },
        ...Object.fromEntries(
          dependents.flatMap((dep, i) => [
            [
              `node_modules/${dep}`,
              {
                version: '1.0.0',
                resolved: `https://registry.npmjs.org/${dep}/-/${dep}-1.0.0.tgz`,
                dependencies: { lodash: `1.${i}.0` },
              },
            ],
            [
              `node_modules/${dep}/node_modules/lodash`,
              {
                version: `1.${i}.0`,
                resolved: `https://registry.npmjs.org/lodash/-/lodash-1.${i}.0.tgz`,
              },
            ],
          ]),
        ),
      },
    });

    const { data } = await uploadManifest(projectId, oversized);
    expect(data.scan.findingsExternal).toBe(true);
    expect(data.scan.findingCount).toBe(1200);

    // The item kept the summary; the payload came back through the store.
    const history = await axios.get<ListScansResponse>(
      `/api/projects/${projectId}/scans`,
    );
    expect(history.data.scans[0].findingCount).toBe(1200);

    const detail = await axios.get<ScanDetailResponse>(
      `/api/scans/${projectId}/${data.scan.scannedAt}`,
    );
    expect(detail.data.scan.findings).toHaveLength(1200);
  }, 60_000);
});

describe('scan ingestion rejects bad input', () => {
  it('rejects a manifest type it cannot scan', async () => {
    const projectId = uniqueProjectId('type');
    await createProject(projectId);

    const res = await uploadManifest(
      projectId,
      'FROM node:22',
      'Dockerfile',
    ).catch((error) => error.response);

    expect(res.status).toBe(400);
    expect(res.data.message).toContain('package-lock.json');
  });

  it('rejects a file that is not a lockfile', async () => {
    const projectId = uniqueProjectId('parse');
    await createProject(projectId);

    const res = await uploadManifest(projectId, '{ not json').catch(
      (error) => error.response,
    );

    expect(res.status).toBe(400);
  });

  it('rejects a request with no file at all', async () => {
    const projectId = uniqueProjectId('nofile');
    await createProject(projectId);

    const res = await axios
      .post(`/api/projects/${projectId}/scans`, new FormData())
      .catch((error) => error.response);

    expect(res.status).toBe(400);
  });

  it('404s for an unknown project', async () => {
    const res = await uploadManifest(
      'does-not-exist-project',
      lockfile(),
    ).catch((error) => error.response);

    expect(res.status).toBe(404);
  });

  it('rejects an invalid project id and unknown body fields', async () => {
    const res = await axios
      .post(`/api/orgs/${ORG}/projects`, {
        projectId: 'Not A Valid Id',
        name: 'x',
        repo: 'not-a-repo',
        defaultBranch: 'main',
        unexpected: true,
      })
      .catch((error) => error.response);

    expect(res.status).toBe(400);
    // whitelist + forbidNonWhitelisted: an unknown field is a rejection, not a
    // silent drop (SPEC.md §229).
    expect(res.data.message.join(' ')).toContain('unexpected should not exist');
  });

  it('rejects a duplicate project id with 409', async () => {
    const projectId = uniqueProjectId('dup');
    await createProject(projectId);

    const res = await axios
      .post(`/api/orgs/${ORG}/projects`, {
        projectId,
        name: 'again',
        repo: 'acme/again',
        defaultBranch: 'main',
      })
      .catch((error) => error.response);

    expect(res.status).toBe(409);
  });
});
