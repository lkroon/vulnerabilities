import { Global, Logger, Module } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  AWS_REGION,
  DYNAMODB_ENDPOINT,
  TABLE_NAME,
  isLocalEndpoint,
} from './dynamo.config';

export const DYNAMO_CLIENT = 'DYNAMO_CLIENT';

/**
 * The DynamoDB document client, shared process-wide.
 *
 * `DynamoDBDocumentClient` rather than the bare client: it marshals plain JS
 * values to and from AttributeValue shapes, so repositories deal in
 * `{ counts: { high: 3 } }` instead of `{ counts: { M: { high: { N: '3' } } } }`.
 * The heterogeneous findings array is exactly the case where hand-marshalling
 * would be both tedious and easy to get subtly wrong.
 *
 * Global because a Lambda container reuses this client across invocations, and
 * one client means one connection pool and one credential resolution. Creating
 * it per request is the classic serverless latency mistake.
 */
@Global()
@Module({
  providers: [
    {
      provide: DYNAMO_CLIENT,
      useFactory: (): DynamoDBDocumentClient => {
        const local = isLocalEndpoint();

        const client = new DynamoDBClient({
          region: AWS_REGION,
          endpoint: DYNAMODB_ENDPOINT,
          // DynamoDB Local requires credentials to be present but never
          // validates them. In AWS these are omitted so the default provider
          // chain resolves the Lambda execution role — no keys anywhere
          // (SPEC.md §257).
          ...(local
            ? {
                credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
              }
            : {}),
        });

        Logger.log(
          `DynamoDB: table "${TABLE_NAME}" at ${DYNAMODB_ENDPOINT}${local ? ' (local)' : ''}`,
          'DynamoModule',
        );

        return DynamoDBDocumentClient.from(client, {
          marshallOptions: {
            // A scan with no findings must round-trip as `[]`, and an unscanned
            // project as `null`, so neither can be confused with "attribute
            // missing" on read.
            removeUndefinedValues: true,
          },
        });
      },
    },
  ],
  exports: [DYNAMO_CLIENT],
})
export class DynamoModule {}
