import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type {
  CreateProjectResponse,
  ListProjectsResponse,
} from '@config-scanner/shared-types';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

@Controller('orgs/:orgId/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /**
   * `GET /api/orgs/:orgId/projects` (SPEC.md §221).
   *
   * The return type is the shared contract, not a local shape. Changing
   * `ListProjectsResponse` must fail this build and the Angular build together —
   * that mutual breakage is the point of the milestone.
   */
  @Get()
  listProjects(@Param('orgId') orgId: string): Promise<ListProjectsResponse> {
    return this.projects.listByOrg(orgId);
  }

  /**
   * `POST /api/orgs/:orgId/projects` (SPEC.md §220).
   *
   * The body is validated by the global `ValidationPipe` against
   * `CreateProjectDto`; `whitelist` + `forbidNonWhitelisted` mean an unexpected
   * field is a 400 rather than something written silently into the item.
   * A duplicate id is a 409, raised by the conditional write in the repository.
   */
  @Post()
  createProject(
    @Param('orgId') orgId: string,
    @Body() body: CreateProjectDto,
  ): Promise<CreateProjectResponse> {
    return this.projects.create(orgId, body);
  }
}
