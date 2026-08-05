import { inject, Injectable, signal } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';

/**
 * Cognito authentication through the hosted UI (authorization code + PKCE).
 *
 * The API Gateway JWT authorizer rejects unauthenticated requests, so the SPA
 * must hold an access token. The flow: redirect to the hosted UI, come back
 * with a code, exchange it for tokens at the OAuth token endpoint (public
 * client — no secret, PKCE is the proof), store them, and send them with
 * every API call via the interceptor.
 *
 * `state` is a single signal the guard and the app shell share:
 *   loading     — config being fetched / token being checked (first paint)
 *   open        — no config.json: local development, no auth
 *   authenticated — valid tokens present
 *   anonymous   — config present but no valid tokens: guard redirects to login
 */
export type AuthState = 'loading' | 'open' | 'authenticated' | 'anonymous';

const TOKEN_KEY = 'config-scanner.tokens';
const PKCE_STATE_KEY = 'config-scanner.pkce';

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly configService = inject(AppConfigService);

  private readonly state = signal<AuthState>('loading');
  readonly authState = this.state.asReadonly();

  /** Resolves once the initial auth check is done (guard awaits this). */
  ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.configService.load();
    const config = this.configService.value();
    if (!config?.auth.enabled) {
      this.state.set('open');
      return;
    }
    const tokens = this.readTokens();
    if (tokens && tokens.expiresAt > Date.now()) {
      this.state.set('authenticated');
      return;
    }
    if (tokens?.refreshToken) {
      const refreshed = await this.refresh(tokens.refreshToken);
      if (refreshed) {
        this.state.set('authenticated');
        return;
      }
    }
    this.state.set('anonymous');
  }

  get accessToken(): string | null {
    return this.readTokens()?.accessToken ?? null;
  }

  /** Redirect the browser to the Cognito hosted UI. */
  async login(): Promise<void> {
    const config = this.configService.value();
    if (!config?.auth.enabled) {
      return;
    }
    const { verifier, challenge } = await this.createPkce();
    const state = this.randomState();
    sessionStorage.setItem(PKCE_STATE_KEY, JSON.stringify({ state, verifier }));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.auth.clientId,
      redirect_uri: config.auth.redirectUri,
      scope: 'email openid profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    window.location.href = `${config.auth.domain}/oauth2/authorize?${params}`;
  }

  /** Exchange the code from the callback URL for tokens. */
  async completeLogin(code: string, state: string): Promise<void> {
    const config = this.configService.value();
    if (!config?.auth.enabled) {
      return;
    }
    const stored = sessionStorage.getItem(PKCE_STATE_KEY);
    const pkce = stored
      ? (JSON.parse(stored) as { state: string; verifier: string })
      : null;
    if (!pkce || pkce.state !== state) {
      // CSRF check: the state we redirected with must come back.
      this.state.set('anonymous');
      return;
    }
    sessionStorage.removeItem(PKCE_STATE_KEY);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.auth.clientId,
      code,
      redirect_uri: config.auth.redirectUri,
      code_verifier: pkce.verifier,
    });
    const response = await fetch(`${config.auth.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      this.state.set('anonymous');
      return;
    }
    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    this.storeTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    this.state.set('authenticated');
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.state.set('anonymous');
    const config = this.configService.value();
    if (config?.auth.enabled) {
      const params = new URLSearchParams({
        client_id: config.auth.clientId,
        logout_uri: window.location.origin,
      });
      window.location.href = `${config.auth.domain}/logout?${params}`;
    }
  }

  private async refresh(refreshToken: string): Promise<boolean> {
    const config = this.configService.value();
    if (!config?.auth.enabled) {
      return false;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.auth.clientId,
      refresh_token: refreshToken,
    });
    const response = await fetch(`${config.auth.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      return false;
    }
    const tokens = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.storeTokens({
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return true;
  }

  private readTokens(): TokenSet | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as TokenSet) : null;
    } catch {
      return null;
    }
  }

  private storeTokens(tokens: TokenSet): void {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  }

  /**
   * PKCE challenge (RFC 7636): a random verifier, hashed with SHA-256 and
   * base64url-encoded. The hosted UI never sees the verifier; the token
   * endpoint only accepts it if the code and challenge match.
   */
  private async createPkce(): Promise<{ verifier: string; challenge: string }> {
    const verifier = this.randomState(64);
    const hash = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );
    return { verifier, challenge: this.base64Url(new Uint8Array(hash)) };
  }

  private randomState(length = 32): string {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return this.base64Url(bytes);
  }

  private base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
