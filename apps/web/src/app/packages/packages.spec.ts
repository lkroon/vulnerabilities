import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Packages } from './packages';

function fillAndSubmit(
  fixture: { nativeElement: HTMLElement },
  name: string,
  version: string,
): void {
  const el = fixture.nativeElement as HTMLElement;
  const setValue = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    // Reactive forms mark a control touched on blur, which is when the
    // per-field validation message appears.
    input.dispatchEvent(new Event('blur'));
  };
  setValue('input[formControlName="name"]', name);
  setValue('input[formControlName="version"]', version);
  el.querySelector('form')?.dispatchEvent(new Event('submit'));
}

describe('Packages', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Packages],
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

  it('looks up blast radius on submit and lists the affected projects', () => {
    const fixture = TestBed.createComponent(Packages);
    fixture.detectChanges();
    fillAndSubmit(fixture, 'lodash', '4.17.20');
    fixture.detectChanges();

    httpMock
      .expectOne('/api/packages/lodash/4.17.20/usage')
      .flush({
        package: 'lodash',
        version: '4.17.20',
        projects: [
          { orgId: 'acme', projectId: 'api-gateway', lastSeen: '2026-07-24' },
          { orgId: 'acme', projectId: 'billing-worker', lastSeen: '2026-07-22' },
        ],
      });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('lodash@4.17.20');
    expect(el.querySelectorAll('.project')).toHaveLength(2);
    expect(el.textContent).toContain('api-gateway');
  });

  it('URI-encodes scoped package names before building the path', () => {
    const fixture = TestBed.createComponent(Packages);
    fixture.detectChanges();
    fillAndSubmit(fixture, '@angular/core', '15.2.0');
    fixture.detectChanges();

    httpMock
      .expectOne('/api/packages/%40angular%2Fcore/15.2.0/usage')
      .flush({
        package: '@angular/core',
        version: '15.2.0',
        projects: [],
      });
    fixture.detectChanges();
  });

  it('explains an empty result instead of rendering an empty list', () => {
    const fixture = TestBed.createComponent(Packages);
    fixture.detectChanges();
    fillAndSubmit(fixture, 'lodash', '4.17.20');
    fixture.detectChanges();

    httpMock
      .expectOne('/api/packages/lodash/4.17.20/usage')
      .flush({ package: 'lodash', version: '4.17.20', projects: [] });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No project has a vulnerable copy');
    expect(el.querySelector('.project')).toBeFalsy();
  });

  it('shows an error state when the lookup fails', () => {
    const fixture = TestBed.createComponent(Packages);
    fixture.detectChanges();
    fillAndSubmit(fixture, 'lodash', '4.17.20');
    fixture.detectChanges();

    httpMock
      .expectOne('/api/packages/lodash/4.17.20/usage')
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.state--error')?.textContent).toContain(
      'Could not look up that package.',
    );
  });

  it('refuses "#" in either field without issuing a request', () => {
    const fixture = TestBed.createComponent(Packages);
    fixture.detectChanges();
    fillAndSubmit(fixture, 'lodash#x', '4.17.20');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(
      (el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(el.textContent).toContain('must not contain "#"');
  });
});
