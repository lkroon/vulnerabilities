/**
 * Load seed data into DynamoDB Local. Run with `npm run db:seed`.
 *
 * Writes the same items the API writes, through the same key builders and the
 * same findings store — not a hand-rolled copy of the model. If the key design
 * changes and this script is not updated, it stops compiling rather than
 * quietly seeding rows that no query will ever match.
 *
 * Idempotent: every write is an unconditional `Put`, so re-running replaces the
 * seed rows in place. It does not delete anything else, so a scan uploaded by
 * hand survives a re-seed.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { EMPTY_SEVERITY_COUNTS } from '@config-scanner/shared-types';
import {
  AWS_REGION,
  DYNAMODB_ENDPOINT,
  TABLE_NAME,
  isLocalEndpoint,
} from '../app/dynamo/dynamo.config';
import type { ProjectItem, ScanItem } from '../app/dynamo/items';
import { projectGsi1, projectKey, scanKey } from '../app/dynamo/keys';
import {
  exceedsInlineLimit,
  findingsKey,
} from '../app/findings/findings-store';
import { LocalFindingsStore } from '../app/findings/local-findings-store';
import { packageIndexRows } from '../app/scans/package-index';
import { SEED_ORG, SEED_PROJECTS, seedCounts } from './seed-data';

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: AWS_REGION,
    endpoint: DYNAMODB_ENDPOINT,
    ...(isLocalEndpoint()
      ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const findingsStore = new LocalFindingsStore();

async function putItem(item: ProjectItem | ScanItem): Promise<void> {
  await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

async function main(): Promise<void> {
  if (!isLocalEndpoint()) {
    throw new Error(
      `Refusing to seed ${DYNAMODB_ENDPOINT}. Seed data is for local development only.`,
    );
  }

  let scanCount = 0;
  let spillCount = 0;
  let indexRowCount = 0;

  for (const project of SEED_PROJECTS) {
    // Scans are seeded oldest first so the rollup on the project item and the
    // `lastSeen` on each package row end up reflecting the newest scan —
    // exactly as they would if the scans had arrived over time.
    const scans = [...project.scans].sort((a, b) =>
      a.scannedAt.localeCompare(b.scannedAt),
    );
    const latest = scans.at(-1);

    const projectItem: ProjectItem = {
      ...projectKey(SEED_ORG, project.projectId),
      ...projectGsi1(SEED_ORG, project.projectId),
      type: 'project',
      orgId: SEED_ORG,
      projectId: project.projectId,
      name: project.name,
      repo: project.repo,
      defaultBranch: project.defaultBranch,
      createdAt: '2026-04-01T00:00:00.000Z',
      ...(latest ? { latestScanAt: latest.scannedAt } : {}),
      latestCounts: latest ? seedCounts(latest) : { ...EMPTY_SEVERITY_COUNTS },
    };

    await putItem(projectItem);

    for (const scan of scans) {
      const counts = seedCounts(scan);
      const spilled = exceedsInlineLimit(scan.findings);
      const ref = findingsKey(project.projectId, scan.scannedAt);

      if (spilled) {
        await findingsStore.put(ref, scan.findings);
        spillCount++;
      }

      const scanItem: ScanItem = {
        ...scanKey(project.projectId, scan.scannedAt),
        type: 'scan',
        projectId: project.projectId,
        scannedAt: scan.scannedAt,
        status: 'completed',
        manifest: 'package-lock.json',
        commit: scan.commit,
        durationMs: scan.durationMs,
        counts,
        findingCount: scan.findings.length,
        ...(spilled ? { findingsRef: ref } : { findings: scan.findings }),
      };

      await putItem(scanItem);
      scanCount++;

      const rows = packageIndexRows(
        SEED_ORG,
        project.projectId,
        scan.findings,
        new Date(scan.scannedAt),
      );

      for (let start = 0; start < rows.length; start += 25) {
        await db.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: rows
                .slice(start, start + 25)
                .map((Item) => ({ PutRequest: { Item } })),
            },
          }),
        );
      }
      indexRowCount += rows.length;
    }
  }

  console.log(
    `Seeded ${SEED_PROJECTS.length} projects, ${scanCount} scans (${spillCount} spilled to the findings store) and ${indexRowCount} package index rows into "${TABLE_NAME}".`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
