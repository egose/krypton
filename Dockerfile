# Production image for the Krypton Next.js app (secret manager UI + API).
# Context: repository root (pnpm workspace). Produces ghcr.io/egose/krypton:<tag>.
# Run: docker build -t krypton:sandbox -f Dockerfile .
# Matches app/k8s/deployment.yaml: PORT 3000, USER 65532, readOnlyRootFilesystem.
FROM node:22.22.0-alpine3.23 AS build
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY app/package.json app/package.json
RUN pnpm install --frozen-lockfile --filter app...
COPY . .
RUN pnpm --filter app build
# app/public may be absent from the build context; the runner-stage COPY below requires it.
RUN mkdir -p app/public

FROM node:22.22.0-alpine3.23 AS runner
ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  HOME=/tmp \
  NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv
# Standalone server lives at app/server.js because outputFileTracingRoot
# points at the repo root (see app/next.config.ts output: 'standalone').
COPY --from=build --chown=65532:65532 /repo/app/.next/standalone ./
COPY --from=build --chown=65532:65532 /repo/app/.next/static ./app/.next/static
COPY --from=build --chown=65532:65532 /repo/app/public ./app/public
USER 65532:65532
EXPOSE 3000
CMD ["node", "app/server.js"]
