import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ListProjectsResponse,
  SeverityCounts,
} from '@config-scanner/shared-types';
import type { ProjectItem } from '../dynamo/items';
import { toProjectSummary } from '../dynamo/items';
import { ProjectsRepository } from './projects.repository';

/**
 * Project use cases.
 *
 * The service maps storage items to the shared contracts and owns the "does this
 * exist?" rules; the repository owns keys and commands. M1's fixture array lived
 * here — the method signatures did not change when DynamoDB replaced it, only
 * their return values became promises.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly repository: ProjectsRepository) {}

  async listByOrg(orgId: string): Promise<ListProjectsResponse> {
    const items = await this.repository.listByOrg(orgId);

    return { projects: items.map(toProjectSummary) };
  }

  async create(
    orgId: string,
    request: CreateProjectRequest,
  ): Promise<CreateProjectResponse> {
    const item = await this.repository.create(orgId, request);

    return { project: toProjectSummary(item) };
  }

  /**
   * Project the newest scan's counts onto the project item.
   *
   * Called on the scan write path so the project list stays one query. Silently
   * does nothing when the scan is older than the one already projected — see
   * `ProjectsRepository.applyScanRollup`.
   */
  async rollUpScan(
    orgId: string,
    projectId: string,
    scannedAt: string,
    counts: SeverityCounts,
  ): Promise<void> {
    await this.repository.applyScanRollup(orgId, projectId, scannedAt, counts);
  }

  /**
   * Resolve a project id, or 404.
   *
   * Every scan endpoint starts here. Returning the item rather than a boolean
   * means the caller also gets `orgId`, which the scan write path needs to
   * update the project rollup — one GSI lookup instead of two.
   */
  async requireById(projectId: string): Promise<ProjectItem> {
    const item = await this.repository.findById(projectId);

    if (!item) {
      throw new NotFoundException(`Project "${projectId}" not found`);
    }

    return item;
  }
}
