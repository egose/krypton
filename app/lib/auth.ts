import { cookies } from 'next/headers';
import * as jose from 'jose';
import * as openid from 'openid-client';
import { config } from './config';

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  groups: string[];
}

const SESSION_COOKIE = 'krypton_session';
const PKCE_COOKIE = 'krypton_pkce';
const NONCE_COOKIE = 'krypton_nonce';
const STATE_COOKIE = 'krypton_state';

function sessionKey(): Uint8Array {
  return new TextEncoder().encode(config.sessionSecret);
}

export const DEV_USER: SessionUser = {
  sub: 'dev',
  email: 'dev@krypton.local',
  name: 'Local Developer',
  groups: ['krypton-admin'],
};

// ---------------------------------------------------------------------------
// Session JWT (stateless, no DB)
// ---------------------------------------------------------------------------

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new jose.SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('krypton')
    .setExpirationTime(`${config.sessionMaxAgeSec}s`)
    .sign(sessionKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jose.jwtVerify(token, sessionKey(), { issuer: 'krypton' });
    const { sub, email, name, groups } = payload as unknown as SessionUser;
    if (typeof sub !== 'string' || typeof email !== 'string') return null;
    return {
      sub,
      email,
      name: typeof name === 'string' ? name : email,
      groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
    };
  } catch {
    return null;
  }
}

/** Current request user, or null when unauthenticated. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Read cookies unconditionally (even in dev-bypass mode): the session is
  // request data, and this keeps every caller request-time rendered instead
  // of statically prerendered with a baked-in user.
  const store = await cookies();
  if (config.authDisabled) return DEV_USER;
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionMaxAgeSec,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// OIDC (SSO) — generic provider: Keycloak, Entra ID, Okta, Google, GitHub
// ---------------------------------------------------------------------------

let oidcConfig: openid.Configuration | null = null;

export function isOidcConfigured(): boolean {
  return Boolean(config.oidc.issuer && config.oidc.clientId);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

async function getOidcConfiguration(): Promise<openid.Configuration> {
  if (oidcConfig) return oidcConfig;
  if (!isOidcConfigured()) throw new Error('OIDC is not configured');
  const server = new URL(config.oidc.issuer);
  // Fail closed on http:// issuers: only loopback, only with explicit opt-in,
  // and never in production. The `execute` extension flips the Configuration
  // to allow insecure requests for discovery, grants, userinfo, and JWKS.
  const insecure = server.protocol === 'http:';
  if (insecure) {
    if (!isLoopbackHostname(server.hostname)) {
      throw new Error(
        `OIDC issuer "${config.oidc.issuer}" must use HTTPS (plain HTTP is only allowed for loopback issuers)`,
      );
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OIDC_ALLOW_HTTP is rejected when NODE_ENV=production');
    }
    if (!config.oidc.allowHttp) {
      throw new Error('OIDC issuer uses plain HTTP: set OIDC_ALLOW_HTTP=true to allow it (loopback sandbox only)');
    }
  }
  oidcConfig = await openid.discovery(
    server,
    config.oidc.clientId,
    config.oidc.clientSecret || undefined,
    undefined,
    insecure ? { execute: [openid.allowInsecureRequests] } : undefined,
  );
  return oidcConfig;
}

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function extractGroups(claims: Record<string, unknown>): string[] {
  const candidates = [
    config.oidc.groupsClaim,
    'groups',
    'roles',
    'realm_access.roles' in claims ? 'realm_access.roles' : undefined,
  ].filter(Boolean) as string[];
  for (const path of candidates) {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (typeof acc === 'object' && acc !== null && key in acc) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, claims);
    if (Array.isArray(value)) {
      const groups = value.filter((v): v is string => typeof v === 'string');
      if (groups.length > 0) return groups;
    }
  }
  return [];
}

function extractClaim(claims: Record<string, unknown>, primary: string, fallbacks: string[]): string {
  for (const key of [primary, ...fallbacks]) {
    const v = claims[key];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/** Build the IdP login URL and stash PKCE/nonce/state in short-lived cookies. */
export async function getAuthorizationUrl(): Promise<URL> {
  const oidc = await getOidcConfiguration();
  const codeVerifier = openid.randomPKCECodeVerifier();
  const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
  const nonce = openid.randomNonce();
  const state = `${randomToken()}:${randomToken()}`;

  const store = await cookies();
  store.set(PKCE_COOKIE, codeVerifier, cookieOpts(600));
  store.set(NONCE_COOKIE, nonce, cookieOpts(600));
  store.set(STATE_COOKIE, state, cookieOpts(600));

  const parameters: Record<string, string> = {
    redirect_uri: config.oidc.redirectUri,
    scope: config.oidc.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
    state,
  };
  return openid.buildAuthorizationUrl(oidc, parameters);
}

/** Exchange the callback code for tokens and derive the SessionUser. */
export async function handleOidcCallback(currentUrl: URL): Promise<SessionUser> {
  const oidc = await getOidcConfiguration();
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  const nonce = store.get(NONCE_COOKIE)?.value;
  const codeVerifier = store.get(PKCE_COOKIE)?.value;

  // one-time values
  store.delete(PKCE_COOKIE);
  store.delete(NONCE_COOKIE);
  store.delete(STATE_COOKIE);

  const tokens = await openid.authorizationCodeGrant(oidc, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    expectedNonce: nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error('OIDC callback did not return ID token claims');
  const record = claims as unknown as Record<string, unknown>;

  // Prefer userinfo when available for fresh group membership.
  let merged: Record<string, unknown> = { ...record };
  try {
    if (tokens.access_token) {
      const info = await openid.fetchUserInfo(oidc, tokens.access_token, openid.skipSubjectCheck as never);
      merged = { ...merged, ...(info as unknown as Record<string, unknown>) };
    }
  } catch {
    // fall back to ID token claims only
  }

  const sub = extractClaim(merged, 'sub', []);
  const email = extractClaim(merged, config.oidc.usernameClaim, ['email', 'preferred_username', 'upn']).toLowerCase();
  const name = extractClaim(merged, config.oidc.nameClaim, ['name', 'preferred_username']);
  if (!sub || !email) throw new Error('OIDC claims are missing sub/email');

  return { sub, email, name: name || email, groups: extractGroups(merged) };
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
