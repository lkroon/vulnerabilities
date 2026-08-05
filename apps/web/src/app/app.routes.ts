import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth/auth-callback.component').then(
        (m) => m.AuthCallbackComponent,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        // Lazy-loaded standalone component - no NgModule, no eager bundle cost.
        loadComponent: () =>
          import('./projects/projects').then((m) => m.Projects),
      },
      {
        path: 'projects/:projectId',
        loadComponent: () =>
          import('./project-detail/project-detail').then(
            (m) => m.ProjectDetail,
          ),
      },
      {
        path: 'projects/:projectId/scans/:scannedAt',
        loadComponent: () =>
          import('./scan-detail/scan-detail').then((m) => m.ScanDetail),
      },
      {
        path: 'packages',
        loadComponent: () =>
          import('./packages/packages').then((m) => m.Packages),
      },
    ],
  },
];
