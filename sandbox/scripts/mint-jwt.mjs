#!/usr/bin/env node
/**
 * Mint a Krypton session JWT without an IdP round-trip — for headless authz
 * testing (e.g. verify alice-403 vs bob-200 matrices via curl).
 *
 * Zero dependencies (node:crypto only). The secret must match the app's
 * SESSION_SECRET (sandbox default in sandbox/app.env.sandbox).
 *
 * Usage:
 *   node sandbox/scripts/mint-jwt.mjs --email alice@company.com --groups dev-team
 *   node sandbox/scripts/mint-jwt.mjs --email bob@company.com --name Bob --groups other-team --sub bob-id --secret "$SESSION_SECRET"
 *   curl --cookie "krypton_session=$(node ... )" localhost:3000/api/auth/me
 */
import { createHmac } from 'node:crypto';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function help(exit) {
  console.error(
    'Usage: mint-jwt.mjs --email <email> [--name <n>] [--groups a,b] [--sub <id>] [--secret <s>] [--ttl <sec>]',
  );
  console.error('  --secret defaults to $SESSION_SECRET, then the sandbox default.');
  process.exit(exit);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) help(0);

const email = arg('email');
if (!email) help(2);
const secret =
  arg('secret') ?? process.env.SESSION_SECRET ?? 'sandbox-only-session-secret-32chars!!!';
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: arg('sub', email),
  email: email.toLowerCase(),
  name: arg('name', email),
  groups: (arg('groups', '') ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean),
  iat: now,
  exp: now + Number.parseInt(arg('ttl', '28800'), 10),
  iss: 'krypton',
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const header = b64url(JSON.stringify({ alg: 'HS256' }));
const body = b64url(JSON.stringify(payload));
const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
console.log(`${header}.${body}.${sig}`);
