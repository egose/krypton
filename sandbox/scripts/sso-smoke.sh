#!/usr/bin/env bash
# Headless end-to-end SSO check: app login -> Dex password form -> callback ->
# session cookie -> GET /api/auth/me. Prints the session user JSON.
# Usage: ./sandbox/scripts/sso-smoke.sh <email> [password] [jar-file]
# Requires: app running with sandbox env (make up + app/.env from app.env.sandbox).
set -euo pipefail

EMAIL="${1:?usage: sso-smoke.sh <email> [password] [jar-file]}"
PASSWORD="${2:-password}"
JAR="${3:-/tmp/krypton-sso-cookie.jar}"
APP="${APP_URL:-http://localhost:3000}"

rm -f "$JAR"

# 1. App login -> 307 to Dex authorize (sets PKCE/nonce/state cookies).
AUTH_URL="$(curl -s -m 10 -c "$JAR" -o /dev/null -D - "$APP/api/auth/login" \
  | tr -d '\r' | grep -i '^location:' | sed 's/^[Ll]ocation: //')"
[ -n "$AUTH_URL" ] || { echo "no authorize redirect from $APP/api/auth/login" >&2; exit 1; }

# 2. Dex authorize -> 302 to its local-login chooser.
LOGIN_URL="$(curl -s -m 10 -b "$JAR" -c "$JAR" -o /dev/null -D - "$AUTH_URL" \
  | tr -d '\r' | grep -i '^location:' | sed 's/^[Ll]ocation: //')"
[ -n "$LOGIN_URL" ] || { echo "no login redirect from Dex authorize" >&2; exit 1; }
case "$LOGIN_URL" in http*) :;; *) LOGIN_URL="$(echo "$AUTH_URL" | sed -E 's|(https?://[^/]+).*|\1|')$LOGIN_URL";; esac

# 3. Login chooser -> 302 to the password form (carries ?state=...).
FORM_URL="$(curl -s -m 10 -b "$JAR" -c "$JAR" -o /dev/null -D - "$LOGIN_URL" \
  | tr -d '\r' | grep -i '^location:' | sed 's/^[Ll]ocation: //')"
[ -n "$FORM_URL" ] || { echo "no password-form redirect from Dex" >&2; exit 1; }
case "$FORM_URL" in http*) :;; *) FORM_URL="$(echo "$AUTH_URL" | sed -E 's|(https?://[^/]+).*|\1|')$FORM_URL";; esac

# 4. POST credentials -> 303 back to Dex (approval is skipped in sandbox).
CALLBACK_SEED="$(curl -s -m 10 -b "$JAR" -c "$JAR" -o /dev/null -D - \
  --data-urlencode "login=$EMAIL" --data-urlencode "password=$PASSWORD" "$FORM_URL" \
  | tr -d '\r' | grep -i '^location:' | sed 's/^[Ll]ocation: //')"
[ -n "$CALLBACK_SEED" ] || { echo "Dex login failed for $EMAIL (bad credentials?)" >&2; exit 1; }
case "$CALLBACK_SEED" in http*) :;; *) CALLBACK_SEED="$(echo "$AUTH_URL" | sed -E 's|(https?://[^/]+).*|\1|')$CALLBACK_SEED";; esac

# 5. Follow through the app callback (code exchange, session cookie).
curl -s -m 15 -b "$JAR" -c "$JAR" -o /dev/null -L --max-redirs 8 "$CALLBACK_SEED" \
  || { echo "callback chain failed" >&2; exit 1; }
grep -q krypton_session "$JAR" || { echo "no session cookie after callback" >&2; exit 1; }

# 6. Prove the session.
curl -s -m 10 -b "$JAR" "$APP/api/auth/me"
echo
echo "OK: headless SSO for $EMAIL (jar: $JAR)" >&2
