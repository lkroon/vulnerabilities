import { Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AWS_REGION } from '../dynamo/dynamo.config';
import { FINDINGS_STORE } from './findings-store';
import { LocalFindingsStore } from './local-findings-store';
import { S3FindingsStore } from './s3-findings-store';

/**
 * Binds the findings store token to an implementation.
 *
 * The switch is one environment variable: FINDINGS_BUCKET set means deployed
 * (M4), unset means local development. Nothing that consumes findings knows
 * which one it got — that is the whole reason the token exists.
 */
@Module({
  providers: [
    {
      provide: FINDINGS_STORE,
      useFactory: () => {
        if (process.env.FINDINGS_BUCKET) {
          return new S3FindingsStore(new S3Client({ region: AWS_REGION }));
        }
        return new LocalFindingsStore();
      },
    },
  ],
  exports: [FINDINGS_STORE],
})
export class FindingsModule {}
