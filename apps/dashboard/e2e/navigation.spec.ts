import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('dashboard page loads with portfolio data', async ({ page }) => {
    await page.goto('/');
    // AppShell has a sidebar and main area
    await expect(page.locator('main')).toBeVisible();
    // Dashboard shows key metrics (equity, P&L, etc.)
    await expect(page.getByText(/equity|portfolio|p&l/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('navigates to Trades page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /trades/i }).click();
    await expect(page).toHaveURL('/trades');
    await expect(page.getByText(/trade/i).first()).toBeVisible();
  });

  test('navigates to Agents page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /agents/i }).click();
    await expect(page).toHaveURL('/agents');
    await expect(page.getByText(/agent|orchestrator/i).first()).toBeVisible();
  });

  test('navigates to Risk page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /risk/i }).click();
    await expect(page).toHaveURL('/risk');
    await expect(page.getByText(/risk|var|drawdown/i).first()).toBeVisible();
  });

  test('navigates to Strategies page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /strateg/i }).click();
    await expect(page).toHaveURL('/strategies');
  });

  test('navigates to Charts page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /chart/i }).click();
    await expect(page).toHaveURL('/charts');
  });

  test('navigates to Markets page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /market/i }).click();
    await expect(page).toHaveURL('/markets');
  });

  test('navigates to Settings page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /setting/i }).click();
    await expect(page).toHaveURL('/settings');
  });
});
