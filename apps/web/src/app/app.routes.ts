import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    // Lazy-loaded standalone component - no NgModule, no eager bundle cost.
    loadComponent: () => import('./projects/projects').then((m) => m.Projects),
  },
  {
    path: 'projects/:projectId',
    loadComponent: () =>
      import('./project-detail/project-detail').then((m) => m.ProjectDetail),
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
];
