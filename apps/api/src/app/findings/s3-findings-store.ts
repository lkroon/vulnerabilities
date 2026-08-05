import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Finding } from '@config-scanner/shared-types';
import type { FindingsStore } from './findings-store';

/**
 * S3-backed findings storage for deployed runs (M4).
 *
 * The M2–M3 spill escape hatch keeps working once the app leaves the laptop:
 * findings too big for a DynamoDB item go to S3 under the same keys
 * (`scans/{projectId}/{scannedAt}.json`) and are read back on demand. The
 * bucket is private; only the Lambda execution role can touch it, and the
 * keys are never exposed through the API as public URLs.
 *
 * Selected instead of LocalFindingsStore when FINDINGS_BUCKET is set — the
 * module factory below is the only place that decision lives.
 */
@Injectable()
export class S3FindingsStore implements FindingsStore {
  private readonly logger = new Logger(S3FindingsStore.name);
  private readonly bucket = process.env.FINDINGS_BUCKET as string;

  constructor(private readonly s3: S3Client) {}

  async put(key: string, findings: readonly Finding[]): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(findings),
        ContentType: 'application/json',
      }),
    );
    this.logger.log(
      `Spilled ${findings.length} findings to s3://${this.bucket}/${key}`,
    );
  }

  async get(key: string): Promise<Finding[]> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return JSON.parse(await response.Body!.transformToString()) as Finding[];
    } catch {
      // Same lie-avoidance as the local store: a scan that points at missing
      // findings is broken, not empty — a security dashboard must not render
      // "no findings" when the data is simply gone.
      throw new NotFoundException(`Findings payload ${key} is missing`);
    }
  }
}
