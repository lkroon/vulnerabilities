import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Finding } from '@config-scanner/shared-types';
import { FindingItem } from './finding-item';

describe('FindingItem', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FindingItem],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  function render(finding: Finding): HTMLElement {
    const fixture = TestBed.createComponent(FindingItem);
    fixture.componentRef.setInput('finding', finding);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders an npm_cve finding with its CVE id and fix version', () => {
    const el = render({
      kind: 'npm_cve',
      severity: 'high',
      package: 'lodash',
      version: '4.17.20',
      cve: 'CVE-2021-23337',
      fixedIn: '4.17.21',
      path: ['api-gateway', 'lodash'],
    });

    expect(el.textContent).toContain('lodash');
    expect(el.textContent).toContain('CVE-2021-23337');
    expect(el.textContent).toContain('Fixed in 4.17.21');
    expect(el.textContent).toContain('api-gateway → lodash');
  });

  it('renders "No fix published" for an npm_cve finding with no fix available', () => {
    const el = render({
      kind: 'npm_cve',
      severity: 'critical',
      package: 'left-pad',
      version: '1.0.0',
      cve: 'CVE-2016-00000',
      fixedIn: null,
      path: ['api-gateway', 'left-pad'],
    });

    expect(el.textContent).toContain('No fix published.');
  });

  it('renders an npm_supply_chain finding with its resolved source', () => {
    const el = render({
      kind: 'npm_supply_chain',
      severity: 'medium',
      package: 'acme-internal-utils',
      version: '1.4.0',
      rule: 'NPM-SRC-001',
      message: 'Resolved from a local path or git reference',
      resolved: 'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
    });

    expect(el.textContent).toContain('NPM-SRC-001');
    expect(el.textContent).toContain(
      'git+ssh://git@github.com/acme/internal-utils.git#a3f19c2',
    );
  });

  it('renders a terraform_misconfig finding with its file and line', () => {
    const el = render({
      kind: 'terraform_misconfig',
      severity: 'critical',
      resource: 'aws_s3_bucket.logs',
      rule: 'S3-001',
      message: 'public read access enabled',
      file: 'modules/logging/main.tf',
      line: 42,
    });

    expect(el.textContent).toContain('aws_s3_bucket.logs');
    expect(el.textContent).toContain('modules/logging/main.tf:42');
  });

  it('renders a dockerfile finding with its rule and line', () => {
    const el = render({
      kind: 'dockerfile',
      severity: 'low',
      rule: 'DL3007',
      message: 'using latest is prone to errors',
      file: 'Dockerfile',
      line: 1,
    });

    expect(el.textContent).toContain('DL3007');
    expect(el.textContent).toContain('Dockerfile:1');
  });
});
