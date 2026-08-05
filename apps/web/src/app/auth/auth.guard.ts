import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Route guard: every screen requires a valid session when the app is
 * deployed (config.json present). Locally — no config.json — the guard passes
 * straight through so `npm run dev` and the e2e suites need no Cognito.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ready;

  const state = auth.authState();
  if (state === 'open' || state === 'authenticated') {
    return true;
  }
  if (state === 'anonymous') {
    void auth.login();
    return false;
  }
  return inject(Router).createUrlTree(['/auth/callback']);
};
