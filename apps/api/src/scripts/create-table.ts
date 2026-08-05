/**
 * Create the single table and its overloaded GSI against DynamoDB Local.
 *
 * Run with `npm run db:create-table`. Idempotent: an existing table is left
 * alone unless `--recreate` is passed.
 *
 * This script is for local development only. In AWS the table is a Pulumi
 * resource (M4) — infrastructure defined twice is infrastructure that drifts,
 * so this deliberately does not grow the guardrails that belong in the Pulumi
 * program (on-demand throughput caps, deletion protection, backups).
 */
import {
  BillingMode,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  KeyType,
  ProjectionType,
  ResourceNotFoundException,
  ScalarAttributeType,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  AWS_REGION,
  DYNAMODB_ENDPOINT,
  TABLE_NAME,
  isLocalEndpoint,
} from '../app/dynamo/dynamo.config';
import { GSI1_NAME, TABLE_KEYS } from '../app/dynamo/keys';

const client = new DynamoDBClient({
  region: AWS_REGION,
  endpoint: DYNAMODB_ENDPOINT,
  ...(isLocalEndpoint()
    ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
    : {}),
});

async function tableExists(): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (!isLocalEndpoint()) {
    // The table in AWS belongs to Pulumi. Creating it by hand would leave a
    // resource no stack owns, which `pulumi up` then fights with.
    throw new Error(
      `Refusing to create a table at ${DYNAMODB_ENDPOINT}. This script targets DynamoDB Local; AWS tables come from the Pulumi program.`,
    );
  }

  const recreate = process.argv.includes('--recreate');

  if (await tableExists()) {
    if (!recreate) {
      console.log(
        `Table "${TABLE_NAME}" already exists. Pass --recreate to drop it.`,
      );
      return;
    }
    console.log(`Dropping table "${TABLE_NAME}"…`);
    await client.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      // Only the key attributes are declared. Every other attribute — findings,
      // counts, ttl — is schemaless, which is what lets one table hold
      // projects, scans and index rows with different shapes (SPEC.md §104).
      AttributeDefinitions: [
        {
          AttributeName: TABLE_KEYS.partition,
          AttributeType: ScalarAttributeType.S,
        },
        {
          AttributeName: TABLE_KEYS.sort,
          AttributeType: ScalarAttributeType.S,
        },
        {
          AttributeName: TABLE_KEYS.gsi1Partition,
          AttributeType: ScalarAttributeType.S,
        },
        {
          AttributeName: TABLE_KEYS.gsi1Sort,
          AttributeType: ScalarAttributeType.S,
        },
      ],
      KeySchema: [
        { AttributeName: TABLE_KEYS.partition, KeyType: KeyType.HASH },
        { AttributeName: TABLE_KEYS.sort, KeyType: KeyType.RANGE },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GSI1_NAME,
          KeySchema: [
            { AttributeName: TABLE_KEYS.gsi1Partition, KeyType: KeyType.HASH },
            { AttributeName: TABLE_KEYS.gsi1Sort, KeyType: KeyType.RANGE },
          ],
          // The index is sparse by construction: only items that carry GSI1PK
          // appear in it, which is every project row and every package row, and
          // no scan row. Projecting ALL keeps blast radius a single query — the
          // alternative, KEYS_ONLY, would need a follow-up GetItem per project
          // to render the same screen.
          Projection: { ProjectionType: ProjectionType.ALL },
        },
      ],
      // On-demand: portfolio traffic is bursty and near zero, and provisioned
      // capacity would bill for idle throughput (SPEC.md §318).
      BillingMode: BillingMode.PAY_PER_REQUEST,
    }),
  );

  await waitUntilTableExists(
    { client, maxWaitTime: 60 },
    { TableName: TABLE_NAME },
  );

  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: TABLE_NAME,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'ttl' },
    }),
  );

  console.log(
    `Created table "${TABLE_NAME}" with ${GSI1_NAME} and TTL on "ttl" at ${DYNAMODB_ENDPOINT}.`,
  );
  console.log(
    'Note: DynamoDB Local accepts the TTL setting but does not actually expire items — expiry is only observable in AWS.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
