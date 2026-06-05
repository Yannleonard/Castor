# =============================================================================
# Castor — Makefile (Unix/macOS). Windows users: use build.ps1.
#
# The load-bearing build contract (kept in lockstep across three agents):
#   UI vite build.outDir = ../server/web/dist
#   Go //go:embed dist    (server/web/embed.go)
#   So `make embed` builds the UI straight into server/web/dist, then `make
#   go-build` compiles the binary with that dist embedded.
# =============================================================================

# ---- configuration ----------------------------------------------------------
IMAGE        ?= ghcr.io/gtek-it/castor
VERSION      ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT       ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
PLATFORMS    ?= linux/amd64,linux/arm64
DIST_DIR     := server/web/dist
BIN          := out/castor
PKG          := ./server/cmd/castor
MODULE       := github.com/gtek-it/castor
LDFLAGS      := -s -w \
                -X $(MODULE)/server/internal/version.Version=$(VERSION) \
                -X $(MODULE)/server/internal/version.Commit=$(COMMIT)

# Host port for `make run` / `make dev`.
PORT         ?= 8080
# Docker socket GID for `make run` (override: make run DOCKER_GID=998).
DOCKER_GID   ?= $(shell getent group docker 2>/dev/null | cut -d: -f3 || echo 999)

.DEFAULT_GOAL := help
SHELL := /bin/sh

# ---- meta -------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@echo "Castor — make targets:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: print-version
print-version: ## Print the resolved VERSION / COMMIT
	@echo "VERSION=$(VERSION) COMMIT=$(COMMIT)"

# ---- UI ---------------------------------------------------------------------
.PHONY: ui-deps
ui-deps: ## Install UI dependencies (npm ci)
	cd ui && npm ci

.PHONY: ui-build
ui-build: ## Build the React UI into server/web/dist (vite outDir)
	cd ui && npm run build
	@test -f $(DIST_DIR)/index.html \
	  || { echo "FATAL: $(DIST_DIR)/index.html missing — check ui/vite.config.ts build.outDir (must be ../server/web/dist)"; exit 1; }

.PHONY: ui-test
ui-test: ## Run UI unit tests (vitest)
	cd ui && npm test

.PHONY: embed
embed: ui-deps ui-build ## Install deps + build UI into the Go embed path (server/web/dist)
	@echo "UI embedded into $(DIST_DIR)"

# ---- Go ---------------------------------------------------------------------
.PHONY: go-build
go-build: ## Build the static, CGO-free Go binary (embeds whatever is in server/web/dist)
	@mkdir -p out
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN) $(PKG)
	@echo "built $(BIN) ($(VERSION) / $(COMMIT))"

.PHONY: build
build: embed go-build ## Full local build: UI -> embed -> static Go binary

.PHONY: test
test: ## Run Go unit tests with race detector
	go test -race ./...

.PHONY: lint
lint: ## Run golangci-lint (install: https://golangci-lint.run)
	golangci-lint run ./...

.PHONY: govulncheck
govulncheck: ## Run govulncheck (ADR-003 §7 mandate)
	go run golang.org/x/vuln/cmd/govulncheck@latest ./...

.PHONY: tidy
tidy: ## go mod tidy
	go mod tidy

.PHONY: verify
verify: lint test govulncheck ## lint + test + govulncheck (CI gate, server side)

# ---- Docker -----------------------------------------------------------------
.PHONY: docker-build
docker-build: ## Build the image for the LOCAL arch and load it (tag: $(IMAGE):$(VERSION))
	docker buildx build \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  -t $(IMAGE):$(VERSION) -t $(IMAGE):latest \
	  --load .

.PHONY: docker-buildx
docker-buildx: ## Build multi-arch ($(PLATFORMS)) — requires --push or --load per platform
	docker buildx build \
	  --platform $(PLATFORMS) \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  -t $(IMAGE):$(VERSION) -t $(IMAGE):latest \
	  .

.PHONY: docker-push
docker-push: ## Build + push multi-arch ($(PLATFORMS)) to the registry
	docker buildx build \
	  --platform $(PLATFORMS) \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  -t $(IMAGE):$(VERSION) -t $(IMAGE):latest \
	  --push .

# ---- run --------------------------------------------------------------------
.PHONY: run
run: ## Run the built image locally (needs CASTOR_SECRET_KEY in the env)
	@test -n "$$CASTOR_SECRET_KEY" || { echo "set CASTOR_SECRET_KEY first: export CASTOR_SECRET_KEY=\$$(openssl rand -hex 32)"; exit 1; }
	docker run --rm -it \
	  --name castor \
	  -p $(PORT):8080 \
	  -e CASTOR_SECRET_KEY="$$CASTOR_SECRET_KEY" \
	  -v /var/run/docker.sock:/var/run/docker.sock:ro \
	  -v castor-data:/data \
	  --group-add $(DOCKER_GID) \
	  --read-only --tmpfs /tmp \
	  --security-opt no-new-privileges:true \
	  --cap-drop ALL \
	  $(IMAGE):latest

.PHONY: compose-up
compose-up: ## docker compose up -d using deploy/docker-compose.yml
	docker compose -f deploy/docker-compose.yml up -d

.PHONY: compose-down
compose-down: ## docker compose down
	docker compose -f deploy/docker-compose.yml down

# ---- dev --------------------------------------------------------------------
# Backend on :8080 (serves the embedded placeholder UI), UI dev server on :5173
# with vite proxying /api and /ws to :8080. Run two terminals, or use this target
# which starts the Go server in the background and the vite dev server in front.
.PHONY: dev
dev: ## Local dev: go run backend (:8080) + vite dev server (:5173, proxies /api,/ws)
	@echo "starting backend on :8080 (Ctrl-C stops the vite dev server; then run 'make dev-stop')"
	CGO_ENABLED=0 go run $(PKG) & echo $$! > .castor-dev.pid
	cd ui && npm run dev

.PHONY: dev-stop
dev-stop: ## Stop the backgrounded `make dev` backend
	@if [ -f .castor-dev.pid ]; then kill `cat .castor-dev.pid` 2>/dev/null || true; rm -f .castor-dev.pid; echo "backend stopped"; else echo "no backend pid file"; fi

# ---- clean ------------------------------------------------------------------
.PHONY: clean
clean: ## Remove build artifacts (keeps the committed dist placeholder)
	rm -rf out ui/dist ui/node_modules .castor-dev.pid
	git checkout -- $(DIST_DIR)/index.html 2>/dev/null || true
