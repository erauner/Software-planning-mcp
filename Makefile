.PHONY: build test clean

# Build the Docker image
build:
	docker build -t software-planning-mcp:latest .

# Run tests in file mode
test-file:
	docker-compose run --rm -e STORAGE_MODE=file test-runner pnpm test:file-mode

# Run tests in Redis mode
test-redis:
	docker-compose run --rm -e STORAGE_MODE=redis test-runner pnpm test:redis-mode

# Run all tests
test-all:
	docker-compose run --rm test-runner

# Interactive testing with file mode
run-file:
	docker-compose run --rm mcp-file-mode

# Interactive testing with Redis mode
run-redis:
	docker-compose run --rm mcp-redis-mode

# Start all services
up:
	docker-compose up -d

# Stop all services
down:
	docker-compose down

# Clean up everything
clean:
	docker-compose down -v
	docker rmi software-planning-mcp:latest || true

# Run MCP inspector with file mode
inspector-file:
	docker-compose run --rm -p 3000:3000 mcp-file-mode npx @modelcontextprotocol/inspector /app/build/index.js

# Run MCP inspector with Redis mode
inspector-redis:
	docker-compose run --rm -p 3000:3000 mcp-redis-mode npx @modelcontextprotocol/inspector /app/build/index.js

# Quick functional test
test-quick:
	@echo "🚀 Quick functional test of both modes..."
	@echo "📁 Testing File Mode..."
	@docker-compose run --rm mcp-file-mode sh -c "echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}' | node /app/build/index.js | tail -1"
	@echo "📱 Testing Redis Mode..."
	@docker-compose run --rm mcp-redis-mode sh -c "echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}' | node /app/build/index.js | tail -1"
