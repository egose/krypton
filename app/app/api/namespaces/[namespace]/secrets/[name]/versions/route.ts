import { NextResponse } from 'next/server';
import { getCoreApi, requestOptions } from '@/lib/k8s';
import { HttpError, jsonError, requireUser } from '@/lib/http';
import { assertNamespaceAllowed } from '@/lib/namespaces';
import { canAccessSecret } from '@/lib/authz';
import { listVersions } from '@/lib/secrets';
import { auditLog } from '@/lib/validation';

type Ctx = RouteContext<'/api/namespaces/[namespace]/secrets/[name]/versions'>;

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.history', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to view this secret');
    }
    const versions = await listVersions(namespace, name, user);
    return NextResponse.json({ namespace, name, versions });
  } catch (err) {
    return jsonError(err);
  }
}
