import * as k8s from '@kubernetes/client-node';
import * as fs from 'node:fs';
import { config } from './config';
import type { SessionUser } from './auth';

const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SA_NAMESPACE_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

let kubeConfig: k8s.KubeConfig | null = null;

function isInCluster(): boolean {
  return fs.existsSync(SA_TOKEN_PATH);
}

/** Load in-cluster ServiceAccount config, falling back to local kubeconfig for dev. */
export function getKubeConfig(): k8s.KubeConfig {
  if (kubeConfig) return kubeConfig;
  const kc = new k8s.KubeConfig();
  if (isInCluster()) {
    // Uses KUBERNETES_SERVICE_HOST/PORT + mounted SA token + CA automatically.
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }
  kubeConfig = kc;
  return kc;
}

export function getCoreApi(): k8s.CoreV1Api {
  return getKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function getAppsApi(): k8s.AppsV1Api {
  return getKubeConfig().makeApiClient(k8s.AppsV1Api);
}

/** Namespace the pod is running in (downward API / SA mount / env fallback). */
export function getPodNamespace(): string {
  if (fs.existsSync(SA_NAMESPACE_PATH)) {
    try {
      return fs.readFileSync(SA_NAMESPACE_PATH, 'utf8').trim() || config.appNamespace;
    } catch {
      return config.appNamespace;
    }
  }
  return config.appNamespace;
}

export function isInClusterRuntime(): boolean {
  return isInCluster();
}

/**
 * Optional K8s-native impersonation. When enabled (and the API server trusts
 * the same OIDC issuer), requests are evaluated against the HUMAN's RBAC
 * instead of the app ServiceAccount. Otherwise the app SA executes all calls
 * and Krypton enforces authz itself via annotations/ConfigMap (hybrid mode).
 */
export function impersonationHeaders(user: SessionUser | null): Record<string, string> {
  if (!config.impersonation || !user || user.email === 'dev@krypton.local') return {};
  const headers: Record<string, string> = { 'Impersonate-User': user.email };
  // Groups need repeated Impersonate-Group headers; the middleware helper sets
  // one value per call, so chain one per group (capped for sanity).
  return headers;
}

/** Per-request options type for the generated API clients (version-proof). */
export type K8sRequestOptions = Parameters<k8s.CoreV1Api['readNamespacedSecret']>[1];

/** Request options carrying impersonation headers (via middleware) when enabled. */
export function requestOptions(user: SessionUser | null): K8sRequestOptions {
  const headers = impersonationHeaders(user);
  if (Object.keys(headers).length === 0) return undefined;
  let opts = k8s.setHeaderOptions('Impersonate-User', headers['Impersonate-User']);
  for (const group of (user?.groups ?? []).slice(0, 32)) {
    opts = k8s.setHeaderOptions('Impersonate-Group', group, opts);
  }
  return opts as K8sRequestOptions;
}

/** Request options for strategic-merge patches (+ impersonation when enabled). */
export function patchOptions(user: SessionUser | null): K8sRequestOptions {
  const base = (requestOptions(user) as Parameters<typeof k8s.setHeaderOptions>[2]) ?? undefined;
  const opts = k8s.setHeaderOptions('Content-Type', 'application/strategic-merge-patch+json', base);
  return opts as K8sRequestOptions;
}

/**
 * Normalize K8s client errors into { status, message }.
 * ApiException messages embed raw headers — extract the human-readable
 * "Message:" line (or API body message) so responses stay clean.
 * All K8s failures are prefixed so the UI can tell them apart from
 * app-session 401s (which trigger a login bounce).
 */
export function toK8sError(err: unknown): { status: number; message: string } {
  if (err instanceof k8s.ApiException) {
    const body = err.body as { message?: string; reason?: string } | undefined;
    const fromBody = body?.message ?? body?.reason;
    const fromText = /Message:\s*(.+)/.exec(err.message ?? '')?.[1]?.trim();
    const detail = fromBody ?? fromText ?? 'request failed';
    return {
      status: err.code ?? 500,
      message: `Kubernetes API (${err.code ?? 'error'}): ${detail.slice(0, 300)}`,
    };
  }
  if (err instanceof Error) return { status: 500, message: err.message.slice(0, 300) };
  return { status: 500, message: 'Unknown Kubernetes error' };
}
