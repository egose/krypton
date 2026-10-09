SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help up down destroy reset logs logs-follow ps kind-up kind-down seed verify-sandbox

COMPOSE := docker compose -f ./sandbox/docker-compose.yml
KIND_CLUSTER ?= krypton-sandbox
KIND_CONTEXT := kind-$(KIND_CLUSTER)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

up: ## start kind + Dex and seed fixtures (dex always detached; app runs via pnpm dev)
	$(MAKE) kind-up
	$(COMPOSE) up -d --remove-orphans
	./sandbox/scripts/wait-for-dex.sh
	$(MAKE) seed
	@echo ''
	@echo 'Sandbox is up. Next:'
	@echo '  cp sandbox/app.env.sandbox app/.env'
	@echo '  pnpm --dir app install && pnpm --dir app dev   # http://localhost:3000'

down: ## stop Dex (keeps kind cluster + fixtures for fast iteration)
	$(COMPOSE) down

destroy: ## stop Dex, remove its volumes, and delete the kind cluster
	$(COMPOSE) down --volumes --remove-orphans
	$(MAKE) kind-down

reset: destroy up ## destroy then up

logs: ## show recent Dex logs (tail=50)
	$(COMPOSE) logs --tail=50

logs-follow: ## tail Dex logs live
	$(COMPOSE) logs -f

ps: ## list running compose services
	$(COMPOSE) ps

kind-up: ## create kind cluster if missing and select its context
	@command -v kind >/dev/null || (echo "kind not found. Install it first: https://kind.sigs.k8s.io/docs/user/quick-start/#installation" >&2; exit 1)
	@command -v kubectl >/dev/null || (echo "kubectl not found in PATH" >&2; exit 1)
	@kind get clusters 2>/dev/null | grep -qx "$(KIND_CLUSTER)" || kind create cluster --name "$(KIND_CLUSTER)" --config ./sandbox/kind/config.yaml --wait 120s
	kubectl config use-context "$(KIND_CONTEXT)"

kind-down: ## delete the kind cluster
	@command -v kind >/dev/null || (echo "kind not found — nothing to delete" >&2; exit 0)
	kind delete cluster --name "$(KIND_CLUSTER)"

seed: ## apply sandbox fixtures to kind (idempotent)
	./sandbox/scripts/seed.sh "$(KIND_CONTEXT)"

verify-sandbox: ## validate compose file and all k8s manifests (no cluster needed)
	$(COMPOSE) config --quiet
	python3 ./sandbox/scripts/validate-manifests.py
