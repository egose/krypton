import { connection, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { createSessionToken, DEV_USER, getAuthorizationUrl, isOidcConfigured, setSessionCookie } from '@/lib/auth';

/** Start SSO login — or short-circuit to a dev session when AUTH_DISABLED. */
export async function GET() {
  // OIDC discovery must never run at build time (see /api/config): env at
  // build time (e.g. sandbox http issuer) differs from deploy time.
  await connection();
  if (config.authDisabled) {
    await setSessionCookie(await createSessionToken(DEV_USER));
    return NextResponse.redirect(new URL('/', config.appUrl));
  }
  if (!isOidcConfigured()) {
    return NextResponse.json(
      { error: 'OIDC is not configured. Set OIDC_ISSUER/OIDC_CLIENT_ID or AUTH_DISABLED=true for local dev.' },
      { status: 501 },
    );
  }
  const url = await getAuthorizationUrl();
  return NextResponse.redirect(url);
}
