#!/bin/bash
set -e

echo "🚀 Starting Software Planning MCP Docker Tests"

# Build the image
echo "📦 Building Docker image..."
docker build -t software-planning-mcp:latest .

# Create test data directory
mkdir -p test-data

# Test file mode
echo "📁 Testing File Mode..."
docker run --rm \
  -e STORAGE_MODE=file \
  -v $(pwd)/test-data:/app/data \
  software-planning-mcp:latest \
  sh -c "echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}' | node /app/build/index.js"

# Start Dragonfly for Redis tests
echo "🐉 Starting Dragonfly..."
docker run -d --name test-dragonfly -p 6379:6379 ghcr.io/dragonflydb/dragonfly

# Wait for Dragonfly to be ready
echo "⏳ Waiting for Dragonfly to start..."
sleep 5

# Test Redis mode
echo "📱 Testing Redis Mode..."
docker run --rm \
  -e STORAGE_MODE=redis \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  --add-host=host.docker.internal:host-gateway \
  software-planning-mcp:latest \
  sh -c "echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}' | node /app/build/index.js"

# Test session functionality with Redis
echo "📊 Testing Redis Session Functionality..."
docker run --rm \
  -e STORAGE_MODE=redis \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  --add-host=host.docker.internal:host-gateway \
  software-planning-mcp:latest \
  sh -c "echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"start_planning\",\"arguments\":{\"goal\":\"Test Redis planning\",\"userId\":\"test-user\",\"repository\":\"github.com/test/repo\",\"branch\":\"main\"}},\"id\":2}' | node /app/build/index.js"

# Cleanup
echo "🧹 Cleaning up..."
docker stop test-dragonfly && docker rm test-dragonfly

echo "✅ All tests passed!"
