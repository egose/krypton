import type { V1Secret } from '@kubernetes/client-node';
import { ANNOTATIONS, config } from './config';
import { getCoreApi, getPodNamespace } from './k8s';
import type { SessionUser } from './auth';
import { namespaceAccessSchema, type NamespaceAccessMap } from './validation';

/**
 * Hybrid authorization (for SSO users that do NOT exist in the cluster):
 * - authentication: OIDC SSO (see lib/auth.ts)
 * - authorization: per-Secret annotations + one namespace-level ConfigMap
 *
 * Annotations on a Secret:
 *   krypton.io/allowed-groups: "dev-team, database-admins"
 *   krypton.io/allowed-users:  "alice@company.com, bob@company.com"
 *
 * Namespace fallback lives in ConfigMap <app-namespace>/krypton-access,
 * key "access.json": { "<namespace>": { "groups": [...], "users": [...] } }
 *
 * Default when NO rules exist anywhere: allow all authenticated users
 * (open by default, restricted once rules are added). Admins always pass.
 */

export function isAdmin(user: SessionUser): boolean {
  if (config.authDisabled) return true;
  if (config.adminUsers.includes(user.email.toLowerCase())) return true;
  if (user.groups.some((g) => config.adminGroups.includes(g))) return true;
  // bootstrap: no admins configured at all → every authenticated user is admin
  // until the operator sets KRYPTON_ADMIN_GROUPS/USERS. Documented in README.
  if (config.adminGroups.length === 0 && config.adminUsers.length === 0) return true;
  return false;
}

function csvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function userMatches(user: SessionUser, groups: string[], users: string[]): boolean {
  const email = user.email.toLowerCase();
  if (users.some((u) => u.toLowerCase() === email)) return true;
  if (user.groups.some((g) => groups.includes(g))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Namespace-level rules (ConfigMap cache, 60s TTL — still no DB/disk)
// ---------------------------------------------------------------------------

let cache: { at: number; data: NamespaceAccessMap } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getNamespaceAccessMap(): Promise<NamespaceAccessMap> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;
  let data: NamespaceAccessMap = {};
  try {
    const api = getCoreApi();
    const res = await api.readNamespacedConfigMap({
      namespace: getPodNamespace(),
      name: config.accessConfigMap,
    });
    const raw = res.data?.['access.json'];
    if (raw) {
      const parsed = namespaceAccessSchema.safeParse(JSON.parse(raw));
      if (parsed.success) data = parsed.data;
      else console.warn('[krypton] invalid access.json in ConfigMap, ignoring');
    }
  } catch (err: unknown) {
    // Missing ConfigMap = no namespace rules; not fatal.
    const code = (err as { code?: number })?.code;
    if (code !== 404) console.warn('[krypton] failed to read access ConfigMap', err);
  }
  cache = { at: now, data };
  return data;
}

export function secretRules(secret: V1Secret): { groups: string[]; users: string[] } {
  const ann = secret.metadata?.annotations ?? {};
  return {
    groups: csvList(ann[ANNOTATIONS.allowedGroups]),
    users: csvList(ann[ANNOTATIONS.allowedUsers]),
  };
}

/** Can `user` read (and therefore manage) this secret? */
export async function canAccessSecret(user: SessionUser, namespace: string, secret: V1Secret): Promise<boolean> {
  if (isAdmin(user)) return true;
  const rules = secretRules(secret);
  const hasSecretRules = rules.groups.length > 0 || rules.users.length > 0;
  if (hasSecretRules) return userMatches(user, rules.groups, rules.users);

  const nsMap = await getNamespaceAccessMap();
  const nsRules = nsMap[namespace];
  if (nsRules && (nsRules.groups.length > 0 || nsRules.users.length > 0)) {
    return userMatches(user, nsRules.groups, nsRules.users);
  }
  // No rules anywhere → open to all authenticated users.
  return true;
}

/** Can `user` create secrets in `namespace` (namespace rules only)? */
export async function canCreateInNamespace(user: SessionUser, namespace: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const nsMap = await getNamespaceAccessMap();
  const nsRules = nsMap[namespace];
  if (!nsRules || (nsRules.groups.length === 0 && nsRules.users.length === 0)) return true;
  return userMatches(user, nsRules.groups, nsRules.users);
}

/** Filter a secret list down to what `user` may see. */
export async function filterVisibleSecrets(
  user: SessionUser,
  namespace: string,
  secrets: V1Secret[],
): Promise<V1Secret[]> {
  if (isAdmin(user)) return secrets;
  const out: V1Secret[] = [];
  for (const s of secrets) {
    if (await canAccessSecret(user, namespace, s)) out.push(s);
  }
  return out;
}
