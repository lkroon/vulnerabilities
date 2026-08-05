import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { CreateProjectRequest } from '@config-scanner/shared-types';
import type { ProjectItem } from '../dynamo/items';
import { projectGsi1, projectKey } from '../dynamo/keys';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

function projectItem(
  projectId: string,
  overrides: Partial<ProjectItem> = {},
): ProjectItem {
  return {
    ...projectKey('acme', projectId),
    ...projectGsi1('acme', projectId),
    type: 'project',
    orgId: 'acme',
    projectId,
    name: projectId,
    repo: `acme/${projectId}`,
    defaultBranch: 'main',
    createdAt: '2026-04-01T00:00:00.000Z',
    latestCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    ...overrides,
  };
}

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let items: ProjectItem[];

  beforeEach(async () => {
    items = [
      projectItem('api-gateway', {
        name: 'API Gateway',
        latestScanAt: '2026-07-24T09:00:00.000Z',
        latestCounts: { critical: 1, high: 3, medium: 7, low: 2 },
      }),
      projectItem('infra-terraform', { name: 'Infrastructure' }),
    ];

    const repository: Partial<ProjectsRepository> = {
      listByOrg: async (orgId) => items.filter((item) => item.orgId === orgId),
      create: async (orgId: string, request: CreateProjectRequest) => {
        if (items.some((item) => item.projectId === request.projectId)) {
          throw new ConflictException('exists');
        }
        const item = projectItem(request.projectId, { name: request.name });
        items.push(item);
        return item;
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        ProjectsService,
        { provide: ProjectsRepository, useValue: repository },
      ],
    }).compile();

    controller = module.get(ProjectsController);
  });

  it('returns the projects belonging to the org', async () => {
    const { projects } = await controller.listProjects('acme');

    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((project) => project.orgId === 'acme')).toBe(true);
  });

  it('returns an empty list for an unknown org', async () => {
    expect(await controller.listProjects('does-not-exist')).toEqual({
      projects: [],
    });
  });

  it('maps the stored item onto the contract, hiding the key attributes', async () => {
    const { projects } = await controller.listProjects('acme');
    const apiGateway = projects.find((p) => p.projectId === 'api-gateway');

    expect(apiGateway).toEqual({
      orgId: 'acme',
      projectId: 'api-gateway',
      name: 'API Gateway',
      repo: 'acme/api-gateway',
      defaultBranch: 'main',
      latestScanAt: '2026-07-24T09:00:00.000Z',
      counts: { critical: 1, high: 3, medium: 7, low: 2 },
    });
    // `PK`, `SK` and `GSI1PK` are storage mechanics. Leaking them into the
    // response would hand the key design to the frontend.
    expect(Object.keys(apiGateway ?? {})).not.toContain('PK');
  });

  it('reports a never-scanned project as null rather than zero', async () => {
    const { projects } = await controller.listProjects('acme');
    const neverScanned = projects.find(
      (p) => p.projectId === 'infra-terraform',
    );

    // The stored item simply has no `latestScanAt` attribute; the contract says
    // null. "Never scanned" and "scanned, found nothing" render differently.
    expect(neverScanned?.latestScanAt).toBeNull();
    expect(neverScanned?.counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it('creates a project and returns it as a summary', async () => {
    const { project } = await controller.createProject('acme', {
      projectId: 'new-service',
      name: 'New Service',
      repo: 'acme/new-service',
      defaultBranch: 'main',
    });

    expect(project.projectId).toBe('new-service');
    expect(project.latestScanAt).toBeNull();
    expect((await controller.listProjects('acme')).projects).toHaveLength(3);
  });

  it('rejects a duplicate project id', async () => {
    await expect(
      controller.createProject('acme', {
        projectId: 'api-gateway',
        name: 'API Gateway',
        repo: 'acme/api-gateway',
        defaultBranch: 'main',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
