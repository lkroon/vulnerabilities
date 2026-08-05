import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { GSI1_PARTITION, GSI1_SORT, GSI1_NAME } from './keys';
import type { StackConfig } from './config';

/**
 * The single DynamoDB table (SPEC.md §104), provisioned and auto-scaled.
 *
 * Local development uses PAY_PER_REQUEST (create-table.ts). Deployed, the
 * table runs in provisioned mode with Application Auto Scaling between 1 and
 * the configured maximum — the only way to put a real ceiling on throughput.
 * On-demand mode has no maximum: a runaway scan loop would scale the table up
 * and the bill with it (SPEC.md §318, §12a). The minimum of 1 RCU/WCU keeps
 * idle cost at pennies, and auto-scaling keeps the common case at the minimum
 * because this workload is bursty, not steady.
 */
export function createDatabase(config: StackConfig): aws.dynamodb.Table {
  const table = new aws.dynamodb.Table(
    `database-${config.stack}`,
    {
      name: `config-scanner-${config.stack}`,
      attributes: [
        { name: GSI1_PARTITION, type: 'S' },
        { name: GSI1_SORT, type: 'S' },
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
      ],
      hashKey: 'PK',
      rangeKey: 'SK',
      // Sparse by construction (SPEC.md §186): only items that carry GSI1PK
      // appear in the index. Projecting ALL keeps the blast-radius lookup a
      // single query — mirror of the local create-table.ts.
      globalSecondaryIndexes: [
        {
          name: GSI1_NAME,
          keySchemas: [
            { attributeName: GSI1_PARTITION, keyType: 'HASH' },
            { attributeName: GSI1_SORT, keyType: 'RANGE' },
          ],
          projectionType: 'ALL',
        },
      ],
      // PKG# index rows expire after ~90 days (SPEC.md §192).
      ttl: { attributeName: 'ttl', enabled: true },
      billingMode: 'PROVISIONED',
      readCapacity: 1,
      writeCapacity: 1,
    },
    { protect: true },
  );

  autoscale(table.name, table.arn, 'read', config.dbReadMax);
  autoscale(table.name, table.arn, 'write', config.dbWriteMax);

  return table;
}

function autoscale(
  tableName: pulumi.Output<string>,
  tableArn: pulumi.Output<string>,
  dimension: 'read' | 'write',
  max: number,
): void {
  const resourceId = tableName.apply((name) => `table/${name}`);
  const dimensionName =
    dimension === 'read'
      ? 'dynamodb:table:ReadCapacityUnits'
      : 'dynamodb:table:WriteCapacityUnits';

  const target = new aws.appautoscaling.Target(
    `dynamodb-${dimension}-${pulumi.getStack()}`,
    {
      serviceNamespace: 'dynamodb',
      resourceId,
      scalableDimension: dimensionName,
      minCapacity: 1,
      maxCapacity: max,
    },
  );

  new aws.appautoscaling.Policy(
    `dynamodb-${dimension}-policy-${pulumi.getStack()}`,
    {
      serviceNamespace: 'dynamodb',
      resourceId,
      scalableDimension: dimensionName,
      policyType: 'TargetTrackingScaling',
      targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
          predefinedMetricType:
            dimension === 'read'
              ? 'DynamoDBReadCapacityUtilization'
              : 'DynamoDBWriteCapacityUtilization',
        },
        targetValue: 70,
        scaleInCooldown: 300,
        scaleOutCooldown: 300,
      },
    },
  );
}
