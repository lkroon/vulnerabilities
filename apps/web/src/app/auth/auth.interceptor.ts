import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Attaches the Cognito access token to every API request when one exists.
 * The API Gateway JWT authorizer reads `$request.header.Authorization` —
 * no token means 401.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).accessToken;
  if (!token) {
    return next(request);
  }
  return next(
    request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};
