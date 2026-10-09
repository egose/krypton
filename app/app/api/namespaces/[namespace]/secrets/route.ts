import { NextResponse } from 'next/server';
import { getCoreApi, requestOptions } from '@/lib/k8s';
import { HttpError, isConflict, jsonError, requireUser } from '@/lib/http';
import { assertNamespaceAllowed } from '@/lib/namespaces';
import { canCreateInNamespace, filterVisibleSecrets } from '@/lib/authz';
import { assertSizeOk, buildLiveSecret, isHistorySnapshot, toSummary } from '@/lib/secrets';
import { auditLog, createSecretSchema } from '@/lib/validation';

export async function GET(_req: Request, ctx: RouteContext<'/api/namespaces/[namespace]/secrets'>) {
  try {
    const user = await requireUser();
    const { namespace } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const core = getCoreApi();
    const res = await core.listNamespacedSecret({ namespace }, requestOptions(user));
    const live = (res.items ?? []).filter((s) => !isHistorySnapshot(s));
    const visible = await filterVisibleSecrets(user, namespace, live);
    return NextResponse.json({
      namespace,
      secrets: visible.map((s) => toSummary(namespace, s)),
      // UX hint so the UI can disable creation upfront (POST still enforces).
      canCreate: await canCreateInNamespace(user, namespace),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, ctx: RouteContext<'/api/namespaces/[namespace]/secrets'>) {
  try {
    const user = await requireUser();
    const { namespace } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    if (!(await canCreateInNamespace(user, namespace))) {
      auditLog({
        action: 'secret.create',
        user: user.email,
        namespace,
        result: 'deny',
      });
      throw new HttpError(403, `You are not allowed to create secrets in "${namespace}"`);
    }

    const body = createSecretSchema.parse(await req.json());
    const data = { ...body.data, ...(body.stringData ?? {}) };
    assertSizeOk(data);

    const core = getCoreApi();
    try {
      const created = await core.createNamespacedSecret(
        {
          namespace,
          body: buildLiveSecret({
            name: body.name,
            namespace,
            type: body.type,
            data,
            description: body.description,
            allowedGroups: body.allowedGroups,
            allowedUsers: body.allowedUsers,
            user,
          }),
        },
        requestOptions(user),
      );
      auditLog({
        action: 'secret.create',
        user: user.email,
        namespace,
        name: body.name,
        keys: Object.keys(data),
        resourceVersion: created.metadata?.resourceVersion,
        result: 'allow',
      });
      return NextResponse.json({ secret: toSummary(namespace, created) }, { status: 201 });
    } catch (err: unknown) {
      if (isConflict(err)) {
        throw new HttpError(409, `Secret "${body.name}" already exists in "${namespace}"`);
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}
