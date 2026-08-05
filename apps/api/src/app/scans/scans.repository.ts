import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { TABLE_NAME } from '../dynamo/dynamo.config';
import type { PackageIndexItem, ScanItem } from '../dynamo/items';
import { SCAN_SUMMARY_ATTRIBUTES } from '../dynamo/items';
import { DYNAMO_CLIENT } from '../dynamo/dynamo.module';
import { projectScansQuery, scanKey } from '../dynamo/keys';

/**
 * A `ProjectionExpression` over the summary attributes, with every name aliased.
 *
 * The aliasing is not decoration: `status`, `type` and `name` are DynamoDB
 * reserved words, and using them unaliased fails the request at parse time.
 * Building the alias map from the attribute list keeps the two in step.
 */
const SUMMARY_PROJECTION = {
  ProjectionExpression: SCAN_SUMMARY_ATTRIBUTES.map(
    (_, index) => `#p${index}`,
  ).join(', '),
  ExpressionAttributeNames: Object.fromEntries(
    SCAN_SUMMARY_ATTRIBUTES.map((attribute, index) => [
      `#p${index}`,
      attribute,
    ]),
  ),
};

/** Storage access for scan snapshots and the sparse package index. */
@Injectable()
export class ScansRepository {
  constructor(
    @Inject(DYNAMO_CLIENT) private readonly db: DynamoDBDocumentClient,
  ) {}

  /**
   * Access pattern 2: scan history, newest first, summaries only.
   *
   * `ScanIndexForward: false` reads the sort key descending — the ordering comes
   * from the key design, not from sorting in the application, so the database
   * never has to read older items to return the newest ones. The projection
   * keeps `findings` out of the response, which is what makes an unbounded
   * history query affordable.
   */
  async listByProject(projectId: string, limit?: number): Promise<ScanItem[]> {
    const query = projectScansQuery(projectId);

    const result = await this.db.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        ...query,
        ProjectionExpression: SUMMARY_PROJECTION.ProjectionExpression,
        ExpressionAttributeNames: {
          ...query.ExpressionAttributeNames,
          ...SUMMARY_PROJECTION.ExpressionAttributeNames,
        },
        ScanIndexForward: false,
        ...(limit ? { Limit: limit } : {}),
      }),
    );

    return (result.Items ?? []) as ScanItem[];
  }

  /** Access pattern 1: the dashboard landing query — same as above, `Limit: 1`. */
  async latest(projectId: string): Promise<ScanItem | null> {
    const [item] = await this.listByProject(projectId, 1);

    return item ?? null;
  }

  /** Access pattern 3: one scan with its findings — a single `GetItem`. */
  async get(projectId: string, scannedAt: string): Promise<ScanItem | null> {
    const result = await this.db.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: scanKey(projectId, scannedAt),
      }),
    );

    return (result.Item as ScanItem | undefined) ?? null;
  }

  /**
   * Write a scan snapshot.
   *
   * `attribute_not_exists(SK)` enforces immutability at the database rather than
   * by convention (SPEC.md §192): a scan document is a point-in-time snapshot,
   * and a `Put` to an existing key would silently replace history. It also
   * doubles as the collision check for two scans landing in the same
   * millisecond, which the service retries with a nudged timestamp.
   */
  async put(item: ScanItem): Promise<void> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(SK)',
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConflictException(
          `A scan already exists at ${item.scannedAt} for project "${item.projectId}"`,
        );
      }
      throw error;
    }
  }

  /**
   * Upsert the sparse package index rows (SPEC.md §198, §203).
   *
   * Plain `Put`s, so a row that already exists has its `lastSeen` and `ttl`
   * refreshed — row count stays bounded by distinct vulnerable dependencies
   * rather than growing with every scan.
   *
   * `BatchWrite` caps at 25 items per call, hence the chunking. Unprocessed
   * items are retried once: a batch write reports throttled items in the
   * response instead of throwing, so code that ignores `UnprocessedItems`
   * silently drops rows and looks like it worked.
   */
  async upsertPackageIndex(rows: PackageIndexItem[]): Promise<void> {
    for (let start = 0; start < rows.length; start += 25) {
      const chunk = rows.slice(start, start + 25);

      let request: Record<
        string,
        { PutRequest: { Item: PackageIndexItem } }[]
      > = {
        [TABLE_NAME]: chunk.map((Item) => ({ PutRequest: { Item } })),
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await this.db.send(
          new BatchWriteCommand({ RequestItems: request }),
        );

        const unprocessed = result.UnprocessedItems?.[TABLE_NAME];
        if (!unprocessed?.length) break;

        request = { [TABLE_NAME]: unprocessed } as typeof request;
      }
    }
  }
}
