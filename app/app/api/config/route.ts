import { connection, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { isOidcConfigured } from '@/lib/auth';

/** Public-safe client configuration (no secrets). */
export async function GET() {
  // Env differs between build and deploy (one image, many clusters):
  // always resolve at request time, never prerender.
  await connection();
  return NextResponse.json({
    scope: config.scope,
    etcdEncrypted: config.etcdEncrypted,
    authDisabled: config.authDisabled,
    oidcConfigured: isOidcConfigured(),
    historyLimit: config.historyLimit,
    appNamespace: config.appNamespace,
  });
}
