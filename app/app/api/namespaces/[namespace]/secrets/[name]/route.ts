import { NextResponse } from 'next/server';
import { getCoreApi, requestOptions } from '@/lib/k8s';
import { HttpError, isConflict, jsonError, requireUser } from '@/lib/http';
import { assertNamespaceAllowed } from '@/lib/namespaces';
import { canAccessSecret } from '@/lib/authz';
import { assertSizeOk, buildLiveSecret, createSnapshot, listVersions, toDetail } from '@/lib/secrets';
import { auditLog, updateSecretSchema } from '@/lib/validation';

type Ctx = RouteContext<'/api/namespaces/[namespace]/secrets/[name]'>;

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.read', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to view this secret');
    }
    return NextResponse.json({ secret: toDetail(namespace, live) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const input = updateSecretSchema.parse(await req.json());
    assertSizeOk(input.data);

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.update', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to modify this secret');
    }
    // Optimistic concurrency on resourceVersion (K8s-native versioning).
    if ((live.metadata?.resourceVersion ?? '') !== input.resourceVersion) {
      auditLog({
        action: 'secret.update',
        user: user.email,
        namespace,
        name,
        resourceVersion: live.metadata?.resourceVersion,
        result: 'error',
        detail: 'resourceVersion conflict',
      });
      throw new HttpError(409, 'This secret changed since you loaded it (resourceVersion mismatch). Reload and retry.');
    }

    // Snapshot current state for rollback history, then replace.
    await createSnapshot(namespace, live, user);
    const next = buildLiveSecret({
      live,
      name,
      namespace,
      data: input.data,
      description: input.description,
      allowedGroups: input.allowedGroups,
      allowedUsers: input.allowedUsers,
      user,
    });
    try {
      const updated = await core.replaceNamespacedSecret({ namespace, name, body: next }, requestOptions(user));
      auditLog({
        action: 'secret.update',
        user: user.email,
        namespace,
        name,
        keys: Object.keys(input.data),
        resourceVersion: updated.metadata?.resourceVersion,
        result: 'allow',
      });
      return NextResponse.json({ secret: toDetail(namespace, updated) });
    } catch (err: unknown) {
      if (isConflict(err)) {
        throw new HttpError(409, 'Write conflict: the secret was modified concurrently. Reload and retry.');
      }
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.delete', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to delete this secret');
    }

    const keepHistory = new URL(req.url).searchParams.get('keepHistory') === 'true';
    await core.deleteNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!keepHistory) {
      const versions = await listVersions(namespace, name, user);
      await Promise.allSettled(
        versions.map((v) => core.deleteNamespacedSecret({ namespace, name: v.snapshotName }, requestOptions(user))),
      );
    }
    auditLog({ action: 'secret.delete', user: user.email, namespace, name, result: 'allow' });
    return NextResponse.json({ deleted: name });
  } catch (err) {
    return jsonError(err);
  }
}
