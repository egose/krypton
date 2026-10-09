import { connection, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { createSessionToken, handleOidcCallback, setSessionCookie } from '@/lib/auth';

export async function GET(req: Request) {
  // Never prerender: token exchange needs request cookies + deploy-time env.
  await connection();
  try {
    const user = await handleOidcCallback(new URL(req.url));
    await setSessionCookie(await createSessionToken(user));
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        app: 'krypton',
        action: 'auth.login',
        user: user.email,
        result: 'allow',
      }),
    );
    return NextResponse.redirect(new URL('/', config.appUrl));
  } catch (err) {
    // Next.js probes this route during prerendering; rethrow the bailout
    // signal instead of logging it as a real auth failure.
    if ((err as Error)?.message?.includes('bail out of prerendering')) throw err;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        app: 'krypton',
        action: 'auth.callback',
        result: 'error',
        detail: (err as Error)?.message,
      }),
    );
    return NextResponse.redirect(new URL('/?auth=error', config.appUrl));
  }
}
