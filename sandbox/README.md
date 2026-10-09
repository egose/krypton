# Krypton sandbox

Local end-to-end environment: a **kind** Kubernetes cluster with seeded
fixtures plus **Dex** as a throwaway OIDC provider — everything Krypton needs,
nothing else (no database; Kubernetes _is_ the datastore).

## Prerequisites

- Docker + `docker compose`
- [`kind`](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) (any recent release; validated with v0.33.0)
- `kubectl`, `curl`, Node 20+

## Quickstart

```bash
# from the repo root
make up          # kind cluster + Dex + fixtures
cp sandbox/app.env.sandbox app/.env
cd app && pnpm install && pnpm dev   # http://localhost:3000
```

Sign in with any sandbox user (password is `password` for all):

| User                | Groups          | Role in tests             |
| ------------------- | --------------- | ------------------------- |
| `alice@company.com` | `dev-team`      | restricted-secret reader  |
| `bob@company.com`   | `other-team`    | gets 403s (negative case) |
| `carol@company.com` | `frontend-team` | namespace-fallback reader |
| `admin@company.com` | `krypton-admin` | admin bypass              |

Tear down: `make down` (stops Dex, keeps kind for fast iteration),
`make destroy` (removes Dex volumes **and** the kind cluster), `make reset`.

## Layout

```
sandbox/
  docker-compose.yml   Dex (OIDC); kind is Makefile-managed, not composed
  .env.example         compose-side overrides (cp to .env; all optional)
  app.env.sandbox      ready-made app/.env for sandbox mode
  dex/config.yaml      static clients/users/groups (in-memory, no DB)
  kind/config.yaml     kind cluster definition
  kind/fixtures/       namespaces, secrets, access ConfigMap, consumer Deployment
  scripts/             seed.sh, wait-for-dex.sh, mint-jwt.mjs
```

Ports (all `127.0.0.1`-bound): Dex `5556`, app `3000`, kind API `6443`
(auto-mapped). Changing `DEX_PORT` requires changing the `issuer` in
`dex/config.yaml` and the app's `OIDC_ISSUER` together — the issuer URL embeds
the port.

There is intentionally no `docker-compose.prod.yml` overlay: production Krypton
deploys to Kubernetes via `app/k8s/*.yaml`, not compose.

## Fixture map + expected visibility matrix

| Secret                 | Namespace    | Rule source                             | alice | bob | carol | admin |
| ---------------------- | ------------ | --------------------------------------- | ----- | --- | ----- | ----- |
| `database-credentials` | krypton-test | annotation `allowed-groups: dev-team,…` | ✅    | ❌  | ❌    | ✅    |
| `feature-flags`        | krypton-test | none (open by default)                  | ✅    | ✅  | ✅    | ✅    |
| `legacy-external`      | krypton-test | none + unmanaged ("external" badge)     | ✅    | ✅  | ✅    | ✅    |
| `frontend-api-keys`    | frontend-ns  | namespace fallback (`frontend-team`)    | ❌    | ❌  | ✅    | ✅    |

`frontend-ns` is governed by `krypton-access` in `krypton-test` (the app's own
namespace); `krypton-test` is deliberately absent from it (open by default).
`api-server` (Deployment) consumes `database-credentials` via env and
`feature-flags` via volume for restart-consumer testing.

## Test scenarios

Walk the matrix above by logging in as each user. Then:

- **Versioning**: edit `database-credentials` twice → `<name>-v1/-v2` snapshots
  appear (`kubectl get secret -n krypton-test -l krypton.io/kind=history`);
  restore v1 in the UI (restores snapshot first, so rollback is reversible).
- **409 conflicts**: open the same secret's edit page in two tabs/sessions, save
  both — the second gets the resourceVersion-mismatch prompt.
- **1 MiB guard**: paste a large value — the form meter blocks; forced API calls 413.
- **Restart consumers**: edit `database-credentials`, hit _Restart consumers_,
  then `kubectl rollout history deploy/api-server -n krypton-test` shows a new
  revision with the fresh env value.
