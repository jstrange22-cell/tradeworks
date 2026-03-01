import { test, expect } from '@playwright/test';

test.describe('Risk Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/risk');
  });

  test('displays risk metrics', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
    // Risk page shows VaR, drawdown, portfolio heat metrics
    await expect(page.getByText(/risk|portfolio heat|drawdown|var/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows risk limit gauges', async ({ page }) => {
    // Risk limits section with current vs limit values
    await expect(page.getByText(/limit/i).first()).toBeVisible({ timeout: 10000 });
  });
});
