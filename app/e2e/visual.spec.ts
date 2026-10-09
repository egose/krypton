import { expect, test } from '@playwright/test';
import { assertIconsInline, mockApi, shot } from './helpers';

test('login page renders with inline icons', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: false, authDisabled: false });
  await page.goto('/login', { waitUntil: 'networkidle' });
  await assertIconsInline(page, 'login logged-out');
  await shot(page, testInfo, 'login-loggedout');
});

test('login shows SSO failure banner on ?auth=error', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: false, authDisabled: false });
  await page.goto('/login?auth=error', { waitUntil: 'networkidle' });
  await expect(page.getByText('SSO sign-in failed')).toBeVisible();
  await shot(page, testInfo, 'login-auth-error');
});

test('dashboard renders secrets table', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  await page.goto('/?ns=demo', { waitUntil: 'networkidle' });
  await expect(page.getByText('Secrets in demo')).toBeVisible();
  await assertIconsInline(page, 'dashboard');
  await shot(page, testInfo, 'dashboard');
});

test('dashboard shows empty state for empty namespace', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  await page.goto('/?ns=payments', { waitUntil: 'networkidle' });
  await expect(page.getByText('No secrets found')).toBeVisible();
  await assertIconsInline(page, 'empty state');
  await shot(page, testInfo, 'dashboard-empty');
});

test('secret detail renders actions, values and history', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  await page.goto('/secrets/demo/app-config', { waitUntil: 'networkidle' });
  await expect(page.getByText('Version history')).toBeVisible();
  await assertIconsInline(page, 'secret detail');
  await shot(page, testInfo, 'detail');

  // Reveal a value and open the restore dialog to cover those layouts too.
  await page.getByRole('button', { name: 'Reveal value' }).first().click();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Restore v\d/ })).toBeVisible();
  await shot(page, testInfo, 'detail-restore-dialog', false);
});

test('denied creation is explained upfront, not on submit', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  // Dashboard: button disabled with an inline hint.
  await page.goto('/?ns=payments', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'New secret' })).toBeDisabled();
  await expect(page.getByText(/Namespace rules don.t allow you to create secrets/)).toBeVisible();
  await assertIconsInline(page, 'dashboard denied-create');
  await shot(page, testInfo, 'dashboard-denied-create');

  // Direct navigation to /new: explanatory alert instead of the form.
  await page.goto('/secrets/payments/new', { waitUntil: 'networkidle' });
  await expect(page.getByText(/not allowed to create secrets in/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create secret' })).toHaveCount(0);
  await assertIconsInline(page, 'new denied-create');
  await shot(page, testInfo, 'new-denied-create');
});

test('new secret form renders', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  await page.goto('/secrets/demo/new', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Create secret' })).toBeVisible();
  await assertIconsInline(page, 'new secret');
  await shot(page, testInfo, 'new');
});

test('edit secret form renders', async ({ page }, testInfo) => {
  await mockApi(page, { loggedIn: true });
  await page.goto('/secrets/demo/app-config/edit', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await assertIconsInline(page, 'edit secret');
  await shot(page, testInfo, 'edit');
});
