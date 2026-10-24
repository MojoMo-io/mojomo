import { test, expect } from '@playwright/test';

// Public pages that must render without auth.
test.describe('public pages', () => {
  test('home page renders with title and no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/MOJOMO/i);
    expect(errors).toEqual([]);
  });

  test('login page renders the email form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#go')).toBeVisible();
  });

  test('login rejects an invalid email client-side', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'not-an-email');
    await page.click('#go');
    await expect(page.locator('#msg')).toContainText(/valid email/i);
  });

  test('login shows the sent state for a valid email', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `e2e-${Date.now()}@example.com`);
    await page.click('#go');
    await expect(page.locator('#sent')).toBeVisible();
    await expect(page.locator('#form')).toBeHidden();
  });

  test('llms.txt is served', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
  });

  test('health endpoint is ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
  });
});
