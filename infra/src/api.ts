import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StackConfig } from './config';
import type { CognitoResources } from './auth';

export interface ApiCore {
  gateway: aws.apigatewayv2.Api;
  integration: aws.apigatewayv2.Integration;
  gatewayUrl: pulumi.Output<string>;
  gatewayHost: pulumi.Output<string>;
  lambda: aws.lambda.Function;
}

/**
 * Phase 1: the Lambda and the gateway, no auth.
 *
 * Split from the authorizer on purpose. The dependency graph has one cycle —
 * the Cognito client's callback URL is the CloudFront URL, whose API origin
 * is the gateway, whose authorizer needs the Cognito pool. Splitting the
 * gateway into "core" (Lambda + gateway + integration, no auth dependency)
 * and "authorizer" (attached after Cognito exists) turns the cycle into a
 * DAG without changing a single deployed resource.
 *
 * Nest ships as a Lambda zip (SPEC.md §323); API Gateway HTTP API fronts it.
 */
export function createApiCore(
  config: StackConfig,
  database: aws.dynamodb.Table,
  findingsBucket: aws.s3.Bucket,
): ApiCore {
  const lambdaRole = new aws.iam.Role(`lambda-role-${config.stack}`, {
    name: `config-scanner-lambda-${config.stack}`,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'lambda.amazonaws.com',
    }),
  });

  // Least privilege, stated as a list (SPEC.md §257). The repositories use
  // exactly Get/Put/Query/Update/BatchWrite and the findings store uses S3
  // Get/Put — nothing broader.
  new aws.iam.RolePolicy(`lambda-policy-${config.stack}`, {
    role: lambdaRole.id,
    policy: pulumi
      .all([database.arn, findingsBucket.arn])
      .apply(([tableArn, bucketArn]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:UpdateItem',
                'dynamodb:BatchWriteItem',
              ],
              Resource: tableArn,
            },
            {
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:PutObject'],
              Resource: `${bucketArn}/*`,
            },
          ],
        }),
      ),
  });

  // 7-day log retention (SPEC.md §318): logs are diagnostics, not archives,
  // and every retained byte bills forever.
  new aws.cloudwatch.LogGroup(`lambda-logs-${config.stack}`, {
    name: pulumi.interpolate`/aws/lambda/config-scanner-api-${config.stack}`,
    retentionInDays: 7,
  });

  const apiDist = path.resolve(__dirname, '..', '..', config.apiDistDir);
  const serverlessJs = path.join(apiDist, 'serverless.js');
  const packageJson = path.join(apiDist, 'package.json');
  const nodeModules = path.join(apiDist, 'node_modules');
  for (const required of [serverlessJs, packageJson, nodeModules]) {
    if (!fs.existsSync(required)) {
      throw new Error(
        `Lambda artifact missing at ${required}. Run the lambda packaging ` +
          `step first (README "Deploying"): it produces serverless.js, a ` +
          `pruned package.json and a prod-only node_modules.`,
      );
    }
  }

  const lambda = new aws.lambda.Function(`api-lambda-${config.stack}`, {
    name: `config-scanner-api-${config.stack}`,
    runtime: 'nodejs22.x',
    handler: 'serverless.handler',
    role: lambdaRole.arn,
    timeout: 30,
    memorySize: 512,
    // The hard cap on parallel invocations (SPEC.md §12a). A runaway loop
    // cannot scale past this, which is what makes the bill bounded.
    reservedConcurrentExecutions: config.lambdaConcurrency,
    // Serverless-express needs the bundled app plus its external
    // dependencies; Pulumi packs these into the deployment zip.
    code: new pulumi.asset.AssetArchive({
      'serverless.js': new pulumi.asset.FileAsset(serverlessJs),
      'package.json': new pulumi.asset.FileAsset(packageJson),
      node_modules: new pulumi.asset.FileArchive(nodeModules),
    }),
    environment: {
      variables: {
        DYNAMODB_TABLE: database.name,
        // Explicit real endpoint — the config code rejects the empty-string
        // trap and the local default on purpose (dynamo.config.ts).
        DYNAMODB_ENDPOINT: pulumi.interpolate`https://dynamodb.${config.region}.amazonaws.com`,
        AWS_REGION: config.region,
        FINDINGS_BUCKET: findingsBucket.id,
        NODE_ENV: 'production',
      },
    },
  });

  const gateway = new aws.apigatewayv2.Api(`api-gateway-${config.stack}`, {
    name: `config-scanner-${config.stack}`,
    protocolType: 'HTTP',
  });

  new aws.apigatewayv2.Stage(`api-stage-${config.stack}`, {
    apiId: gateway.id,
    name: '$default',
    autoDeploy: true,
    // Per-second throttle (SPEC.md §12a): a runaway script cannot generate
    // an unbounded request bill.
    defaultRouteSettings: {
      throttlingBurstLimit: config.apiBurstLimit,
      throttlingRateLimit: config.apiRateLimit,
    },
  });

  const integration = new aws.apigatewayv2.Integration(
    `api-integration-${config.stack}`,
    {
      apiId: gateway.id,
      integrationType: 'AWS_PROXY',
      integrationUri: lambda.invokeArn,
      payloadFormatVersion: '2.0',
    },
  );

  new aws.lambda.Permission(`api-invoke-${config.stack}`, {
    action: 'lambda:InvokeFunction',
    function: lambda.name,
    principal: 'apigateway.amazonaws.com',
    sourceArn: pulumi.interpolate`${gateway.executionArn}/*/*`,
  });

  return {
    gateway,
    integration,
    gatewayUrl: gateway.apiEndpoint,
    gatewayHost: gateway.apiEndpoint.apply((url) => new URL(url).host),
    lambda,
  };
}

/**
 * Phase 2: the JWT authorizer and the catch-all route.
 *
 * Auth lives at the gateway, not in the Lambda: HTTP API validates the
 * Cognito JWT before the function ever runs, so the Lambda has no token
 * code, and the local dev server stays open by design (it is not reachable
 * from the internet — SPEC.md §9).
 */
export function attachAuthorizer(
  config: StackConfig,
  core: ApiCore,
  cognito: CognitoResources,
): void {
  const authorizer = new aws.apigatewayv2.Authorizer(
    `api-authorizer-${config.stack}`,
    {
      apiId: core.gateway.id,
      authorizerType: 'JWT',
      identitySources: ['$request.header.Authorization'],
      jwtConfiguration: {
        audiences: [cognito.userPoolClient.id],
        issuer: pulumi.interpolate`https://cognito-idp.${config.region}.amazonaws.com/${cognito.userPool.id}`,
      },
    },
  );

  new aws.apigatewayv2.Route(`api-route-${config.stack}`, {
    apiId: core.gateway.id,
    routeKey: '$default',
    target: pulumi.interpolate`integrations/${core.integration.id}`,
    authorizerId: authorizer.id,
  });
}
