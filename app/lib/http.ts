import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from './auth';
import { toK8sError } from './k8s';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 401 when unauthenticated (SSO required unless AUTH_DISABLED=true). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const withStatus = err as { status?: number; message?: string };
  if (typeof withStatus?.status === 'number') {
    return NextResponse.json({ error: withStatus.message ?? 'Request failed' }, { status: withStatus.status });
  }
  // Zod validation errors
  if (typeof err === 'object' && err !== null && 'issues' in err) {
    return NextResponse.json(
      { error: 'Validation failed', issues: (err as { issues: unknown }).issues },
      { status: 400 },
    );
  }
  const k8s = toK8sError(err);
  return NextResponse.json({ error: k8s.message }, { status: k8s.status });
}

/** Translate K8s 409 (resourceVersion conflict) into a friendly message. */
export function isConflict(err: unknown): boolean {
  return toK8sError(err).status === 409;
}
