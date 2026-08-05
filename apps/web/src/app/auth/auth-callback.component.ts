import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Landing page of the Cognito hosted-UI callback (`/auth/callback?code=...`).
 *
 * Exchanges the code for tokens and bounces to the app root. The status line
 * keeps the user oriented if the exchange fails — a hard redirect with no
 * message would look exactly like the app not working.
 */
@Component({
  selector: 'cs-auth-callback',
  standalone: true,
  template: `<p>{{ status() }}</p>`,
  styles: [
    `
      p {
        font-family: var(--font-sans, sans-serif);
        padding: 2rem;
        text-align: center;
      }
    `,
  ],
})
export class AuthCallbackComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly status = signal('Completing sign-in…');

  constructor() {
    void this.handle();
  }

  private async handle(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      this.status.set('Sign-in failed: the callback was missing parameters.');
      return;
    }
    await this.auth.completeLogin(code, state);
    if (this.auth.authState() === 'authenticated') {
      await this.router.navigate(['/']);
    } else {
      this.status.set('Sign-in failed. Try again from the app.');
    }
  }
}
