import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  countBySeverity,
  type CreateScanRequest,
  type CreateScanResponse,
  type Finding,
  type LatestScanResponse,
  type ListScansResponse,
  type ScanDetail,
  type ScanDetailResponse,
} from '@config-scanner/shared-types';
import {
  ManifestParseError,
  scanManifest,
} from '@config-scanner/scanner-rules';
import type { ScanItem } from '../dynamo/items';
import { toScanSummary } from '../dynamo/items';
import { scanKey } from '../dynamo/keys';
import {
  FINDINGS_STORE,
  exceedsInlineLimit,
  findingsKey,
  type FindingsStore,
} from '../findings/findings-store';
import { ProjectsService } from '../projects/projects.service';
import { manifestTypeFor, type UploadedManifest } from './manifest';
import { packageIndexRows } from './package-index';
import { ScansRepository } from './scans.repository';

/** How many times to nudge the timestamp when two scans collide on the same key. */
const TIMESTAMP_COLLISION_RETRIES = 5;

@Injectable()
export class ScansService {
  constructor(
    private readonly scans: ScansRepository,
    private readonly projects: ProjectsService,
    @Inject(FINDINGS_STORE) private readonly findingsStore: FindingsStore,
  ) {}

  /** `GET /api/projects/:id/scans` — history, newest first, summaries only. */
  async listByProject(projectId: string): Promise<ListScansResponse> {
    await this.projects.requireById(projectId);
    const items = await this.scans.listByProject(projectId);

    return { scans: items.map(toScanSummary) };
  }

  /** `GET /api/projects/:id/scans/latest` — the dashboard landing query. */
  async latest(projectId: string): Promise<LatestScanResponse> {
    await this.projects.requireById(projectId);
    const item = await this.scans.latest(projectId);

    // A project that exists but has never been scanned is a 200 with `null`,
    // not a 404: the project *is* the resource being addressed, and the
    // frontend renders "never scanned" rather than an error (SPEC.md §205).
    return { scan: item ? toScanSummary(item) : null };
  }

  /** `GET /api/scans/:projectId/:timestamp` — one scan with its findings. */
  async getDetail(
    projectId: string,
    scannedAt: string,
  ): Promise<ScanDetailResponse> {
    const item = await this.scans.get(projectId, scannedAt);

    if (!item) {
      throw new NotFoundException(
        `No scan at ${scannedAt} for project "${projectId}"`,
      );
    }

    return { scan: await this.hydrate(item) };
  }

  /**
   * `POST /api/projects/:id/scans` — upload a manifest, run the rules, store an
   * immutable snapshot.
   *
   * The write path in order: resolve the project, parse and scan (pure, in
   * `libs/scanner-rules`), decide whether the findings fit in the item, write the
   * scan, index the vulnerable packages, then roll the counts up onto the
   * project. Nothing here mutates an existing scan.
   */
  async create(
    projectId: string,
    request: CreateScanRequest,
    file: UploadedManifest,
  ): Promise<CreateScanResponse> {
    const project = await this.projects.requireById(projectId);
    const manifest = manifestTypeFor(file.originalname);

    const startedAt = Date.now();
    let findings: Finding[];
    try {
      ({ findings } = scanManifest(manifest, file.buffer.toString('utf8')));
    } catch (error) {
      if (error instanceof ManifestParseError) {
        // A manifest the scanner cannot read is the uploader's mistake, so it is
        // a 400 with the parser's own message — not a 500, and not a stored
        // `status: 'failed'` scan, which would put an empty findings list into
        // the drift chart as though the project were clean.
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const durationMs = Date.now() - startedAt;

    const item = await this.writeScan({
      projectId,
      orgId: project.orgId,
      manifest,
      commit: request.commit ?? null,
      durationMs,
      findings,
    });

    return { scan: await this.hydrate(item, findings) };
  }

  /**
   * Persist one scan: the snapshot, the package index rows, the project rollup.
   *
   * Not a transaction. `TransactWriteItems` caps at 100 items and costs double,
   * and the three writes do not need to be atomic: the scan is the record of
   * truth, the index rows are a derived lookup that the next scan re-upserts,
   * and the rollup is a projection guarded by "only if newer". A crash between
   * them leaves stale derived data, not a wrong scan.
   */
  private async writeScan(input: {
    projectId: string;
    orgId: string;
    manifest: ScanItem['manifest'];
    commit: string | null;
    durationMs: number;
    findings: Finding[];
    scannedAt?: string;
  }): Promise<ScanItem> {
    const { projectId, orgId, findings } = input;
    const counts = countBySeverity(findings);

    let scannedAt = input.scannedAt ?? new Date().toISOString();

    for (let attempt = 0; ; attempt++) {
      const spilled = exceedsInlineLimit(findings);
      const ref = findingsKey(projectId, scannedAt);

      if (spilled) {
        // Written before the item, so the item never points at bytes that are
        // not there. The reverse order leaves a scan whose findings 404.
        await this.findingsStore.put(ref, findings);
      }

      const item: ScanItem = {
        ...scanKey(projectId, scannedAt),
        type: 'scan',
        projectId,
        scannedAt,
        status: 'completed',
        manifest: input.manifest,
        commit: input.commit,
        durationMs: input.durationMs,
        counts,
        findingCount: findings.length,
        ...(spilled ? { findingsRef: ref } : { findings }),
      };

      try {
        await this.scans.put(item);
        await this.scans.upsertPackageIndex(
          packageIndexRows(orgId, projectId, findings, new Date(scannedAt)),
        );
        await this.projects.rollUpScan(orgId, projectId, scannedAt, counts);
        return item;
      } catch (error) {
        // Two uploads inside the same millisecond collide on `SCAN#<timestamp>`.
        // Nudging by a millisecond keeps the sort key ordering meaningful and
        // costs one retry, where a random suffix would make the key no longer
        // parse as a timestamp.
        if (
          error instanceof ConflictException &&
          attempt < TIMESTAMP_COLLISION_RETRIES
        ) {
          scannedAt = new Date(new Date(scannedAt).getTime() + 1).toISOString();
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Turn a stored item into the API's `ScanDetail`, resolving a spilled payload.
   *
   * Where the findings live is a storage decision; the client always receives
   * them. `findingsExternal` is reported so the escape hatch is observable
   * (SPEC.md §194) rather than invisible.
   */
  private async hydrate(
    item: ScanItem,
    known?: Finding[],
  ): Promise<ScanDetail> {
    const ref = item.findingsRef;
    let findings = known;

    if (!findings) {
      findings = ref
        ? await this.findingsStore.get(ref)
        : (item.findings ?? []);
    }

    return {
      ...toScanSummary(item),
      findings,
      findingsExternal: ref !== undefined,
    };
  }
}
