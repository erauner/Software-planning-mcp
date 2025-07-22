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

# === Docker Build & Push ===

# Registry settings (supports both GHCR and Harbor)
GITHUB_USERNAME ?= erauner
SECRET_DOMAIN ?= erauner.dev
REGISTRY ?= ghcr.io
HARBOR_REGISTRY = harbor.$(SECRET_DOMAIN)
HARBOR_USERNAME ?= robot$$robot_account
HARBOR_PASSWORD ?=

# Image naming
ifeq ($(REGISTRY),$(HARBOR_REGISTRY))
    IMAGE_NAME = $(REGISTRY)/library/software-planning-mcp
else
    IMAGE_NAME = $(REGISTRY)/$(GITHUB_USERNAME)/software-planning-mcp
endif
VERSION ?= latest

# Build for any registry (multi-platform)
docker-build:
	@echo "🔨 Building multi-platform Docker image: $(IMAGE_NAME):$(VERSION)"
	@echo "🖥️  Platforms: linux/amd64,linux/arm64"
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):$(VERSION) .
	@if [ "$(VERSION)" != "latest" ]; then \
		echo "🏷️  Also tagging as latest..."; \
		docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):latest .; \
	fi
	@echo "✅ Build complete!"
	@echo "📦 Images built:"
	@docker images | grep software-planning-mcp || echo "No images found"

# Login to registry (GHCR or Harbor)
docker-login:
	@if [ "$(REGISTRY)" = "$(HARBOR_REGISTRY)" ]; then \
		echo "🔐 Logging into Harbor Registry..."; \
		if [ -z "$$HARBOR_PASSWORD" ]; then \
			echo "❌ Error: HARBOR_PASSWORD environment variable not set!"; \
			echo "💡 Run: export HARBOR_PASSWORD=your_harbor_robot_token"; \
			exit 1; \
		fi; \
		echo $$HARBOR_PASSWORD | docker login $(REGISTRY) -u $(HARBOR_USERNAME) --password-stdin; \
		echo "✅ Successfully logged into Harbor!"; \
	else \
		echo "🔐 Logging into GitHub Container Registry..."; \
		if [ -z "$$GITHUB_TOKEN" ]; then \
			echo "❌ Error: GITHUB_TOKEN environment variable not set!"; \
			echo "💡 Run: export GITHUB_TOKEN=your_github_personal_access_token"; \
			echo "📚 Create a token at: https://github.com/settings/tokens/new"; \
			echo "   Required scopes: write:packages, read:packages, delete:packages"; \
			exit 1; \
		fi; \
		echo $$GITHUB_TOKEN | docker login $(REGISTRY) -u $(GITHUB_USERNAME) --password-stdin; \
		echo "✅ Successfully logged into GHCR!"; \
	fi

# Push to registry (multi-platform with buildx)
docker-push: docker-login
	@echo "📤 Building and pushing multi-platform image to $(REGISTRY)..."
	@echo "🖥️  Platforms: linux/amd64,linux/arm64"
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):$(VERSION) --push .
	@if [ "$(VERSION)" != "latest" ]; then \
		docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE_NAME):latest --push .; \
	fi
	@echo "✅ Push complete!"
	@echo "🌐 Image available at: $(IMAGE_NAME):$(VERSION)"

# Harbor-specific push target
docker-push-harbor:
	$(MAKE) docker-push REGISTRY=$(HARBOR_REGISTRY)

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

# === Kubernetes Testing ===

# Test the live K8s deployment
k8s-test: k8s-test-health k8s-test-tools k8s-test-session

# Check health endpoint
k8s-test-health:
	@echo "🏥 Testing K8s deployment health..."
	@POD=$$(kubectl get pods -n devops -l app=mcp-software-planning -o jsonpath='{.items[0].metadata.name}' 2>/dev/null); \
	if [ -z "$$POD" ]; then \
		echo "❌ No MCP pod found in devops namespace"; \
		exit 1; \
	fi; \
	echo "📦 Testing pod: $$POD"; \
	kubectl exec -n devops $$POD -- curl -s http://localhost:4626/health | jq '.' || echo "❌ Health check failed"

