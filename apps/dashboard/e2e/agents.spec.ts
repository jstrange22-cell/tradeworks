import { test, expect } from '@playwright/test';

test.describe('Agents Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/agents');
  });

  test('displays agent status cards', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
    // Should show agent names
    await expect(page.getByText(/quant|sentiment|macro|risk|execution/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows orchestrator status', async ({ page }) => {
    await expect(page.getByText(/orchestrator|cycle/i).first()).toBeVisible({ timeout: 10000 });
  });
});
