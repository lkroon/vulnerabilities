import { Injectable, signal } from '@angular/core';

/**
 * Runtime configuration, fetched from /config.json at boot.
 *
 * The file is written by the Pulumi program itself (infra/src/web.ts) on every
 * `pulumi up` — the deployed app reads the same endpoints the stack created,
 * so config can never drift from infrastructure. Local development has no
 * config.json (the dev server does not serve one), which is how the app knows
 * it is running without Cognito.
 */
export interface RuntimeConfig {
  apiUrl: string;
  auth: {
    enabled: boolean;
    region: string;
    issuer: string;
    clientId: string;
    /** Hosted-UI base, e.g. https://<domain>.auth.<region>.amazoncognito.com */
    domain: string;
    redirectUri: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly config = signal<RuntimeConfig | null>(null);

  /** The loaded config, or null when running without one (local dev). */
  readonly value = this.config.asReadonly();

  async load(): Promise<void> {
    try {
      const response = await fetch('/config.json', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      this.config.set((await response.json()) as RuntimeConfig);
    } catch {
      // No config.json — local development. Leave config null; the app runs
      // with auth disabled.
    }
  }
}
