.PHONY: build test clean docker-build docker-push docker-release

# Build the Docker image
build:
	docker-compose build

# Quick functional test (streamlined, idempotent)
test:
	./scripts/quick-test.sh

# Test file mode only
test-file:
	@docker-compose down -v 2>/dev/null || true
	@echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | docker-compose run --rm -T mcp-file-mode | jq '.result.tools | length' | xargs -I {} echo "✅ {} tools available"
	@docker-compose down -v 2>/dev/null || true

# Clean up everything (idempotent)
clean:
	docker-compose down -v 2>/dev/null || true
	docker system prune -f 2>/dev/null || true

# Legacy tests (more complex)
test-redis:
	docker-compose run --rm -e STORAGE_MODE=redis test-runner pnpm test:redis-mode

test-all:
	docker-compose run --rm test-runner

up:
	docker-compose up -d

down:
	docker-compose down

# === GHCR Docker Build & Push ===

# GitHub Container Registry settings
GITHUB_USERNAME ?= erauner
REGISTRY = ghcr.io
IMAGE_NAME = $(REGISTRY)/$(GITHUB_USERNAME)/software-planning-mcp
VERSION ?= latest

# Build for GHCR
docker-build:
	@echo "🔨 Building Docker image: $(IMAGE_NAME):$(VERSION)"
	docker build -t $(IMAGE_NAME):$(VERSION) .
	@if [ "$(VERSION)" != "latest" ]; then \
		echo "🏷️  Also tagging as latest..."; \
		docker tag $(IMAGE_NAME):$(VERSION) $(IMAGE_NAME):latest; \
	fi
	@echo "✅ Build complete!"
	@echo "📦 Images built:"
	@docker images | grep $(GITHUB_USERNAME)/software-planning-mcp || echo "No images found"

# Login to GHCR
docker-login:
	@echo "🔐 Logging into GitHub Container Registry..."
	@if [ -z "$$GITHUB_TOKEN" ]; then \
		echo "❌ Error: GITHUB_TOKEN environment variable not set!"; \
		echo "💡 Run: export GITHUB_TOKEN=your_github_personal_access_token"; \
		echo "📚 Create a token at: https://github.com/settings/tokens/new"; \
		echo "   Required scopes: write:packages, read:packages, delete:packages"; \
		exit 1; \
	fi
	@echo $$GITHUB_TOKEN | docker login $(REGISTRY) -u $(GITHUB_USERNAME) --password-stdin
	@echo "✅ Successfully logged into GHCR!"

# Push to GHCR
docker-push: docker-login docker-build
	@echo "📤 Pushing to GitHub Container Registry..."
	docker push $(IMAGE_NAME):$(VERSION)
	@if [ "$(VERSION)" != "latest" ]; then \
		docker push $(IMAGE_NAME):latest; \
	fi
	@echo "✅ Push complete!"
	@echo "🌐 Image available at: $(IMAGE_NAME):$(VERSION)"

# Full release process
docker-release: docker-push
	@echo "🎉 Release complete!"
	@echo ""
	@echo "📋 Next steps:"
	@echo "1. Update K8s deployment to use: $(IMAGE_NAME):$(VERSION)"
	@echo "2. Apply to cluster: kubectl apply -k apps/mcp-software-planning/stack/production"
	@echo "3. Verify deployment: kubectl get pods -n devops -l app=mcp-software-planning"

# Verify the built image
docker-verify:
	@echo "🔍 Verifying Docker image..."
	@echo "📊 Image size:"
	@docker images $(IMAGE_NAME) --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}"
	@echo ""
	@echo "🧪 Testing image startup..."
	@docker run --rm -e STORAGE_MODE=file $(IMAGE_NAME):$(VERSION) \
		sh -c 'echo "{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}" | node /app/build/index.js' | \
		jq -r 'if .result.tools then "✅ Image test passed: \(.result.tools | length) tools available" else "❌ Image test failed" end' || \
		echo "❌ Image test failed - check if jq is installed"
