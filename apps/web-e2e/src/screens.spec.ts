import { test, expect } from '@playwright/test';

/**
 * M3 navigation + rendering against the real stack (SPEC.md §236 screens 3–4).
 *
 * Follows the projects.spec.ts convention of asserting on rendered data that
 * originated in Nest — this test only passes if the router, the proxy and the
 * seed data all line up.
 */
test('project card navigates to scan detail with real findings', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('a.project').first().click();
  await expect(page).toHaveURL(/\/projects\/api-gateway$/);

  await page.locator('a.scan-link').first().click();
  await expect(page).toHaveURL(/\/projects\/api-gateway\/scans\//);

  // Seed fixture data (apps/api/src/scripts/seed-data.ts) rendered through the
  // FindingItem discriminated-union template.
  await expect(page.getByText('CVE-2021-23337')).toBeVisible();
  await expect(page.getByText('aws_s3_bucket.logs').first()).toBeVisible();
});

test('package usage form resolves blast radius from the real index', async ({
  page,
}) => {
  await page.goto('/packages');

  await page.getByPlaceholder('lodash').fill('lodash');
  await page.getByPlaceholder('4.17.20').fill('4.17.20');
  await page.getByRole('button', { name: 'Look up' }).click();

  await expect(page.getByText('lodash@4.17.20')).toBeVisible();
  await expect(page.getByText('api-gateway')).toBeVisible();
  await expect(page.getByText('billing-worker')).toBeVisible();
});
