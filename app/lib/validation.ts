import { z } from 'zod';
import { K8S_SECRET_SIZE_LIMIT } from './config';

/** DNS-subdomain name (K8s object names). */
export const k8sName = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/, 'must be a valid DNS subdomain name');

export const secretDataSchema = z
  .record(z.string(), z.string())
  .refine((data) => estimateSecretSize(data) <= K8S_SECRET_SIZE_LIMIT, {
    message: `Secret payload exceeds the Kubernetes 1MiB limit (${K8S_SECRET_SIZE_LIMIT} bytes)`,
  });

export const createSecretSchema = z.object({
  name: k8sName,
  type: z.string().default('Opaque'),
  data: secretDataSchema.default({}),
  stringData: z.record(z.string(), z.string()).optional(),
  description: z.string().max(1024).optional().default(''),
  allowedGroups: z.array(z.string().min(1)).default([]),
  allowedUsers: z.array(z.string().min(1)).default([]),
});

export const updateSecretSchema = z.object({
  data: secretDataSchema,
  description: z.string().max(1024).optional(),
  allowedGroups: z.array(z.string().min(1)).optional(),
  allowedUsers: z.array(z.string().min(1)).optional(),
  /** optimistic concurrency: must match current metadata.resourceVersion */
  resourceVersion: z.string().min(1, 'resourceVersion is required for safe updates'),
});

export type CreateSecretInput = z.infer<typeof createSecretSchema>;
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;

/** Approximate serialized size of the secret data section (UTF-8 bytes). */
export function estimateSecretSize(data: Record<string, string>): number {
  let size = 0;
  for (const [k, v] of Object.entries(data)) {
    size += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v ?? '', 'utf8');
  }
  // base64 inflates ~33% in etcd; account for it conservatively
  return Math.ceil(size * 1.4);
}

/** Namespace-level access rules stored in the krypton-access ConfigMap. */
export const namespaceAccessSchema = z.record(
  z.string(),
  z.object({
    groups: z.array(z.string()).default([]),
    users: z.array(z.string()).default([]),
  }),
);
export type NamespaceAccessMap = z.infer<typeof namespaceAccessSchema>;

/**
 * Redacted logger — NEVER log secret values. Only metadata goes to logs.
 */
export function auditLog(event: {
  action: string;
  user: string;
  namespace: string;
  name?: string;
  keys?: string[];
  resourceVersion?: string;
  result: 'allow' | 'deny' | 'error';
  detail?: string;
}) {
  // Intentionally logs key NAMES only, never values.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      app: 'krypton',
      ...event,
    }),
  );
}
