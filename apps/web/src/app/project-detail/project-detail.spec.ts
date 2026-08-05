import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ListProjectsResponse,
  ListScansResponse,
} from '@config-scanner/shared-types';
import { ProjectDetail } from './project-detail';

const PROJECTS: ListProjectsResponse = {
  projects: [
    {
      orgId: 'acme',
      projectId: 'api-gateway',
      name: 'API Gateway',
      repo: 'acme/api-gateway',
      defaultBranch: 'main',
      latestScanAt: '2026-07-24T09:00:00Z',
      counts: { critical: 1, high: 3, medium: 7, low: 2 },
    },
  ],
};

const SCANS: ListScansResponse = {
  scans: [
    {
      projectId: 'api-gateway',
      scannedAt: '2026-07-24T09:00:00Z',
      status: 'completed',
      manifest: 'package-lock.json',
      commit: 'a3f19c2',
      durationMs: 4210,
      findingCount: 13,
      counts: { critical: 1, high: 3, medium: 7, low: 2 },
    },
  ],
};

describe('ProjectDetail', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectDetail],
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

  it('requests both the org projects and the project scan history', () => {
    const fixture = TestBed.createComponent(ProjectDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.detectChanges();

    httpMock.expectOne('/api/orgs/acme/projects').flush(PROJECTS);
    httpMock.expectOne('/api/projects/api-gateway/scans').flush(SCANS);
  });

  it('renders the project name, the chart, and one scan row', () => {
    const fixture = TestBed.createComponent(ProjectDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(PROJECTS);
    httpMock.expectOne('/api/projects/api-gateway/scans').flush(SCANS);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('API Gateway');
    expect(el.querySelector('cs-drift-chart')).toBeTruthy();
    expect(el.querySelectorAll('.scan-link')).toHaveLength(1);
    expect(el.textContent).toContain('1 critical');
  });

  it('shows "No scans yet" for a registered but never-scanned project', () => {
    const fixture = TestBed.createComponent(ProjectDetail);
    fixture.componentRef.setInput('projectId', 'infra-terraform');
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(PROJECTS);
    httpMock
      .expectOne('/api/projects/infra-terraform/scans')
      .flush({ scans: [] });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No scans yet.');
    expect(el.querySelector('cs-drift-chart')).toBeFalsy();
  });

  it('shows an error state when the scan history request fails', () => {
    const fixture = TestBed.createComponent(ProjectDetail);
    fixture.componentRef.setInput('projectId', 'api-gateway');
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(PROJECTS);
    httpMock
      .expectOne('/api/projects/api-gateway/scans')
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.state--error')?.textContent).toContain(
      'Could not load scan history.',
    );
  });

  it('falls back to the raw projectId in the header when it is not in the org project list', () => {
    const fixture = TestBed.createComponent(ProjectDetail);
    fixture.componentRef.setInput('projectId', 'unknown-project');
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(PROJECTS);
    httpMock
      .expectOne('/api/projects/unknown-project/scans')
      .flush({ scans: [] });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('unknown-project');
    expect(el.querySelector('.repo')).toBeFalsy();
  });
});
