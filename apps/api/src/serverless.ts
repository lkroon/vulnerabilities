/**
 * Lambda entry point (M4).
 *
 * API Gateway HTTP API receives the request, validates the Cognito JWT at the
 * gateway (authorizer), then forwards the raw event to this handler, which
 * runs the same Nest app as local development (see app-factory.ts) inside
 * @vendia/serverless-express.
 *
 * The server is cached across warm invocations: creating a Nest app costs a
 * module scan, decorator wiring and a connection pool — doing it per request
 * would add a second of cold-start latency to every call. The event/context
 * passed to the returned handler must go through serverless-express untouched,
 * hence the loose `any` types on the exported handler signature.
 */

import { Logger } from '@nestjs/common';
import serverlessExpress from '@vendia/serverless-express';
import { createApp } from './app/app-factory';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrapServer() {
  if (cachedServer) {
    return cachedServer;
  }

  // Let Nest create its own Express instance (as in main.ts — one pipeline for
  // both runtimes) and ask for it afterwards. Importing express directly would
  // pin the hoisted copy in the Lambda package (express 4) while the adapter
  // runs the nested one (express 5, via @nestjs/platform-express's own
  // dependency), and mixing two express majors in one process breaks
  // `app.router` access in the adapter. Taking Nest's instance makes the
  // versions agree by construction.
  const app = await createApp();
  await app.init();

  const expressApp = app.getHttpAdapter().getInstance();
  cachedServer = serverlessExpress({ app: expressApp });
  Logger.log('Lambda handler initialised', 'Serverless');
  return cachedServer;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lambda event
// shape is AWS-defined and opaque; serverless-express types it loosely.
export async function handler(event: any, context: any) {
  const server = await bootstrapServer();
  return server(event, context);
}
