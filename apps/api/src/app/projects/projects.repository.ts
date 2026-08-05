import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  CreateProjectRequest,
  SeverityCounts,
} from '@config-scanner/shared-types';
import { EMPTY_SEVERITY_COUNTS } from '@config-scanner/shared-types';
import { DYNAMO_CLIENT } from '../dynamo/dynamo.module';
import { TABLE_NAME } from '../dynamo/dynamo.config';
import type { ProjectItem } from '../dynamo/items';
import {
  orgProjectsQuery,
  projectByIdQuery,
  projectGsi1,
  projectKey,
} from '../dynamo/keys';

/**
 * Storage access for project items.
 *
 * Repositories return *items*, not API contracts. Mapping to `ProjectSummary`
 * happens in the service, so the layer that knows about `PK` and `GSI1PK` and
 * the layer that knows about HTTP never overlap.
 */
@Injectable()
export class ProjectsRepository {
  constructor(
    @Inject(DYNAMO_CLIENT) private readonly db: DynamoDBDocumentClient,
  ) {}

  /** Access pattern 4: `PK = ORG#y, SK begins_with PROJECT#`. */
  async listByOrg(orgId: string): Promise<ProjectItem[]> {
    const result = await this.db.send(
      new QueryCommand({ TableName: TABLE_NAME, ...orgProjectsQuery(orgId) }),
    );

    return (result.Items ?? []) as ProjectItem[];
  }

  async get(orgId: string, projectId: string): Promise<ProjectItem | null> {
    const result = await this.db.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: projectKey(orgId, projectId),
      }),
    );

    return (result.Item as ProjectItem | undefined) ?? null;
  }

  /**
   * Resolve a project by id alone, through GSI1.
   *
   * The scan endpoints are addressed as `/api/projects/:id/...` with no org in
   * the path, so this is the lookup that turns a URL into a partition. Limit 1
   * because a project id is unique across orgs by construction.
   */
  async findById(projectId: string): Promise<ProjectItem | null> {
    const result = await this.db.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        ...projectByIdQuery(projectId),
        Limit: 1,
      }),
    );

    return (result.Items?.[0] as ProjectItem | undefined) ?? null;
  }

  /**
   * Create a project, failing if the id is taken.
   *
   * `attribute_not_exists(PK)` makes this a conditional write rather than a
   * read-then-write: DynamoDB has no unique constraint, and a "does it exist?"
   * query followed by a `Put` is a race that two concurrent requests both win.
   * The condition is evaluated inside the same operation, so exactly one wins.
   */
  async create(
    orgId: string,
    request: CreateProjectRequest,
  ): Promise<ProjectItem> {
    const item: ProjectItem = {
      ...projectKey(orgId, request.projectId),
      ...projectGsi1(orgId, request.projectId),
      type: 'project',
      orgId,
      projectId: request.projectId,
      name: request.name,
      repo: request.repo,
      defaultBranch: request.defaultBranch,
      createdAt: new Date().toISOString(),
      latestCounts: { ...EMPTY_SEVERITY_COUNTS },
    };

    try {
      await this.db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConflictException(
          `Project "${request.projectId}" already exists in org "${orgId}"`,
        );
      }
      throw error;
    }

    return item;
  }

  /**
   * Denormalise a scan's rollup onto the project item (see `ProjectItem`).
   *
   * Guarded by "only if this scan is newer than the one already projected".
   * Without the condition, seeding history out of order — or two scans landing
   * concurrently — would leave the project list showing counts from an older
   * scan, and nothing would ever notice because both writes succeed.
   *
   * A failed condition is the expected outcome for an older scan, not an error.
   */
  async applyScanRollup(
    orgId: string,
    projectId: string,
    scannedAt: string,
    counts: SeverityCounts,
  ): Promise<void> {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: projectKey(orgId, projectId),
          UpdateExpression: 'SET latestScanAt = :at, latestCounts = :counts',
          ConditionExpression:
            'attribute_exists(PK) AND (attribute_not_exists(latestScanAt) OR latestScanAt < :at)',
          ExpressionAttributeValues: { ':at': scannedAt, ':counts': counts },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return;
      }
      throw error;
    }
  }
}