# Test all MCP tools via port-forward
k8s-test-tools:
	@echo "🛠️  Testing MCP tools via K8s..."
	@echo "⏳ Starting port-forward..."
	@kubectl port-forward -n devops svc/mcp-software-planning 4626:4626 > /dev/null 2>&1 & \
	PF_PID=$$!; \
	sleep 3; \
	echo "1️⃣  Testing tools/list..."; \
	curl -s -X POST http://localhost:4626/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
		jq -r 'if .result.tools then "✅ Found \(.result.tools | length) tools" else "❌ Failed to list tools" end' || echo "❌ Request failed"; \
	echo ""; \
	echo "2️⃣  Testing create_goal tool..."; \
	curl -s -X POST http://localhost:4626/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_goal","arguments":{"description":"Test goal from K8s","userId":"test-user","sessionId":"test-session"}},"id":2}' | \
		jq -r 'if .result then "✅ Goal created successfully" else "❌ Failed to create goal: \(.error.message // "unknown error")" end' || echo "❌ Request failed"; \
	echo ""; \
	echo "3️⃣  Testing get_current_goal tool..."; \
	curl -s -X POST http://localhost:4626/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_current_goal","arguments":{"userId":"test-user","sessionId":"test-session"}},"id":3}' | \
		jq -r 'if .result.content[0].text then "✅ Retrieved goal: \(.result.content[0].text | fromjson.description)" else "❌ Failed to get goal" end' || echo "❌ Request failed"; \
	echo ""; \
	echo "4️⃣  Testing add_todo tool..."; \
	curl -s -X POST http://localhost:4626/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_todo","arguments":{"description":"Test todo item","userId":"test-user","sessionId":"test-session"}},"id":4}' | \
		jq -r 'if .result then "✅ Todo added successfully" else "❌ Failed to add todo" end' || echo "❌ Request failed"; \
	echo ""; \
	echo "5️⃣  Testing list_todos tool..."; \
	curl -s -X POST http://localhost:4626/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_todos","arguments":{"userId":"test-user","sessionId":"test-session"}},"id":5}' | \
		jq -r 'if .result.content[0].text then "✅ Listed todos successfully" else "❌ Failed to list todos" end' || echo "❌ Request failed"; \
	kill $$PF_PID 2>/dev/null || true; \
	echo ""; \
	echo "✅ Tool testing complete!"

# Test session management (Redis mode)
k8s-test-session:
	@echo "🔐 Testing session management..."
	@POD=$$(kubectl get pods -n devops -l app=mcp-software-planning -o jsonpath='{.items[0].metadata.name}'); \
	echo "📝 Checking Redis connection..."; \
	kubectl exec -n devops $$POD -- sh -c 'echo "PING" | nc -w 1 snapdragon.devops.svc.cluster.local 6379' | grep -q "PONG" && \
		echo "✅ Redis connection successful" || echo "❌ Redis connection failed"; \
	echo ""; \
	echo "🔍 Testing session isolation..."; \
	kubectl port-forward -n devops svc/mcp-software-planning 4627:4626 > /dev/null 2>&1 & \
	PF_PID=$$!; \
	sleep 3; \
	echo "Creating goal for user1..."; \
	curl -s -X POST http://localhost:4627/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_goal","arguments":{"description":"User1 private goal","userId":"user1","sessionId":"session1"}},"id":10}' | \
		jq -r '.result' > /dev/null; \
	echo "Creating goal for user2..."; \
	curl -s -X POST http://localhost:4627/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_goal","arguments":{"description":"User2 private goal","userId":"user2","sessionId":"session2"}},"id":11}' | \
		jq -r '.result' > /dev/null; \
	echo "Verifying user1 can't see user2's goal..."; \
	RESULT=$$(curl -s -X POST http://localhost:4627/mcp/stream \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_current_goal","arguments":{"userId":"user1","sessionId":"session2"}},"id":12}' | \
		jq -r '.result.content[0].text' | jq -r '.description' 2>/dev/null); \
	if [ "$$RESULT" = "null" ] || [ -z "$$RESULT" ]; then \
		echo "✅ Session isolation working - user1 cannot access user2's session"; \
	else \
		echo "❌ Session isolation FAILED - user1 accessed user2's data!"; \
	fi; \
	kill $$PF_PID 2>/dev/null || true; \
	echo ""; \
	echo "✅ Session testing complete!"

# Full K8s deployment test
k8s-test-full: k8s-test
	@echo ""
	@echo "📋 K8s Deployment Summary:"
	@echo "=========================="
	@kubectl get deploy,svc,pods -n devops -l app=mcp-software-planning
	@echo ""
	@echo "📊 Resource usage:"
	@kubectl top pod -n devops -l app=mcp-software-planning 2>/dev/null || echo "Metrics not available"
