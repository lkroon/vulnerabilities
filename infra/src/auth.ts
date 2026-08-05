import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import type { StackConfig } from './config';

export interface CognitoResources {
  userPool: aws.cognito.UserPool;
  userPoolClient: aws.cognito.UserPoolClient;
  /** The hosted-UI base URL, e.g. https://x.auth.eu-west-1.amazoncognito.com */
  domain: pulumi.Output<string>;
}

/**
 * Cognito, provisioned from the same Pulumi program as everything else
 * (SPEC.md §307): auth infra is part of the IaC story, and least-privilege
 * IAM follows naturally because the Lambda role is scoped in the same state.
 *
 * The tradeoff — it is the most AWS-coupled choice and the first thing to be
 * rewritten if the app ever moved — is recorded in the README.
 */
export function createAuth(
  config: StackConfig,
  cloudFrontUrl: pulumi.Output<string>,
): CognitoResources {
  const userPool = new aws.cognito.UserPool(`user-pool-${config.stack}`, {
    name: `config-scanner-${config.stack}`,
    // Email is the username. usernameAttributes and aliasAttributes are
    // mutually exclusive — with the email as username, aliases are redundant.
    usernameAttributes: ['email'],
    autoVerifiedAttributes: ['email'],
    // No SMS anywhere: SMS verification bills per message and per signup
    // (SPEC.md §12a). Email verification is free at this scale.
    mfaConfiguration: 'OFF',
    passwordPolicy: {
      minimumLength: 8,
      requireLowercase: true,
      requireUppercase: true,
      requireNumbers: true,
      requireSymbols: true,
      temporaryPasswordValidityDays: 7,
    },
    schemas: [
      {
        name: 'email',
        attributeDataType: 'String',
        required: true,
        mutable: true,
      },
    ],
  });

  // The hosted-UI domain: without this resource the authorize/token endpoints
  // have no URL to live at. Created for its side effect; the URL is derived
  // from the config value, not the resource output.
  new aws.cognito.UserPoolDomain(`user-pool-domain-${config.stack}`, {
    domain: config.cognitoDomain,
    userPoolId: userPool.id,
  });

  const domain = pulumi.interpolate`https://${config.cognitoDomain}.auth.${config.region}.amazoncognito.com`;

  const userPoolClient = new aws.cognito.UserPoolClient(
    `user-pool-client-${config.stack}`,
    {
      name: `config-scanner-web-${config.stack}`,
      userPoolId: userPool.id,
      // Public client (hosted UI + PKCE): no secret to ship to a browser
      // bundle. Fine for this threat model — the API trusts the JWT, not the
      // client secret (SPEC.md §9).
      generateSecret: false,
      allowedOauthFlows: ['code'],
      allowedOauthFlowsUserPoolClient: true,
      allowedOauthScopes: ['email', 'openid', 'profile'],
      callbackUrls: [
        cloudFrontUrl.apply((url) => `${url}/auth/callback`),
        'http://localhost:4200/auth/callback',
      ],
      logoutUrls: [cloudFrontUrl, 'http://localhost:4200'],
      supportedIdentityProviders: ['COGNITO'],
      explicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH'],
    },
  );

  return { userPool, userPoolClient, domain };
}
