import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { jsonError, requireUser } from '@/lib/http';
import { listAllowedNamespaces } from '@/lib/namespaces';

export async function GET() {
  try {
    const user = await requireUser();
    const namespaces = await listAllowedNamespaces(user);
    return NextResponse.json({ scope: config.scope, namespaces });
  } catch (err) {
    return jsonError(err);
  }
}
