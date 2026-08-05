import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import 'dotenv/config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /*
   * Both servers, not just the web app. The suite asserts on data served by
   * Nest and proxied through the web server, so starting only `web` would test
   * the error state rather than the integration.
   *
   * Deliberately NOT `nx run ...:serve` commands: Playwright spawns the
   * webServer as a child of the e2e task, and a nested nx invocation overlaps
   * the parent's task graph (shared-types:build is built for api-e2e in the
   * same run). Nx's recursion guard then refuses the overlap and every test
   * fails before starting. Plain node processes have no Nx graph — the API
   * runs the built bundle directly, the web app is served by
   * static-server.mjs with an SPA fallback and an /api proxy.
   *
   * `reuseExistingServer` keeps this safe when a developer already has
   * `npm run dev` running: the probe hits the real dev servers first.
   */
  webServer: [
    {
      command: 'node dist/apps/api/main.js',
      url: 'http://localhost:3000/api',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 120_000,
      env: {
        DYNAMODB_TABLE: 'config-scanner',
        DYNAMODB_ENDPOINT: 'http://localhost:8000',
        AWS_REGION: 'eu-west-1',
        PORT: '3000',
      },
    },
    {
      command: 'node apps/web-e2e/src/static-server.mjs',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 120_000,
    },
  ],
  projects: [
    // Chromium only. SPEC.md §61 asks for one happy-path E2E to prove the habit,
    // not a cross-browser matrix — and each extra browser is another download in
    // CI for no additional signal. Add firefox/webkit if a real need appears.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment for mobile browsers support
    /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
