import { test, expect } from '@playwright/test';

/**
 * The M1 acceptance criterion (SPEC.md §236).
 *
 * Deliberately asserts on *rendered data that originated in Nest*, not on the
 * servers merely starting. An earlier version of this project passed a
 * "both servers respond" check while the dev proxy was misconfigured and
 * `/api` silently returned the Angular index.html with HTTP 200 — see
 * docs/agent-corrections.md. This test is the one that would have caught it.
 */
test('renders projects fetched from the API through the shared contract', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('h1')).toHaveText('Projects');

  // Data that only exists in the Nest fixture - if the proxy breaks or the
  // contract drifts, this fails.
  await expect(page.getByText('API Gateway')).toBeVisible();
  await expect(page.getByText('acme/api-gateway')).toBeVisible();

  await expect(page.locator('.project')).toHaveCount(3);
  await expect(page.locator('.pill--critical').first()).toContainText(
    '1 critical',
  );
});

test('distinguishes a never-scanned project from a clean one', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('never scanned')).toBeVisible();
  await expect(page.locator('.pill--clean')).toBeVisible();
});

test('does not render the API error state when the backend is up', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('.project').first()).toBeVisible();
  await expect(page.locator('.state--error')).toHaveCount(0);
});
