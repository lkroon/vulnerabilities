import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Shared Nest bootstrap for the two entry points this app can run as.
 *
 * `main.ts` (local dev, e2e) and `serverless.ts` (M4, Lambda) both build the
 * app through here, so both run the identical pipeline: the `/api` prefix and
 * the validation pipe with the same options. One pipeline for both runtimes is
 * the point — a behavior difference between local and deployed would be a time
 * bomb.
 *
 * Nest creates its own Express instance internally; the Lambda entry reads it
 * back via `app.getHttpAdapter().getInstance()` (serverless.ts) so the two
 * runtimes never construct an Express server differently.
 */
export async function createApp(): Promise<
  import('@nestjs/common').INestApplication
> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // SPEC.md §56 / §229: runtime validation at the boundary. TS types are erased
  // at compile time, so this pipe plus class-validator decorators are what
  // actually reject malformed input — the Pydantic analogue.
  // `whitelist` strips unknown properties; `forbidNonWhitelisted` rejects them
  // outright rather than silently dropping.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  return app;
}
