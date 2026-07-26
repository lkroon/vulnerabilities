import { Controller, Get, Param } from '@nestjs/common';
import type { ListProjectsResponse } from '@config-scanner/shared-types';
import { ProjectsService } from './projects.service';

@Controller('orgs/:orgId/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /**
   * `GET /api/orgs/:orgId/projects` (SPEC.md §192).
   *
   * The return type is the shared contract, not a local shape. Changing
   * `ListProjectsResponse` must fail this build and the Angular build together —
   * that mutual breakage is the point of the milestone.
   */
  @Get()
  listProjects(@Param('orgId') orgId: string): ListProjectsResponse {
    return this.projects.listByOrg(orgId);
  }
}
