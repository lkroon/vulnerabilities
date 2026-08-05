import * as pulumi from '@pulumi/pulumi';

export interface StackConfig {
  /** AWS region — same for both stacks, kept in config for symmetry. */
  region: string;
  /** Monthly cost budget in USD. Alarms fire at 80% and 100%. */
  budgetAmount: number;
  /** Where budget alarm emails go. Set via `pulumi config set --secret`. */
  budgetNotifyEmail: pulumi.Output<string>;
  /** Globally unique Cognito hosted-UI domain prefix. */
  cognitoDomain: string;
  /**
   * DynamoDB autoscaling caps. Provisioned mode + a max cap is the only way
   * AWS lets you bound a runaway loop's bill — on-demand mode has no ceiling
   * (SPEC.md §318 wanted a cap, which on-demand cannot give; see
   * docs/agent-corrections.md).
   */
  dbReadMax: number;
  dbWriteMax: number;
  /** Lambda reserved concurrency — the hard cap on parallel invocations. */
  lambdaConcurrency: number;
  /** API Gateway HTTP API per-second throttle and burst. */
  apiRateLimit: number;
  apiBurstLimit: number;
  /**
   * Paths to build artifacts, relative to the workspace root (resolved from
   * `infra/bin` via `../../` in web.ts / api.ts).
   */
  webDistDir: string;
  apiDistDir: string;
  /**
   * Secrets bucket: the Lambda role is scoped to one findings bucket, and the
   * web bucket serves only the SPA. Both stay private.
   */
  stack: string;
}

/**
 * Read and validate stack config. Pulumi config keys are namespaced by the
 * project name (`config-scanner-infra`), set in Pulumi.{stack}.yaml.
 */
export function readConfig(): StackConfig {
  const config = new pulumi.Config();
  const required = (key: string): string => {
    const value = config.get(key);
    if (!value) {
      throw new Error(`Missing required config: config-scanner-infra:${key}`);
    }
    return value;
  };

  return {
    region: required('region'),
    budgetAmount: Number(required('budgetAmount')),
    budgetNotifyEmail: config.requireSecret('budgetNotifyEmail'),
    cognitoDomain: required('cognitoDomain'),
    dbReadMax: Number(required('dbReadMax')),
    dbWriteMax: Number(required('dbWriteMax')),
    lambdaConcurrency: Number(required('lambdaConcurrency')),
    apiRateLimit: Number(required('apiRateLimit')),
    apiBurstLimit: Number(required('apiBurstLimit')),
    webDistDir: config.get('webDistDir') ?? 'dist/apps/web',
    apiDistDir: config.get('apiDistDir') ?? 'dist/apps/api',
    stack: pulumi.getStack(),
  };
}
