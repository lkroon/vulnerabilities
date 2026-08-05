import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StackConfig } from './config';

/**
 * Managed cache policy IDs (AWS-published, stable across accounts).
 * Hardcoding beats recreating equivalent policies in every stack.
 */
const CACHE_POLICY_CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const CACHE_POLICY_CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const ORIGIN_REQUEST_POLICY_ALL_VIEWER = '216adef6-5c7f-47e4-b989-5492eafa07d3';

export interface WebResources {
  webBucket: aws.s3.Bucket;
  distribution: aws.cloudfront.Distribution;
  cloudFrontUrl: pulumi.Output<string>;
}

export function privateBucket(name: string, stack: string): aws.s3.Bucket {
  const bucket = new aws.s3.Bucket(`${name}-${stack}`, {
    bucket: `config-scanner-${name}-${stack}`,
  });
  new aws.s3.BucketPublicAccessBlock(`${name}-public-block-${stack}`, {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
  return bucket;
}

/**
 * The web bucket, the findings bucket, and the CloudFront distribution that
 * fronts both — the SPA and the `/api` origin — so the deployed app makes
 * same-origin requests and CORS never appears in the picture.
 */
export function createWeb(
  config: StackConfig,
  webBucket: aws.s3.Bucket,
  apiGatewayUrl: pulumi.Output<string>,
  apiGatewayHost: pulumi.Output<string>,
): WebResources {
  const oac = new aws.cloudfront.OriginAccessControl(
    `web-oac-${config.stack}`,
    {
      description: 'Config Scanner SPA origin access',
      originAccessControlOriginType: 's3',
      signingBehavior: 'always',
      signingProtocol: 'sigv4',
    },
  );

  const distribution = new aws.cloudfront.Distribution(
    `web-distribution-${config.stack}`,
    {
      comment: `Config Scanner ${config.stack}`,
      enabled: true,
      defaultRootObject: 'index.html',
      priceClass: 'PriceClass_100',
      // No custom domain for v1 — the *.cloudfront.net URL is the endpoint.
      // ACM + Route53 would add per-hour billable friction for zero demo value.
      viewerCertificate: {
        cloudfrontDefaultCertificate: true,
      },
      restrictions: { geoRestriction: { restrictionType: 'none' } },
      origins: [
        {
          originId: 'web',
          domainName: webBucket.bucketRegionalDomainName,
          originAccessControlId: oac.id,
        },
        {
          originId: 'api',
          domainName: apiGatewayHost,
          customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: 'https-only',
            originSslProtocols: ['TLSv1.2'],
          },
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: 'web',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachePolicyId: CACHE_POLICY_CACHING_OPTIMIZED,
        compress: true,
      },
      orderedCacheBehaviors: [
        {
          // Hashed assets are immutable — one-year cache is safe and keeps
          // repeat loads off the origin.
          pathPattern: '*.js',
          targetOriginId: 'web',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachePolicyId: CACHE_POLICY_CACHING_OPTIMIZED,
          compress: true,
        },
        {
          // index.html must never be cached: a stale HTML file points at old
          // bundles after a deploy.
          pathPattern: 'index.html',
          targetOriginId: 'web',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachePolicyId: CACHE_POLICY_CACHING_DISABLED,
        },
        {
          // Runtime config is written by Pulumi itself at deploy time and read
          // on every boot — caching it would serve stale auth endpoints.
          pathPattern: 'config.json',
          targetOriginId: 'web',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachePolicyId: CACHE_POLICY_CACHING_DISABLED,
        },
        {
          // The API must not be cached and must see the Authorization header
          // (the Cognito JWT). AllViewer forwards headers; the disabled cache
          // policy means nothing is cached even without Cache-Control headers
          // from API Gateway.
          pathPattern: '/api/*',
          targetOriginId: 'api',
          viewerProtocolPolicy: 'https-only',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
          cachedMethods: ['GET', 'HEAD'],
          cachePolicyId: CACHE_POLICY_CACHING_DISABLED,
          originRequestPolicyId: ORIGIN_REQUEST_POLICY_ALL_VIEWER,
        },
      ],
      // SPA deep links (e.g. /projects/p1/scans/2026-...) hit the origin as
      // 403/404; serve index.html instead so client-side routing takes over.
      customErrorResponses: [
        { errorCode: 403, responseCode: 200, responsePagePath: '/index.html' },
        { errorCode: 404, responseCode: 200, responsePagePath: '/index.html' },
      ],
    },
  );

  return {
    webBucket,
    distribution,
    cloudFrontUrl: pulumi.interpolate`https://${distribution.domainName}`,
  };
}

/**
 * Upload the Angular build output to the web bucket, with correct cache
 * headers. Content hashing (FileAsset) makes Pulumi re-upload only changed
 * files.
 *
 * Uploading from the program rather than `aws s3 sync` in CI keeps the whole
 * deployment one command and one state file — the artifact list is part of
 * the stack, so a deploy is reproducible and previewable.
 */
export function uploadWebAssets(
  config: StackConfig,
  webBucket: aws.s3.Bucket,
): void {
  const dist = path.resolve(__dirname, '..', '..', config.webDistDir);
  if (!fs.existsSync(dist)) {
    throw new Error(
      `Web build not found at ${dist}. Run 'npx nx run web:build' first — ` +
        `the Pulumi program deploys the compiled app, not the source.`,
    );
  }

  for (const file of walk(dist)) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    // Angular's prerendered-routes.json is a build-time artifact the browser
    // never requests.
    if (rel === 'prerendered-routes.json') {
      continue;
    }
    const hashed = /[-.][A-Za-z0-9_-]{8,16}\.(?:js|css|woff2?)$/.test(rel);
    new aws.s3.BucketObjectv2(`web-asset-${config.stack}-${rel}`, {
      bucket: webBucket.id,
      key: rel,
      source: new pulumi.asset.FileAsset(file),
      contentType: contentTypeFor(rel),
      cacheControl: hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
}

/**
 * Pulumi writes the runtime config the SPA fetches at boot. This is the
 * "stack outputs feed app configuration" requirement (SPEC.md §8): the same
 * program that creates the resources publishes the endpoints that consume
 * them, so they can never drift apart.
 */
export function writeConfigObject(
  config: StackConfig,
  webBucket: aws.s3.Bucket,
  cloudFrontUrl: pulumi.Output<string>,
  cognito: {
    userPoolId: pulumi.Output<string>;
    clientId: pulumi.Output<string>;
    domain: pulumi.Output<string>;
    region: string;
  },
): void {
  const body = pulumi
    .all([cloudFrontUrl, cognito.userPoolId, cognito.domain])
    .apply(([url, poolId, domain]) =>
      JSON.stringify(
        {
          apiUrl: `${url}/api`,
          auth: {
            enabled: true,
            region: cognito.region,
            issuer: `https://cognito-idp.${cognito.region}.amazonaws.com/${poolId}`,
            clientId: cognito.clientId,
            domain,
            redirectUri: `${url}/auth/callback`,
          },
        },
        null,
        2,
      ),
    );

  new aws.s3.BucketObjectv2(`web-config-${config.stack}`, {
    bucket: webBucket.id,
    key: 'config.json',
    content: body,
    contentType: 'application/json',
    cacheControl: 'no-cache',
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const table: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };
  return table[ext] ?? 'application/octet-stream';
}
