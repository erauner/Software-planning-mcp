#!/bin/bash
set -e

echo "🚀 Starting Software Planning MCP Docker Tests (docker-compose)"

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
docker-compose down -v 2>/dev/null || true

# Build the services
echo "📦 Building Docker services..."
docker-compose build

# Start Redis
echo "🔴 Starting Redis..."
docker-compose up -d redis

# Wait for Redis to be healthy
echo "⏳ Waiting for Redis to be ready..."
docker-compose run --rm mcp-redis-mode sh -c 'until redis-cli -h redis ping; do sleep 1; done' >/dev/null 2>&1

# Test File Mode
echo -e "\n📁 Testing File Mode..."
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
  docker-compose run --rm -T mcp-file-mode | \
  jq -r 'if .result.tools then "✅ File mode: \(.result.tools | length) tools available" else "❌ File mode failed" end'

# Test Redis Mode
echo -e "\n📱 Testing Redis Mode..."
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
  docker-compose run --rm -T mcp-redis-mode | \
  jq -r 'if .result.tools then "✅ Redis mode: \(.result.tools | length) tools available" else "❌ Redis mode failed" end'

# Test Redis Session Creation
echo -e "\n🔐 Testing Redis Session Creation..."
SESSION_RESULT=$(echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"start_planning","arguments":{"goal":"Test Redis planning","userId":"test-user","repository":"github.com/test/repo","branch":"main"}},"id":2}' | \
  docker-compose run --rm -T mcp-redis-mode 2>&1)

if echo "$SESSION_RESULT" | grep -q "Session ID:"; then
  echo "✅ Redis session creation successful"
else
  echo "❌ Redis session creation failed"
fi

# Clean up
echo -e "\n🧹 Cleaning up..."
docker-compose down -v

echo -e "\n✅ All tests completed!"
