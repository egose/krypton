import { NextResponse } from 'next/server';
import { getCoreApi, requestOptions } from '@/lib/k8s';
import { HttpError, jsonError, requireUser } from '@/lib/http';
import { assertNamespaceAllowed } from '@/lib/namespaces';
import { canAccessSecret } from '@/lib/authz';
import { restartConsumers } from '@/lib/secrets';
import { auditLog } from '@/lib/validation';

type Ctx = RouteContext<'/api/namespaces/[namespace]/secrets/[name]/restart-consumers'>;

/**
 * Trigger a rolling restart of workloads consuming this secret.
 * Required for env-var consumers; volume mounts sync via kubelet on their own.
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.restart', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to modify this secret');
    }

    const result = await restartConsumers(namespace, name, user);
    auditLog({
      action: 'secret.restart',
      user: user.email,
      namespace,
      name,
      result: 'allow',
      detail: JSON.stringify({
        deployments: result.deployments,
        statefulSets: result.statefulSets,
        daemonSets: result.daemonSets,
      }),
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
