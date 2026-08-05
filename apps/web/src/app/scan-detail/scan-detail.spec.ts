import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ScanDetailResponse } from '@config-scanner/shared-types';
import { ScanDetail } from './scan-detail';

const RESPONSE: ScanDetailResponse = {
  scan: {
    projectId: 'api-gateway',
    scannedAt: '2026-07-24T09:00:00Z',
    status: 'completed',
    manifest: 'package-lock.json',
    commit: 'a3f19c2',
    durationMs: 4210,
    findingCount: 3,
    counts: { critical: 1, high: 1, medium: 1, low: 0 },
    findingsExternal: false,
    findings: [
      {
        kind: 'terraform_misconfig',
        severity: 'critical',
        resource: 'aws_s3_bucket.logs',
        rule: 'S3-001',
        message: 'public read access enabled',
        file: 'modules/logging/main.tf',
        line: 42,
      },
      {
        kind: 'npm_cve',
        severity: 'high',
        package: 'lodash',
        version: '4.17.20',
        cve: 'CVE-2021-23337',
        fixedIn: '4.17.21',
        path: ['api-gateway', 'express-openapi', 'lodash'],
      },
      {
        kind: 'npm_supply_chain',
        severity: 'medium',
        package: 'acme-internal-utils',
        version: '1.4.0',
        rule: 'NPM-SRC-001',
        message: 'Resolved from a local path or git reference',
        resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
      },
    ],
  },
};

describe('ScanDetail', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScanDetail],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests the full scan by project id and timestamp', () => {
    const fixture = TestBed.createComponent(ScanDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.componentRef.setInput('scannedAt', '2026-07-24T09:00:00Z');
    fixture.detectChanges();

    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-24T09%3A00%3A00Z')
      .flush(RESPONSE);
  });

  it('groups findings by severity, critical first, and renders them via cs-finding-item', () => {
    const fixture = TestBed.createComponent(ScanDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.componentRef.setInput('scannedAt', '2026-07-24T09:00:00Z');
    fixture.detectChanges();
    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-24T09%3A00%3A00Z')
      .flush(RESPONSE);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const groups = el.querySelectorAll('.group');
    expect(groups).toHaveLength(3);
    expect(groups[0].querySelector('.pill')?.textContent).toContain('critical');
    expect(groups[0].querySelector('.group__count')?.textContent).toBe('1');
    expect(groups[1].querySelector('.pill')?.textContent).toContain('high');
    expect(groups[2].querySelector('.pill')?.textContent).toContain('medium');

    const items = el.querySelectorAll('cs-finding-item');
    expect(items).toHaveLength(3);
    expect(el.textContent).toContain('CVE-2021-23337');
    expect(el.textContent).toContain('NPM-SRC-001');
  });

  it('shows a clean-scan state when there are no findings', () => {
    const fixture = TestBed.createComponent(ScanDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.componentRef.setInput('scannedAt', '2026-07-24T09:00:00Z');
    fixture.detectChanges();
    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-24T09%3A00%3A00Z')
      .flush({
        scan: {
          ...RESPONSE.scan,
          findingCount: 0,
          counts: { critical: 0, high: 0, medium: 0, low: 0 },
          findings: [],
        },
      });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Clean scan');
    expect(el.querySelector('.group')).toBeFalsy();
  });

  it('shows an error state when the scan request fails', () => {
    const fixture = TestBed.createComponent(ScanDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.componentRef.setInput('scannedAt', '2026-07-24T09:00:00Z');
    fixture.detectChanges();
    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-24T09%3A00%3A00Z')
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.state--error')?.textContent).toContain(
      'Could not load scan.',
    );
  });

  it('re-fetches when the scan route param changes', () => {
    const fixture = TestBed.createComponent(ScanDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.componentRef.setInput('scannedAt', '2026-07-24T09:00:00Z');
    fixture.detectChanges();
    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-24T09%3A00%3A00Z')
      .flush(RESPONSE);
    fixture.detectChanges();

    fixture.componentRef.setInput('scannedAt', '2026-07-25T09:00:00Z');
    fixture.detectChanges();
    httpMock
      .expectOne('/api/scans/api-gateway/2026-07-25T09%3A00%3A00Z')
      .flush(RESPONSE);
    fixture.detectChanges();
  });
});
