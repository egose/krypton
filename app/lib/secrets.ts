import type { V1Secret } from '@kubernetes/client-node';
import { ANNOTATIONS, LABELS, MANAGED_BY_VALUE, config } from './config';
import { getAppsApi, getCoreApi, patchOptions, requestOptions, toK8sError } from './k8s';
import type { SessionUser } from './auth';
import { estimateSecretSize } from './validation';
import { K8S_SECRET_SIZE_LIMIT } from './config';

// ---------------------------------------------------------------------------
// DTOs (values are plain strings at the API boundary; base64 stays in K8s)
// ---------------------------------------------------------------------------

export interface SecretSummary {
  namespace: string;
  name: string;
  type: string;
  keys: string[];
  keyCount: number;
  description: string;
  version: number;
  resourceVersion: string;
  creationTimestamp?: string;
  allowedGroups: string[];
  allowedUsers: string[];
  managedByKrypton: boolean;
}

export interface SecretDetail extends SecretSummary {
  /** decoded key → value (NEVER log this) */
  data: Record<string, string>;
}

export interface SecretVersion {
  version: number;
  snapshotName: string;
  snapshotAt?: string;
  snapshotBy?: string;
  keys: string[];
  /** decoded values; only populated for authorized readers */
  data: Record<string, string>;
}

export function decodeData(secret: V1Secret): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secret.data ?? {})) {
    try {
      out[k] = Buffer.from(v, 'base64').toString('utf8');
    } catch {
      out[k] = '';
    }
  }
  return out;
}

