import * as pulumi from '@pulumi/pulumi';

/**
 * The single-table key attributes (SPEC.md §5). These mirror
 * `apps/api/src/app/dynamo/keys.ts` — the table schema lives in two places on
 * purpose: the app code owns the queries, Pulumi owns the provisioned
 * resource, and both must agree on attribute names.
 */

export const GSI1_NAME = 'GSI1';
export const GSI1_PARTITION = 'GSI1PK';
export const GSI1_SORT = 'GSI1SK';

export type AutoscaleTarget = {
  name: pulumi.Output<string>;
  arn: pulumi.Output<string>;
};
