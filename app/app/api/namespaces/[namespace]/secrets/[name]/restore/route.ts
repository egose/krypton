import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCoreApi, requestOptions } from '@/lib/k8s';
import { HttpError, jsonError, requireUser } from '@/lib/http';
import { assertNamespaceAllowed } from '@/lib/namespaces';
import { canAccessSecret } from '@/lib/authz';
import { buildLiveSecret, createSnapshot, decodeData, toDetail } from '@/lib/secrets';
import { auditLog } from '@/lib/validation';

type Ctx = RouteContext<'/api/namespaces/[namespace]/secrets/[name]/restore'>;

const restoreSchema = z.object({
  /** app-level version number (from krypton.io/version) to roll back to */
  version: z.number().int().positive(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { namespace, name } = await ctx.params;
    await assertNamespaceAllowed(namespace, user);
    const { version } = restoreSchema.parse(await req.json());

    const core = getCoreApi();
    const live = await core.readNamespacedSecret({ namespace, name }, requestOptions(user));
    if (!(await canAccessSecret(user, namespace, live))) {
      auditLog({ action: 'secret.restore', user: user.email, namespace, name, result: 'deny' });
      throw new HttpError(403, 'You are not allowed to modify this secret');
    }

    // Find the snapshot for the requested version.
    const { LABELS } = await import('@/lib/config');
    const snapshots = await core.listNamespacedSecret(
      { namespace, labelSelector: `${LABELS.historyOf}=${name},${LABELS.kind}=history` },
      requestOptions(user),
    );
    const { ANNOTATIONS } = await import('@/lib/config');
    const target = (snapshots.items ?? []).find(
      (s) => Number.parseInt(s.metadata?.annotations?.[ANNOTATIONS.version] ?? '', 10) === version,
    );
    if (!target) throw new HttpError(404, `No snapshot found for version ${version}`);

    // Snapshot current state first so the restore itself is reversible.
    await createSnapshot(namespace, live, user);
    const restored = await core.replaceNamespacedSecret(
      {
        namespace,
        name,
        body: buildLiveSecret({
          live,
          name,
          namespace,
          data: decodeData(target),
          user,
        }),
      },
      requestOptions(user),
    );
    auditLog({
      action: 'secret.restore',
      user: user.email,
      namespace,
      name,
      resourceVersion: restored.metadata?.resourceVersion,
      result: 'allow',
      detail: `restored to v${version}`,
    });
    return NextResponse.json({ secret: toDetail(namespace, restored) });
  } catch (err) {
    return jsonError(err);
  }
}
