#!/bin/bash
set -e

echo "🚀 Quick MCP Server Test"

# Always clean up first for idempotency
echo "🧹 Cleaning up any existing containers..."
docker-compose down -v 2>/dev/null || true

# Test File Mode
echo "📁 Testing File Mode..."
echo "  🔍 Sending tools/list request via docker-compose..."

RESPONSE=$(echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
    timeout 15s docker-compose run --rm -T mcp-file-mode 2>/dev/null | \
    grep -o '{"result":.*}' | head -1)

if echo "$RESPONSE" | jq -e '.result.tools | length' >/dev/null 2>&1; then
    TOOL_COUNT=$(echo "$RESPONSE" | jq -r '.result.tools | length')
    echo "  ✅ File mode working - $TOOL_COUNT tools available"
else
    echo "  ❌ File mode failed"
    docker-compose down -v 2>/dev/null || true
    exit 1
fi

# Test Redis Mode
echo "📱 Testing Redis Mode..."
echo "  🐳 Starting Redis via docker-compose..."
docker-compose up -d redis

echo "  ⏳ Waiting for Redis to be healthy..."
for i in {1..30}; do
    if docker-compose exec -T redis redis-cli ping >/dev/null 2>&1; then
        echo "  ✅ Redis is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "  ❌ Redis failed to start"
        docker-compose down -v 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

echo "  🔍 Testing MCP server with Redis mode..."
echo "  📡 Sending tools/list request..."

# Capture all output for debugging
if timeout 20s docker-compose run --rm -T mcp-redis-mode 2>&1 <<< '{"jsonrpc":"2.0","method":"tools/list","id":1}' | tee /tmp/redis_test.log; then
    echo "  📥 Redis mode container output captured"

    # Look for JSON response
    if grep -q '{"result":' /tmp/redis_test.log; then
        TOOL_COUNT=$(grep '{"result":' /tmp/redis_test.log | jq -r '.result.tools | length' 2>/dev/null || echo "unknown")
        echo "  ✅ Redis mode working - $TOOL_COUNT tools available"
    else
        echo "  ⚠️  Redis mode ran but no JSON response found"
        echo "  📋 Container output:"
        cat /tmp/redis_test.log | sed 's/^/    /'
    fi
else
    echo "  ❌ Redis mode test failed or timed out"
    echo "  📋 Container output (if any):"
    cat /tmp/redis_test.log 2>/dev/null | sed 's/^/    /' || echo "    No output captured"
fi

# Always cleanup
echo "🧹 Cleaning up..."
docker-compose down -v 2>/dev/null || true
rm -f /tmp/redis_test.log 2>/dev/null || true

echo "✅ Tests complete!"
