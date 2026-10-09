# Krypton — Kubernetes-native secret manager

A lightweight secret manager UI/API backed **directly by Kubernetes Secret objects**.
No database, no persistent volumes, no secret sprawl: Kubernetes is the source of
truth, and Krypton is the translation + visualization layer on top.

Built with Next.js (App Router), `@kubernetes/client-node`, generic OIDC SSO, and
shadcn-theme components.

## How it works

```
Browser ──SSO login──▶ Krypton (Next.js)
                            │  ServiceAccount token (auto-mounted in-cluster)
                            │  https://kubernetes.default.svc  — no credentials to manage
                            ▼
                    Kubernetes API ──▶ etcd (Secrets + one access ConfigMap)
```

- **State**: every secret is a native `Secret` object. Standard tools (Velero,
  `kubectl`, GitOps) keep working; RBAC, audit logs, and network policies come free.
- **Auth**: users sign in via OIDC SSO (Keycloak, Entra ID, Okta, Google, GitHub…).
  Users do **not** need cluster credentials.
- **Authz (hybrid)**: SSO proves _who you are_; per-secret annotations and one
  namespace-level ConfigMap decide _what you may see_. The app's ServiceAccount
  executes the K8s calls.
- **History**: K8s overwrites secrets in place, so Krypton snapshots the previous
  state into a separate Secret (`<name>-vN`) before every write — rollbacks are
  one click.

## Security model (read this)

Out of the box, Kubernetes Secrets are **base64-encoded, not encrypted**, in etcd —
anyone with etcd or broad API access can decode them. Krypton therefore:

- never logs secret values (audit logs record key _names_ only),
- masks values in the UI until explicitly revealed,
- validates the 1 MiB per-object limit client- and server-side,
- shows a warning banner until you confirm etcd encryption-at-rest is enabled
  (`KRYPTON_ETCD_ENCRYPTED=true` once the API server uses an encryption provider
  such as `aescbc` on OpenShift).

Secrets additionally benefit from strict RBAC, redacted `kubectl` output, and
`tmpfs` (RAM-backed) volume mounts that never touch node disk.

## Access control

**Per-secret annotations** (managed in the UI, override everything below):

```yaml
metadata:
  annotations:
    krypton.io/allowed-groups: 'dev-team, database-admins'
    krypton.io/allowed-users: 'alice@company.com'
```

**Namespace fallback** in ConfigMap `<app-namespace>/krypton-access`, key `access.json`
(see `k8s/configmap-access.yaml`):

```json
{ "production": { "groups": ["dev-team"], "users": ["alice@company.com"] } }
```

Rules: admins (`KRYPTON_ADMIN_GROUPS`/`KRYPTON_ADMIN_USERS`) always pass; a secret
with explicit annotations is decided by those alone; otherwise the namespace rules
apply; with no rules anywhere the secret is visible to all authenticated users
(open by default, restricted once rules are added). Until any admin is configured,
every authenticated user is treated as admin (bootstrap mode — set admins promptly).

**Optional K8s-native impersonation**: if your API server trusts the same OIDC
issuer as the app, set `KRYPTON_IMPERSONATION=true` and Krypton forwards
`Impersonate-User`/`Impersonate-Group` headers so the _human's_ RBAC is evaluated
instead of the ServiceAccount's. Default is `false` (hybrid mode above).

## Versioning & consumer restarts

- Every secret carries `krypton.io/version` (app counter) plus the native
  `metadata.resourceVersion`, which the UI sends back for optimistic-concurrency
  writes (409 + reload prompt on conflict).
- History snapshots are labeled `krypton.io/history-of=<name>` /
  `krypton.io/kind=history` and pruned to `KRYPTON_HISTORY_LIMIT` (default 20).
- Pods with **volume-mounted** secrets sync automatically (kubelet delay); pods
  using **environment variables** need a rollout — use _Restart consumers_, which
  patches Deployments/StatefulSets/DaemonSets referencing the secret.

## Local development