- **Redaction**: `grep` the `pnpm dev` log — key names only, never values.
- **External adoption**: editing `legacy-external` stamps Krypton annotations on it.

## Headless authz checks (no browser)

Mint session JWTs directly (must match the app's `SESSION_SECRET`):

```bash
ALICE=$(node sandbox/scripts/mint-jwt.mjs --email alice@company.com --groups dev-team)
BOB=$(node sandbox/scripts/mint-jwt.mjs --email bob@company.com --groups other-team)
curl --cookie "krypton_session=$ALICE" localhost:3000/api/namespaces/krypton-test/secrets/database-credentials  # 200
curl --cookie "krypton_session=$BOB"   localhost:3000/api/namespaces/krypton-test/secrets/database-credentials  # 403
curl --cookie "krypton_session=$BOB"   localhost:3000/api/namespaces/krypton-test/secrets/feature-flags        # 200
```

## Validating the in-cluster path (ServiceAccount + RBAC)

`pnpm dev` uses your kubeconfig (admin-ish) — it does **not** exercise
`app/k8s/role.yaml` or the SA-token flow. Validate those against kind too:

```bash
# from the repo root, with the kind cluster from `make up` running
docker build -t krypton:sandbox -f Dockerfile .
kind load docker-image krypton:sandbox --name krypton-sandbox
kubectl apply -f app/k8s/namespace.yaml -f app/k8s/serviceaccount.yaml -f app/k8s/role.yaml
kubectl apply -f app/k8s/configmap-access.yaml -f app/k8s/configmap-app.yaml
kubectl create secret generic krypton-oidc -n krypton \
  --from-literal=OIDC_CLIENT_SECRET=sandbox-unused \
  --from-literal=SESSION_SECRET=sandbox-only-session-secret-32chars!!!
kubectl apply -f app/k8s/deployment.yaml
kubectl -n krypton set image deploy/krypton krypton=krypton:sandbox
# AUTH_DISABLED=true below: pods inside kind cannot reach host-side Dex via
# localhost, so in-cluster runs validate the SA/RBAC path (pair with
# scripts/mint-jwt.mjs sessions for authz checks). Real SSO stays host-side
# via `pnpm dev`, where both browser and app share the issuer URL.
kubectl -n krypton set env deploy/krypton AUTH_DISABLED=true \
  SESSION_SECRET=sandbox-only-session-secret-32chars!!!
kubectl -n krypton rollout status deploy/krypton
kubectl -n krypton port-forward --address 127.0.0.1 svc/krypton 3300:80
# → http://127.0.0.1:3300, namespace scope over `krypton` only
```

Prove least privilege (Role allows `krypton` only, no namespace listing):

```bash
kubectl auth can-i 'create secrets' -n krypton --as=system:serviceaccount:krypton:krypton         # yes
kubectl auth can-i 'list secrets' -n krypton-test --as=system:serviceaccount:krypton:krypton      # no
kubectl auth can-i 'list namespaces' --as=system:serviceaccount:krypton:krypton                    # no
```

Note: with `KRYPTON_SCOPE=cluster` but only the namespace Role applied, the
app degrades gracefully — `/api/namespaces` falls back to the pod's own
namespace instead of failing, since the SA cannot list namespaces.

Cheap static checks that need no cluster at all:

```bash
make verify-sandbox   # compose config + offline manifest validation (no cluster needed)
```

## Troubleshooting

- `kind: command not found` → install kind (see Prerequisites); `make kind-up`
  fails closed with instructions.
- Wrong cluster (`kubectl config current-context` should be
  `kind-krypton-sandbox`) → `make kind-up` re-selects it; never seed prod.
- Dex unhealthy → `make logs` / `docker compose -f sandbox/docker-compose.yml ps`;
  discovery doc must answer at `http://localhost:5556/dex/.well-known/openid-configuration`.
- App shows login errors → check `OIDC_ISSUER`/`OIDC_ALLOW_HTTP=true` in
  `app/.env` and that Dex is up before the app boots (OIDC config is cached
  per process — restart `pnpm dev` after Dex restarts).
- Stale fixtures → `make seed` re-applies (idempotent); `make reset` for a
  fully clean slate.
