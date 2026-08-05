/**
 * DynamoDB connection settings, read from the environment.
 *
 * Plain `process.env` rather than `@nestjs/config`: there are three settings, no
 * schema to validate beyond "is it a URL", and no `.env` loading to do — Lambda
 * injects environment variables directly and local runs get the defaults below.
 * Adding a configuration package here would be ceremony, not safety.
 */

/** Single table for every entity (SPEC.md §104). */
export const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'config-scanner';

/**
 * Endpoint override.
 *
 * Defaults to DynamoDB Local because M1–M3 run entirely locally (SPEC.md §323)
 * and a missing variable should start a working dev environment, not reach for
 * an AWS account that does not exist yet. Production sets this explicitly to the
 * real regional endpoint — an explicit URL either way, so there is no
 * empty-string-means-production trap.
 */
export const DYNAMODB_ENDPOINT =
  process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

export const AWS_REGION = process.env.AWS_REGION ?? 'eu-west-1';

/** True when pointed at DynamoDB Local rather than the real service. */
export function isLocalEndpoint(endpoint: string = DYNAMODB_ENDPOINT): boolean {
  try {
    const { hostname } = new URL(endpoint);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'dynamodb'
    );
  } catch {
    return false;
  }
}
