import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    // Lazy-loaded standalone component - no NgModule, no eager bundle cost.
    loadComponent: () => import('./projects/projects').then((m) => m.Projects),
  },
];
