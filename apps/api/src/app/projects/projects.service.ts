import { Injectable } from '@nestjs/common';
import type {
  ListProjectsResponse,
  ProjectSummary,
} from '@config-scanner/shared-types';

/**
 * M1: returns fixture data so the contract can be proven end to end without a
 * persistence layer. M2 replaces this with a DynamoDB repository implementing
 * the key design in SPEC.md §104 — access pattern (4),
 * `PK = ORG#<orgId>, SK begins_with PROJECT#`.
 *
 * The method signature is the part that matters and should not change when the
 * body does.
 */
@Injectable()
export class ProjectsService {
  private readonly fixtures: ProjectSummary[] = [
    {
      orgId: 'acme',
      projectId: 'api-gateway',
      name: 'API Gateway',
      repo: 'acme/api-gateway',
      defaultBranch: 'main',
      latestScanAt: '2026-07-24T09:00:00Z',
      counts: { critical: 1, high: 3, medium: 7, low: 2 },
    },
    {
      orgId: 'acme',
      projectId: 'billing-worker',
      name: 'Billing Worker',
      repo: 'acme/billing-worker',
      defaultBranch: 'main',
      latestScanAt: '2026-07-25T16:30:00Z',
      counts: { critical: 0, high: 0, medium: 2, low: 5 },
    },
    {
      orgId: 'acme',
      projectId: 'infra-terraform',
      name: 'Infrastructure',
      repo: 'acme/infra-terraform',
      defaultBranch: 'main',
      latestScanAt: null,
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
    },
  ];

  listByOrg(orgId: string): ListProjectsResponse {
    return {
      projects: this.fixtures.filter((project) => project.orgId === orgId),
    };
  }
}
