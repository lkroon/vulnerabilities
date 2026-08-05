import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  CreateScanResponse,
  LatestScanResponse,
  ListScansResponse,
  ScanDetailResponse,
} from '@config-scanner/shared-types';
import { CreateScanDto } from './dto/create-scan.dto';
import { MAX_MANIFEST_BYTES, type UploadedManifest } from './manifest';
import { ScansService } from './scans.service';

/** The multipart field the manifest arrives in. */
const MANIFEST_FIELD = 'manifest';

@Controller()
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  /** `GET /api/projects/:id/scans` (SPEC.md §222). */
  @Get('projects/:projectId/scans')
  listScans(@Param('projectId') projectId: string): Promise<ListScansResponse> {
    return this.scans.listByProject(projectId);
  }

  /**
   * `GET /api/projects/:id/scans/latest` (SPEC.md §223).
   *
   * Declared before the parameterised scan routes would matter if they shared a
   * shape; they do not — the full-scan read is `/api/scans/:projectId/:timestamp`,
   * a different path, chosen so `latest` can never be mistaken for a timestamp.
   */
  @Get('projects/:projectId/scans/latest')
  latestScan(
    @Param('projectId') projectId: string,
  ): Promise<LatestScanResponse> {
    return this.scans.latest(projectId);
  }

  /** `GET /api/scans/:projectId/:timestamp` (SPEC.md §224). */
  @Get('scans/:projectId/:scannedAt')
  scanDetail(
    @Param('projectId') projectId: string,
    @Param('scannedAt') scannedAt: string,
  ): Promise<ScanDetailResponse> {
    return this.scans.getDetail(projectId, scannedAt);
  }

  /**
   * `POST /api/projects/:id/scans` (SPEC.md §225) — upload a manifest, get a scan.
   *
   * Upload limits are enforced by multer *while streaming*, not after: `limits`
   * aborts the request once the size is exceeded, so an oversized upload is
   * never fully buffered. `files: 1` stops a client from sending a thousand
   * small parts to get around the per-file cap.
   *
   * The file itself is held in memory rather than written to disk — Lambda's
   * `/tmp` is per-container state that survives between invocations, and the
   * buffer is parsed immediately and discarded.
   */
  @Post('projects/:projectId/scans')
  @UseInterceptors(
    FileInterceptor(MANIFEST_FIELD, {
      limits: { fileSize: MAX_MANIFEST_BYTES, files: 1 },
    }),
  )
  createScan(
    @Param('projectId') projectId: string,
    @Body() body: CreateScanDto,
    @UploadedFile() file?: UploadedManifest,
  ): Promise<CreateScanResponse> {
    if (!file) {
      throw new BadRequestException(
        `Expected a manifest file in the "${MANIFEST_FIELD}" field`,
      );
    }

    if (file.size === 0) {
      throw new BadRequestException('Manifest file is empty');
    }

    return this.scans.create(projectId, body, file);
  }
}
