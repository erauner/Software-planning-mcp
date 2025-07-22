#!/bin/bash
# Quick test script for K8s MCP deployment
# Performs basic smoke tests without complex session testing

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${K8S_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"

echo "🚀 Quick K8s MCP Test"
echo "===================="

# Get pod name
POD=$(kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -z "$POD" ]; then
    echo -e "${RED}❌ No pod found${NC}"
    exit 1
fi

echo "Pod: $POD"
echo ""

# Test 1: Health check
echo -n "1. Health check: "
if kubectl exec -n "$NAMESPACE" "$POD" -- wget -qO- http://localhost:4626/health 2>/dev/null | grep -q "ok"; then
    echo -e "${GREEN}✅ PASS${NC}"
else
    echo -e "${RED}❌ FAIL${NC}"
fi

# Test 2: Supergateway running
echo -n "2. Supergateway: "
if kubectl exec -n "$NAMESPACE" "$POD" -- pgrep -f supergateway >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
fi

# Test 3: Redis connectivity
echo -n "3. Redis connection: "
REDIS_HOST=$(kubectl exec -n "$NAMESPACE" "$POD" -- sh -c 'echo ${REDIS_URL#redis://}' 2>/dev/null)
if [ -n "$REDIS_HOST" ]; then
    echo -e "${GREEN}✅ Configured${NC} ($REDIS_HOST)"
else
    echo -e "${RED}❌ Not configured${NC}"
fi

# Test 4: MCP server basic test
echo -n "4. MCP server: "
RESPONSE=$(kubectl exec -n "$NAMESPACE" "$POD" -- sh -c 'echo '\''{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"quick-test","version":"1.0"}},"id":1}'\'' | timeout 5 node /app/build/index.js 2>&1' || echo "FAILED")

if echo "$RESPONSE" | grep -q '"name":"software-planning-tool"'; then
    echo -e "${GREEN}✅ Responding${NC}"
elif echo "$RESPONSE" | grep -q "Redis connection established"; then
    echo -e "${GREEN}✅ Running (with Redis)${NC}"
else
    echo -e "${RED}❌ Failed${NC}"
    echo "Response: $RESPONSE"
fi

# Test 5: External access
echo -n "5. External access: "
if curl -s --max-time 3 https://planning-lab.erauner.dev/health 2>/dev/null | grep -q "ok"; then
    echo -e "${GREEN}✅ Available${NC}"
else
    echo -e "${RED}⚠️  Not reachable${NC} (may be network issue)"
fi

echo ""
echo "Quick test complete!"
