import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ListProjectsResponse } from '@config-scanner/shared-types';
import { Projects } from './projects';

/**
 * The fixture is typed as the shared contract. If `ListProjectsResponse`
 * changes, this file stops compiling — which is the intended coupling.
 */
const RESPONSE: ListProjectsResponse = {
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
    {
      orgId: 'acme',
      projectId: 'infra-terraform',
      name: 'Infrastructure',
      repo: 'acme/infra-terraform',
      defaultBranch: 'main',
      latestScanAt: null,
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
    },
  ],
};

describe('Projects', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Projects],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests the org projects endpoint', () => {
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/orgs/acme/projects');
    expect(req.request.method).toBe('GET');
    req.flush(RESPONSE);
  });

  it('renders one row per project with its severity pills', () => {
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(RESPONSE);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.project')).toHaveLength(2);
    expect(el.textContent).toContain('API Gateway');
    expect(el.textContent).toContain('1 critical');
  });

  it('marks a project with no findings as clean', () => {
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    httpMock.expectOne('/api/orgs/acme/projects').flush(RESPONSE);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pill--clean')?.textContent).toContain('clean');
    expect(el.textContent).toContain('never scanned');
  });

  it('shows an error state when the API is unreachable', () => {
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    httpMock
      .expectOne('/api/orgs/acme/projects')
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.state--error'),
    ).toBeTruthy();
  });
});
