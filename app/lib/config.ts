/**
 * Krypton — centralized configuration from environment.
 *
 * No database: all state lives in Kubernetes Secret objects (and one
 * optional ConfigMap for namespace-level access rules).
 */

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export type KryptonScope = 'namespace' | 'cluster';

export const config = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000',
  /** namespace the app itself runs in (injected via downward API in k8s/) */
  appNamespace: process.env.POD_NAMESPACE ?? process.env.KRYPTON_NAMESPACE ?? 'krypton',
  scope: ((process.env.KRYPTON_SCOPE ?? 'namespace').toLowerCase() === 'cluster'
    ? 'cluster'
    : 'namespace') as KryptonScope,
  /** allowlist for cluster scope; empty = all namespaces readable by the SA */
  allowedNamespaces: csv(process.env.KRYPTON_NAMESPACES),

  annotationPrefix: process.env.KRYPTON_ANNOTATION_PREFIX ?? 'krypton.io',
  accessConfigMap: process.env.KRYPTON_ACCESS_CONFIGMAP ?? 'krypton-access',

  adminGroups: csv(process.env.KRYPTON_ADMIN_GROUPS),
  adminUsers: csv(process.env.KRYPTON_ADMIN_USERS).map((s) => s.toLowerCase()),

  /** cap on stored historical snapshot Secrets per secret */
  historyLimit: Number.parseInt(process.env.KRYPTON_HISTORY_LIMIT ?? '20', 10) || 20,

  /** set true when etcd encryption-at-rest (e.g. aescbc) is enabled; else show warning */
  etcdEncrypted: bool(process.env.KRYPTON_ETCD_ENCRYPTED, false),

  /**
   * When true AND the cluster API server trusts the same OIDC issuer,
   * forward Impersonate-User / Impersonate-Group headers so K8s RBAC
   * authorizes the human instead of the app ServiceAccount.
   * Default false = hybrid mode (SSO auth + annotation/ConfigMap authz).
   */
  impersonation: bool(process.env.KRYPTON_IMPERSONATION, false),

  authDisabled: bool(process.env.AUTH_DISABLED, false),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me-32chars!!',
  sessionMaxAgeSec: Number.parseInt(process.env.SESSION_MAX_AGE ?? '28800', 10) || 28800, // 8h

  oidc: {
    issuer: process.env.OIDC_ISSUER ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    scopes: process.env.OIDC_SCOPES ?? 'openid profile email groups',
    /**
     * Allow http:// OIDC issuers (sandbox Dex). Honored ONLY for loopback
     * issuers outside production — see lib/auth.ts enforcement. Default false.
     */
    allowHttp: bool(process.env.OIDC_ALLOW_HTTP, false),
    groupsClaim: process.env.OIDC_GROUPS_CLAIM ?? 'groups',
    usernameClaim: process.env.OIDC_USERNAME_CLAIM ?? 'email',
    nameClaim: process.env.OIDC_NAME_CLAIM ?? 'name',
    // resolved lazily via discovery; redirect derived from appUrl
    get redirectUri() {
      return process.env.OIDC_REDIRECT_URI ?? `${config.appUrl.replace(/\/$/, '')}/api/auth/callback`;
    },
  },
} as const;

export const ANNOTATIONS = {
  get allowedGroups() {
    return `${config.annotationPrefix}/allowed-groups`;
  },
  get allowedUsers() {
    return `${config.annotationPrefix}/allowed-users`;
  },
  /** monotonically increasing app-level version counter */
  get version() {
    return `${config.annotationPrefix}/version`;
  },
  get managedBy() {
    return `${config.annotationPrefix}/managed-by`;
  },
  get description() {
    return `${config.annotationPrefix}/description`;
  },
  get lastModifiedBy() {
    return `${config.annotationPrefix}/last-modified-by`;
  },
  /** on snapshot secrets: original name */
  get historyOf() {
    return `${config.annotationPrefix}/history-of`;
  },
  get snapshotAt() {
    return `${config.annotationPrefix}/snapshot-at`;
  },
  get snapshotBy() {
    return `${config.annotationPrefix}/snapshot-by`;
  },
} as const;

export const LABELS = {
  get managedBy() {
    return `${config.annotationPrefix}/managed-by`;
  },
  get historyOf() {
    return `${config.annotationPrefix}/history-of`;
  },
  /** distinguishes live secrets from historical snapshots */
  get kind() {
    return `${config.annotationPrefix}/kind`;
  },
} as const;

export const MANAGED_BY_VALUE = 'krypton';

/** K8s enforces ~1MiB per Secret object (data + metadata). */
export const K8S_SECRET_SIZE_LIMIT = 1024 * 1024;