export function encodeData(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = Buffer.from(v ?? '', 'utf8').toString('base64');
  return out;
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isHistorySnapshot(secret: V1Secret): boolean {
  return secret.metadata?.labels?.[LABELS.kind] === 'history';
}

export function toSummary(namespace: string, secret: V1Secret): SecretSummary {
  const ann = secret.metadata?.annotations ?? {};
  return {
    namespace,
    name: secret.metadata?.name ?? '',
    type: secret.type ?? 'Opaque',
    keys: Object.keys(secret.data ?? {}).sort(),
    keyCount: Object.keys(secret.data ?? {}).length,
    description: ann[ANNOTATIONS.description] ?? '',
    version: Number.parseInt(ann[ANNOTATIONS.version] ?? '0', 10) || 0,
    resourceVersion: secret.metadata?.resourceVersion ?? '',
    creationTimestamp: secret.metadata?.creationTimestamp as unknown as string | undefined,
    allowedGroups: csv(ann[ANNOTATIONS.allowedGroups]),
    allowedUsers: csv(ann[ANNOTATIONS.allowedUsers]),
    managedByKrypton: ann[ANNOTATIONS.managedBy] === MANAGED_BY_VALUE,
  };
}

export function toDetail(namespace: string, secret: V1Secret): SecretDetail {
  return { ...toSummary(namespace, secret), data: decodeData(secret) };
}

export function assertSizeOk(data: Record<string, string>): void {
  const size = estimateSecretSize(data);
  if (size > K8S_SECRET_SIZE_LIMIT) {
    const err = new Error(`Secret payload (~${size} bytes) exceeds the Kubernetes 1MiB object limit`);
    (err as Error & { status?: number }).status = 413;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// History snapshots: one K8s Secret per version, selected via label
// ---------------------------------------------------------------------------

function snapshotName(base: string, version: number): string {
  const suffix = `-v${version}`;
  const maxBase = 253 - suffix.length;
  const trimmed = base.length > maxBase ? base.slice(0, maxBase) : base;
  return `${trimmed}${suffix}`;
}

function nextVersion(secret: V1Secret): number {
  const current = Number.parseInt(secret.metadata?.annotations?.[ANNOTATIONS.version] ?? '0', 10);
  return (Number.isFinite(current) ? current : 0) + 1;
}

/** Persist current state as an immutable snapshot before overwriting. */
export async function createSnapshot(namespace: string, live: V1Secret, user: SessionUser): Promise<void> {
  const core = getCoreApi();
  const name = live.metadata?.name ?? '';
  const version = Number.parseInt(live.metadata?.annotations?.[ANNOTATIONS.version] ?? '0', 10) || 1;
  const liveAnn = live.metadata?.annotations ?? {};
  const now = new Date().toISOString();

  const snapshot: V1Secret = {
    metadata: {
      name: snapshotName(name, version),
      namespace,
      labels: {
        [LABELS.managedBy]: MANAGED_BY_VALUE,
        [LABELS.kind]: 'history',
        [LABELS.historyOf]: name,
      },
      annotations: {
        [ANNOTATIONS.historyOf]: name,
        [ANNOTATIONS.version]: String(version),
        [ANNOTATIONS.snapshotAt]: now,
        [ANNOTATIONS.snapshotBy]: user.email,
        [ANNOTATIONS.description]: liveAnn[ANNOTATIONS.description] ?? '',
        [ANNOTATIONS.allowedGroups]: liveAnn[ANNOTATIONS.allowedGroups] ?? '',
        [ANNOTATIONS.allowedUsers]: liveAnn[ANNOTATIONS.allowedUsers] ?? '',
      },
    },
    type: live.type ?? 'Opaque',
    data: live.data ?? {},
  };

  try {
    await core.createNamespacedSecret({ namespace, body: snapshot }, requestOptions(user));
  } catch (err: unknown) {
    // Snapshot already exists (retry path) — not fatal.
    if (toK8sError(err).status === 409) return;
    throw err;
  }
  await pruneSnapshots(namespace, name, user);
}

async function pruneSnapshots(namespace: string, name: string, user: SessionUser): Promise<void> {
  if (config.historyLimit <= 0) return;
  const versions = await listVersions(namespace, name, user);
  const excess = versions.slice(config.historyLimit);
  if (excess.length === 0) return;
  const core = getCoreApi();
  await Promise.allSettled(
    excess.map((v) => core.deleteNamespacedSecret({ namespace, name: v.snapshotName }, requestOptions(user))),
  );
}

export async function listVersions(namespace: string, name: string, user: SessionUser): Promise<SecretVersion[]> {
  const core = getCoreApi();
  const res = await core.listNamespacedSecret(
    { namespace, labelSelector: `${LABELS.historyOf}=${name},${LABELS.kind}=history` },
    requestOptions(user),
  );
  const items = (res.items ?? []).filter((s) => !isHistorySnapshot(s) || true);
  return items
    .map((s) => {
      const ann = s.metadata?.annotations ?? {};
      return {
        version: Number.parseInt(ann[ANNOTATIONS.version] ?? '0', 10) || 0,
        snapshotName: s.metadata?.name ?? '',
        snapshotAt: ann[ANNOTATIONS.snapshotAt],
        snapshotBy: ann[ANNOTATIONS.snapshotBy],
        keys: Object.keys(s.data ?? {}).sort(),
        data: decodeData(s),
      } satisfies SecretVersion;
    })
    .sort((a, b) => b.version - a.version);
}

/** Build the patched live object for create/update/restore. */
export function buildLiveSecret(args: {
  live?: V1Secret;
  name: string;
  namespace: string;
  type?: string;
  data: Record<string, string>;
  description?: string;
  allowedGroups?: string[];
  allowedUsers?: string[];
  user: SessionUser;
}): V1Secret {
  const { live, name, namespace, type, data, description, allowedGroups, allowedUsers, user } = args;
  const version = live ? nextVersion(live) : 1;
  const prevAnn = live?.metadata?.annotations ?? {};
  return {
    metadata: {
      name,
      namespace,
      ...(live?.metadata?.resourceVersion ? { resourceVersion: live.metadata.resourceVersion } : {}),
      annotations: {
        ...prevAnn,
        [ANNOTATIONS.managedBy]: MANAGED_BY_VALUE,
        [ANNOTATIONS.version]: String(version),
        [ANNOTATIONS.lastModifiedBy]: user.email,
        [ANNOTATIONS.description]: description ?? prevAnn[ANNOTATIONS.description] ?? '',
        [ANNOTATIONS.allowedGroups]:
          allowedGroups !== undefined ? allowedGroups.join(', ') : (prevAnn[ANNOTATIONS.allowedGroups] ?? ''),
        [ANNOTATIONS.allowedUsers]:
          allowedUsers !== undefined ? allowedUsers.join(', ') : (prevAnn[ANNOTATIONS.allowedUsers] ?? ''),
      },
    },
    type: type ?? live?.type ?? 'Opaque',
    data: encodeData(data),
  };
}

// ---------------------------------------------------------------------------
// Consumer restart: env-var consumers need a rollout; volume mounts sync alone
// ---------------------------------------------------------------------------

export interface RestartResult {
  deployments: string[];
  statefulSets: string[];
  daemonSets: string[];
  note: string;
}

function podTemplateUsesSecret(template: unknown, secretName: string): boolean {
  // Walk the pod spec JSON for any reference to the secret name.
  try {
    const haystack = JSON.stringify(template ?? {});
    // Match `"secretName":"<name>"` and `"name":"<name>"` inside secret refs.
    return (
      haystack.includes(`"secretName":"${secretName}"`) || haystack.includes(`"secretKeyRef":{"key":`) // conservative: key refs validated below
    );
  } catch {
    return false;
  }
}

function templateReferencesSecret(template: unknown, secretName: string): boolean {
  if (!template || typeof template !== 'object') return false;
  const spec = (template as { spec?: Record<string, unknown> })?.spec;
  if (!spec || typeof spec !== 'object') return false;

  const containers: unknown[] = [
    ...((spec.containers as unknown[]) ?? []),
    ...((spec.initContainers as unknown[]) ?? []),
    ...((spec.ephemeralContainers as unknown[]) ?? []),
  ];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    for (const from of (rec.envFrom as Array<Record<string, unknown>> | undefined) ?? []) {
      if (from?.secretRef && (from.secretRef as Record<string, unknown>).name === secretName) return true;
    }
    for (const e of (rec.env as Array<Record<string, unknown>> | undefined) ?? []) {
      const ref = (e?.valueFrom as Record<string, unknown> | undefined)?.secretKeyRef as
        | Record<string, unknown>
        | undefined;
      if (ref?.name === secretName) return true;
    }
  }
  for (const v of (spec.volumes as Array<Record<string, unknown>> | undefined) ?? []) {
    if ((v?.secret as Record<string, unknown> | undefined)?.secretName === secretName) return true;
  }
  // Fallback string scan for projected sources etc.
  return podTemplateUsesSecret(spec, secretName) && JSON.stringify(spec).includes(secretName);
}

export async function restartConsumers(
  namespace: string,
  secretName: string,
  user: SessionUser,
): Promise<RestartResult> {
  const apps = getAppsApi();
  const now = new Date().toISOString();
  const patch = {
    metadata: {},
    spec: { template: { metadata: { annotations: { 'krypton.io/restarted-at': now } } } },
  };
  const opts = patchOptions(user);

  const result: RestartResult = {
    deployments: [],
    statefulSets: [],
    daemonSets: [],
    note: 'Volume-mounted secrets sync automatically via kubelet (with delay); environment-variable consumers require this rollout restart to pick up new values.',
  };

  const [deps, stss, dss] = await Promise.all([
    apps.listNamespacedDeployment({ namespace }),
    apps.listNamespacedStatefulSet({ namespace }),
    apps.listNamespacedDaemonSet({ namespace }),
  ]);

  const targets: Array<{ kind: 'deploy' | 'sts' | 'ds'; name: string }> = [];
  for (const d of deps.items ?? []) {
    if (templateReferencesSecret(d.spec?.template, secretName) && d.metadata?.name)
      targets.push({ kind: 'deploy', name: d.metadata.name });
  }
  for (const s of stss.items ?? []) {
    if (templateReferencesSecret(s.spec?.template, secretName) && s.metadata?.name)
      targets.push({ kind: 'sts', name: s.metadata.name });
  }
  for (const d of dss.items ?? []) {
    if (templateReferencesSecret(d.spec?.template, secretName) && d.metadata?.name)
      targets.push({ kind: 'ds', name: d.metadata.name });
  }

  await Promise.allSettled(
    targets.map((t) => {
      if (t.kind === 'deploy') {
        result.deployments.push(t.name);
        return apps.patchNamespacedDeployment({ namespace, name: t.name, body: patch }, opts);
      }
      if (t.kind === 'sts') {
        result.statefulSets.push(t.name);
        return apps.patchNamespacedStatefulSet({ namespace, name: t.name, body: patch }, opts);
      }
      result.daemonSets.push(t.name);
      return apps.patchNamespacedDaemonSet({ namespace, name: t.name, body: patch }, opts);
    }),
  );

  return result;
}