Prerequisites: Node 20+, pnpm, and a kubeconfig pointing at a cluster
(Krypton uses `~/.kube/config` when not running in-cluster).

```bash
cd app
cp .env.example .env   # AUTH_DISABLED=true gives a mock admin, no IdP needed
pnpm install
pnpm dev               # http://localhost:3000
```

To exercise real SSO locally, set `AUTH_DISABLED=false` and fill in `OIDC_*`
(your IdP needs redirect URI `http://localhost:3000/api/auth/callback`).

Prefer a batteries-included setup? The repo-root sandbox spins up a kind
cluster with seeded fixtures plus Dex as a throwaway OIDC provider —
see [`../sandbox/README.md`](../sandbox/README.md) (`make up`, then copy
`sandbox/app.env.sandbox` to `app/.env`).

Useful commands: `pnpm build`, `pnpm lint`, `pnpm start`.

## Deploy to Kubernetes / OpenShift

Manifests live in `k8s/`. Namespace-scoped (default, least privilege):

```bash
kubectl apply -f k8s/namespace.yaml -f k8s/serviceaccount.yaml -f k8s/role.yaml
kubectl apply -f k8s/configmap-access.yaml -f k8s/configmap-app.yaml
# real secrets — never commit values:
kubectl create secret generic krypton-oidc -n krypton \
  --from-literal=OIDC_CLIENT_SECRET='...' \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)"
kubectl apply -f k8s/deployment.yaml
```

For a centralized multi-namespace dashboard instead, set `KRYPTON_SCOPE=cluster`
in `k8s/configmap-app.yaml`, apply `k8s/clusterrole.yaml`, and optionally narrow
with `KRYPTON_NAMESPACES="team-a,team-b"`. Then expose via Ingress/Route with TLS
and register the OIDC redirect URI (`https://<host>/api/auth/callback`).

## Configuration reference

| Variable                                             | Default                                               | Purpose                                                          |
| ---------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `KRYPTON_SCOPE`                                      | `namespace`                                           | `namespace` (own NS only) or `cluster`                           |
| `KRYPTON_NAMESPACES`                                 | —                                                     | comma allowlist for cluster scope                                |
| `KRYPTON_HISTORY_LIMIT`                              | `20`                                                  | snapshots kept per secret                                        |
| `KRYPTON_ETCD_ENCRYPTED`                             | `false`                                               | set `true` once apiserver encryption is on                       |
| `KRYPTON_IMPERSONATION`                              | `false`                                               | forward SSO identity to K8s RBAC                                 |
| `KRYPTON_ADMIN_GROUPS/USERS`                         | —                                                     | bootstrap admins (empty = everyone, lock down!)                  |
| `KRYPTON_ACCESS_CONFIGMAP`                           | `krypton-access`                                      | namespace-rules ConfigMap name                                   |
| `AUTH_DISABLED`                                      | `false`                                               | `true` = mock admin, local dev only                              |
| `SESSION_SECRET`                                     | —                                                     | ≥32-char HMAC key for session JWTs                               |
| `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET`                | —                                                     | SSO provider (discovery-based)                                   |
| `OIDC_ALLOW_HTTP`                                    | `false`                                               | allow `http://` issuers — loopback + non-prod only (sandbox Dex) |
| `OIDC_SCOPES/GROUPS_CLAIM/USERNAME_CLAIM/NAME_CLAIM` | `openid profile email groups`/`groups`/`email`/`name` | claim mapping                                                    |
| `NEXT_PUBLIC_APP_URL`                                | `http://localhost:3000`                               | public URL (derives OIDC redirect)                               |

## Project layout

```
app/                    # Next.js App Router
  api/namespaces/...    # secrets CRUD, versions, restore, restart-consumers
  api/auth/...          # OIDC login/callback/logout/me
  secrets/[ns]/[name]   # detail / edit / history views
lib/                    # k8s client, OIDC+session, authz, snapshots, validation
components/             # dashboard, tables, forms, masked values, history
k8s/                    # namespace, SA, Role/ClusterRole, configs, deployment
```
