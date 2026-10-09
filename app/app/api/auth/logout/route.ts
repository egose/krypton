import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { clearSessionCookie } from '@/lib/auth';

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', config.appUrl));
}

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
