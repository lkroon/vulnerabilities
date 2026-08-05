import { IsOptional, IsString, Matches } from 'class-validator';
import type { CreateScanRequest } from '@config-scanner/shared-types';

/**
 * Non-file fields of the scan upload (SPEC.md §225).
 *
 * Multipart form fields arrive as strings, so `commit` is validated by shape
 * rather than by type: a git SHA is 7–40 hex characters, and anything else is a
 * client mistake worth a 400 rather than something to store and display.
 */
export class CreateScanDto implements CreateScanRequest {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{7,40}$/, {
    message: 'commit must be a 7–40 character hexadecimal git SHA',
  })
  commit?: string;
}
