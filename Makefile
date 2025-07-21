.PHONY: build test clean

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
