import { readConfig } from './config';
import { createDatabase } from './database';
import { createAuth } from './auth';
import { attachAuthorizer, createApiCore } from './api';
import { createBudgetGuardrail } from './guardrails';
import {
  createWeb,
  privateBucket,
  uploadWebAssets,
  writeConfigObject,
} from './web';

/**
 * Config Scanner infrastructure (SPEC.md §8).
 *
 * One program, two stacks (dev/prod) that differ by configuration, not code:
 * the stack configs in Pulumi.{dev,prod}.yaml are the only per-environment
 * inputs, and every resource below is declared identically.
 *
 * The order here is the dependency DAG made linear. The one cycle in the
 * design — Cognito's callback URL is the CloudFront URL, whose API origin is
 * the gateway, whose authorizer needs the Cognito pool — is broken by
 * splitting the gateway into an unauth'd core and a late-attached authorizer
 * (api.ts). Commented phases mirror that split.
 */

// §12a: the alert guardrail lands first, so the alarm exists before anything
// that can bill.
const config = readConfig();
createBudgetGuardrail(config);

const database = createDatabase(config);

const webBucket = privateBucket('web', config.stack);
const findingsBucket = privateBucket('findings', config.stack);

// Phase 1: Lambda + gateway + integration (no Cognito dependency).
const apiCore = createApiCore(config, database, findingsBucket);

// The distribution names the gateway as its /api origin; it exists before
// Cognito so the callback URL can reference its domain. Web assets and the
// runtime config land in the same program run.
const web = createWeb(
  config,
  webBucket,
  apiCore.gatewayUrl,
  apiCore.gatewayHost,
);

// Phase 2: Cognito — the client's callback URL is the CloudFront URL above.
const auth = createAuth(config, web.cloudFrontUrl);

// Phase 3: authorizer + route, wired to both the gateway core and Cognito.
attachAuthorizer(config, apiCore, auth);

uploadWebAssets(config, webBucket);
writeConfigObject(config, webBucket, web.cloudFrontUrl, {
  userPoolId: auth.userPool.id,
  clientId: auth.userPoolClient.id,
  domain: auth.domain,
  region: config.region,
});

export const webUrl = web.cloudFrontUrl;
export const apiUrl = apiCore.gatewayUrl;
export const tableName = database.name;
export const cognitoPoolId = auth.userPool.id;
export const cognitoClientId = auth.userPoolClient.id;
