import { Inject, Injectable } from '@nestjs/common';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME } from '../dynamo/dynamo.config';
import { DYNAMO_CLIENT } from '../dynamo/dynamo.module';
import type { PackageIndexItem } from '../dynamo/items';
import { packageUsageQuery } from '../dynamo/keys';

@Injectable()
export class PackagesRepository {
  constructor(
    @Inject(DYNAMO_CLIENT) private readonly db: DynamoDBDocumentClient,
  ) {}

  /**
   * Access pattern 5, blast radius: `GSI1PK = PKG#<name>@<version>`.
   *
   * One query against one partition of the index, regardless of how many
   * projects or scans exist. This is the pattern the sparse index was built for
   * — without GSI1 the same question would be a full table scan filtered in the
   * application, which gets slower every time the product succeeds.
   */
  async usage(name: string, version: string): Promise<PackageIndexItem[]> {
    const result = await this.db.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        ...packageUsageQuery(name, version),
      }),
    );

    return (result.Items ?? []) as PackageIndexItem[];
  }
}
