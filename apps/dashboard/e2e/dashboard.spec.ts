import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays portfolio summary cards', async ({ page }) => {
    // Should show equity/P&L related content
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Check for key metric sections (the dashboard renders stat cards)
    // These are visible whether using real DB or fallback data
    await expect(page.locator('main').getByText(/\$/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('displays equity curve chart', async ({ page }) => {
    // Recharts renders SVG elements
    await expect(page.locator('main svg').first()).toBeVisible({ timeout: 10000 });
  });

  test('displays positions table', async ({ page }) => {
    // Open positions section should be visible
    const positionsSection = page.getByText(/position/i).first();
    await expect(positionsSection).toBeVisible({ timeout: 10000 });
  });

  test('displays recent trades', async ({ page }) => {
    const tradesSection = page.getByText(/trade/i).first();
    await expect(tradesSection).toBeVisible({ timeout: 10000 });
  });
});
