import { config } from './config';
import { getCoreApi, getPodNamespace, requestOptions } from './k8s';
import type { SessionUser } from './auth';

/**
 * Namespaces visible to the app:
 * - `namespace` scope: only the pod's own namespace (Role + RoleBinding).
 * - `cluster` scope: all namespaces (ClusterRole), optionally filtered by
 *   KRYPTON_NAMESPACES allowlist.
 */
export async function listAllowedNamespaces(user: SessionUser): Promise<string[]> {
  if (config.scope === 'namespace') return [getPodNamespace()];

  try {
    const core = getCoreApi();
    const res = await core.listNamespace({}, requestOptions(user));
    const all = (res.items ?? [])
      .map((ns) => ns.metadata?.name)
      .filter((n): n is string => Boolean(n))
      .sort();
    if (config.allowedNamespaces.length === 0) return all;
    const allow = new Set(config.allowedNamespaces);
    return all.filter((n) => allow.has(n));
  } catch {
    // Fallback: SA may lack namespace-list permission; use allowlist or own ns.
    if (config.allowedNamespaces.length > 0) return [...config.allowedNamespaces].sort();
    return [getPodNamespace()];
  }
}

export async function assertNamespaceAllowed(namespace: string, user: SessionUser): Promise<void> {
  const allowed = await listAllowedNamespaces(user);
  if (!allowed.includes(namespace)) {
    const err = new Error(
      `Namespace "${namespace}" is not accessible (scope=${config.scope}). ` +
        `Allowed: ${allowed.join(', ') || '(none)'}`,
    );
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
