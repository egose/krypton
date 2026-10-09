import { expect, type Page, type TestInfo } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixture data (shapes must match lib/api-client.ts + lib/secrets.ts)
// ---------------------------------------------------------------------------

const devUser = { sub: 'dev', email: 'dev@krypton.local', name: 'Local Developer', groups: ['krypton-admin'] };

const publicConfig = (over: Record<string, unknown> = {}) => ({
  scope: 'namespace',
  etcdEncrypted: false,
  authDisabled: true,
  oidcConfigured: false,
  historyLimit: 20,
  appNamespace: 'krypton',
  ...over,
});

interface SummaryOverrides {
  name?: string;
  type?: string;
  keys?: string[];
  keyCount?: number;
  description?: string;
  version?: number;
  allowedGroups?: string[];
  managedByKrypton?: boolean;
}

const summary = (over: SummaryOverrides = {}) => ({
  namespace: 'demo',
  name: 'app-config',
  type: 'Opaque',
  keys: ['DB_HOST', 'DB_PASSWORD', 'API_KEY'],
  keyCount: 3,
  description: 'Demo app configuration',
  version: 2,
  resourceVersion: '12345',
  creationTimestamp: '2026-09-01T10:00:00Z',
  allowedGroups: ['dev-team'],
  allowedUsers: [],
  managedByKrypton: true,
  ...over,
});

const detail = {
  ...summary(),
  data: { DB_HOST: 'db.internal', DB_PASSWORD: 's3cret-value', API_KEY: 'abc-123-def-456' }, // pragma: allowlist secret
};

const versions = [
  {
    version: 2,
    snapshotName: 'app-config-v2',
    snapshotAt: '2026-10-01T12:00:00Z',
    snapshotBy: 'alice@company.com',
    keys: ['DB_HOST', 'DB_PASSWORD', 'API_KEY'],
    data: { DB_HOST: 'db.internal', DB_PASSWORD: 'older-secret', API_KEY: 'abc-123-def-456' }, // pragma: allowlist secret
  },
  {
    version: 1,
    snapshotName: 'app-config-v1',
    snapshotAt: '2026-09-15T09:30:00Z',
    snapshotBy: 'bob@company.com',
    keys: ['DB_HOST', 'DB_PASSWORD'],
    data: { DB_HOST: 'db.internal', DB_PASSWORD: 'first-secret' }, // pragma: allowlist secret
  },
];

// ---------------------------------------------------------------------------
// API mocks — every /api/* response is faked so no cluster or IdP is needed
// ---------------------------------------------------------------------------

export async function mockApi(
  page: Page,
  {
    loggedIn,
    etcdEncrypted = false,
    authDisabled = true,
  }: { loggedIn: boolean; etcdEncrypted?: boolean; authDisabled?: boolean },
) {
  await page.route('**/api/config', (r) => r.fulfill({ json: publicConfig({ etcdEncrypted, authDisabled }) }));
  await page.route('**/api/auth/me', (r) =>
    loggedIn
      ? r.fulfill({ json: { user: devUser } })
      : r.fulfill({ status: 401, json: { error: 'Authentication required' } }),
  );
  await page.route('**/api/namespaces', (r) =>
    r.fulfill({ json: { scope: 'namespace', namespaces: ['demo', 'payments'] } }),
  );
  await page.route('**/api/namespaces/demo/secrets', (r) =>
    r.fulfill({
      json: {
        namespace: 'demo',
        canCreate: true,
        secrets: [
          summary(),
          summary({
            name: 'tls-cert',
            type: 'kubernetes.io/tls',
            keys: ['tls.crt', 'tls.key'],
            keyCount: 2,
            description: '',
            version: 0,
            allowedGroups: [],
            managedByKrypton: false,
          }),
        ],
      },
    }),
  );
  await page.route('**/api/namespaces/payments/secrets', (r) =>
    // payments excludes the user: covers the denied-create UX.
    r.fulfill({ json: { namespace: 'payments', canCreate: false, secrets: [] } }),
  );
  await page.route('**/api/namespaces/demo/secrets/app-config/versions', (r) =>
    r.fulfill({ json: { namespace: 'demo', name: 'app-config', versions } }),
  );
  await page.route('**/api/namespaces/demo/secrets/app-config', (r) => r.fulfill({ json: { secret: detail } }));
}

// ---------------------------------------------------------------------------
// Icon geometry: every svg inside a button/link must sit on the same row as
// the label — (a) fully inside the control, (b) clearly on one side (a left
// icon or right chevron are both fine; a horizontally-centered icon means the
// stacked icon-above-text bug), (c) vertically centered within 6px.
// ---------------------------------------------------------------------------

export async function assertIconsInline(page: Page, label: string) {
  const controls = page.locator('button:has(svg):visible, a:has(svg):visible');
  const n = await controls.count();
  expect(n, `${label}: expected to find icon controls`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const el = controls.nth(i);
    // Skip dev-only overlays (Next.js dev indicator in a portal) — not app UI.
    // Production `next start` has none, but reuseExistingServer may hit a dev server.
    const inDevOverlay = await el.evaluate((e) => {
      let node: Element | null = e;
      while (node) {
        if (node.tagName === 'NEXTJS-PORTAL') return true;
        if (node !== e && getComputedStyle(node).position === 'fixed') return true;
        node = node.parentElement;
      }
      return false;
    });
    if (inDevOverlay) continue;
    const box = await el.boundingBox();
    const sbox = await el.locator('svg').first().boundingBox();
    if (!box || !sbox) continue;
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const text = ((await el.evaluate((e) => (e.textContent ?? '').trim().slice(0, 28))) ?? '') as string;
    const id = `${label} :: <${tag}> "${text}"`;
    const rects = JSON.stringify({ sbox, box });

    expect(
      sbox.x >= box.x - 1 && sbox.x + sbox.width <= box.x + box.width + 1,
      `${id} icon inside control ${rects}`,
    ).toBe(true);
    // Empty-text controls are icon-only buttons (reveal/copy/delete/eye) — centered is correct there.
    if (text !== '') {
      const dx = Math.abs(sbox.x + sbox.width / 2 - (box.x + box.width / 2));
      expect(dx, `${id} icon on one side (dx=${dx.toFixed(1)}px, centered = stacked bug) ${rects}`).toBeGreaterThan(10);
    }
    const dy = Math.abs(sbox.y + sbox.height / 2 - (box.y + box.height / 2));
    expect(dy, `${id} icon vertically centered (dy=${dy.toFixed(1)}px) ${rects}`).toBeLessThanOrEqual(6);
  }
}

/** Attach a screenshot to the HTML report (nothing is committed to git). */
export async function shot(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage }), contentType: 'image/png' });
}
