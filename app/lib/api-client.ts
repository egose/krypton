'use client';

import type { SecretDetail, SecretSummary, SecretVersion, RestartResult } from './secrets';
import type { SessionUser } from './auth';

export interface PublicConfig {
  scope: 'namespace' | 'cluster';
  etcdEncrypted: boolean;
  authDisabled: boolean;
  oidcConfigured: boolean;
  historyLimit: number;
  appNamespace: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // Bounce to SSO only for *app-session* 401s — a 401 from the Kubernetes
    // API itself (bad SA/kubeconfig) must surface as an error, not a login loop.
    const sessionExpired = res.status === 401 && (body.error === 'Authentication required' || path === '/api/auth/me');
    if (sessionExpired && typeof window !== 'undefined') {
      // Hard navigation is intentional: this runs outside React (no router),
      // and expiry must reset all client-side cached secrets/state.
      if (!window.location.pathname.startsWith('/login')) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login';
      }
    }
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  config: () => request<PublicConfig>('/api/config'),
  me: () => request<{ user: SessionUser }>('/api/auth/me'),
  namespaces: () => request<{ scope: string; namespaces: string[] }>('/api/namespaces'),

  listSecrets: (ns: string) =>
    request<{ namespace: string; secrets: SecretSummary[] }>(`/api/namespaces/${encodeURIComponent(ns)}/secrets`),
  getSecret: (ns: string, name: string) =>
    request<{ secret: SecretDetail }>(`/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}`),
  createSecret: (
    ns: string,
    input: {
      name: string;
      type?: string;
      data: Record<string, string>;
      description?: string;
      allowedGroups?: string[];
      allowedUsers?: string[];
    },
  ) =>
    request<{ secret: SecretSummary }>(`/api/namespaces/${encodeURIComponent(ns)}/secrets`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSecret: (
    ns: string,
    name: string,
    input: {
      data: Record<string, string>;
      description?: string;
      allowedGroups?: string[];
      allowedUsers?: string[];
      resourceVersion: string;
    },
  ) =>
    request<{ secret: SecretDetail }>(`/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteSecret: (ns: string, name: string) =>
    request<{ deleted: string }>(`/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  listVersions: (ns: string, name: string) =>
    request<{ namespace: string; name: string; versions: SecretVersion[] }>(
      `/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}/versions`,
    ),
  restoreVersion: (ns: string, name: string, version: number) =>
    request<{ secret: SecretDetail }>(
      `/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}/restore`,
      { method: 'POST', body: JSON.stringify({ version }) },
    ),
  restartConsumers: (ns: string, name: string) =>
    request<RestartResult>(
      `/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}/restart-consumers`,
      { method: 'POST' },
    ),
};
