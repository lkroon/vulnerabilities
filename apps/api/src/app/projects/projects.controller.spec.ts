import { Test, type TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

describe('ProjectsController', () => {
  let controller: ProjectsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [ProjectsService],
    }).compile();

    controller = module.get(ProjectsController);
  });

  it('returns the projects belonging to the org', () => {
    const { projects } = controller.listProjects('acme');

    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((project) => project.orgId === 'acme')).toBe(true);
  });

  it('returns an empty list for an unknown org', () => {
    expect(controller.listProjects('does-not-exist')).toEqual({ projects: [] });
  });

  it('allows a never-scanned project to have a null latestScanAt', () => {
    const { projects } = controller.listProjects('acme');
    const neverScanned = projects.find((p) => p.latestScanAt === null);

    expect(neverScanned).toBeDefined();
    expect(neverScanned?.counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });
});
