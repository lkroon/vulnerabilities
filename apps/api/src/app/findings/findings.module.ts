import { Module } from '@nestjs/common';
import { FINDINGS_STORE } from './findings-store';
import { LocalFindingsStore } from './local-findings-store';

/**
 * Binds the findings store token to an implementation.
 *
 * One line changes in M4 — `useClass: S3FindingsStore` — and nothing that
 * consumes findings has to know. That is the whole reason the token exists.
 */
@Module({
  providers: [{ provide: FINDINGS_STORE, useClass: LocalFindingsStore }],
  exports: [FINDINGS_STORE],
})
export class FindingsModule {}
