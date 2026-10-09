import { expect, test } from '@playwright/test';
import { assertIconsInline, mockApi, shot } from './helpers';

test('mobile login fits without overflow', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: false, authDisabled: false });
  await page.goto('/login', { waitUntil: 'networkidle' });
  const cta = page.locator('main a[href="/api/auth/login"]');
  const overflow = await cta.evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(overflow, `login CTA horizontal overflow (${overflow}px)`).toBeLessThanOrEqual(2);
  await assertIconsInline(page, 'mobile login');
  await shot(page, testInfo, 'mobile-login');
});
