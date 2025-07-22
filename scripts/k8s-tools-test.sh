#!/bin/bash
# Test MCP tools functionality in K8s deployment
# This script tests each MCP tool by calling it directly via stdio

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${K8S_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"
TEST_USER="${TEST_USER:-k8s-test-user}"
TEST_SESSION="${TEST_SESSION:-k8s-test-session}"

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

get_pod_name() {
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# Execute MCP request via stdio
exec_mcp_request() {
    local request="$1"
    local pod=$(get_pod_name)

    if [ -z "$pod" ]; then
        log_error "No pod found"
        return 1
    fi

    # Use timeout with TERM signal and shorter timeout
    kubectl exec -n "$NAMESPACE" "$pod" -- sh -c "echo '$request' | timeout -s TERM 5 node /app/build/index.js 2>&1" 2>/dev/null || echo '{"error": "timeout"}'
}

# Test functions for each tool
test_initialize() {
    log_test "Testing initialize..."

    local request='{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"k8s-test","version":"1.0"}},"id":1}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q '"name":"software-planning-tool"'; then
        log_info "✅ Initialize successful"
        return 0
    else
        log_error "❌ Initialize failed"
        echo "$response"
        return 1
    fi
}

test_tools_list() {
    log_test "Testing tools/list..."

    local request='{"jsonrpc":"2.0","method":"tools/list","id":2}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q '"tools"'; then
        local tool_count=$(echo "$response" | grep -o '"name"' | wc -l)
        log_info "✅ Found $tool_count tools"

        # List tool names
        echo "$response" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//' | while read -r tool; do
            echo "   - $tool"
        done
        return 0
    else
        log_error "❌ Tools list failed"
        echo "$response"
        return 1
    fi
}

test_start_planning() {
    log_test "Testing start_planning..."

    local request='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"start_planning","arguments":{"task":"Test planning from K8s","userId":"'$TEST_USER'","sessionId":"'$TEST_SESSION'"}},"id":3}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q '"result"'; then
        log_info "✅ Planning started successfully"
        return 0
    else
        log_error "❌ Start planning failed"
        echo "$response"
        return 1
    fi
}

test_save_plan() {
    log_test "Testing save_plan..."

    local request='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"save_plan","arguments":{"plan":"Test plan content","userId":"'$TEST_USER'","sessionId":"'$TEST_SESSION'"}},"id":4}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q '"result"'; then
        log_info "✅ Plan saved successfully"
        return 0
    else
        log_error "❌ Save plan failed"
        echo "$response"
        return 1
    fi
}

test_add_todo() {
    log_test "Testing add_todo..."

    local request='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_todo","arguments":{"description":"Test todo item","userId":"'$TEST_USER'","sessionId":"'$TEST_SESSION'"}},"id":5}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q '"result"'; then
        log_info "✅ Todo added successfully"
        return 0
    else
        log_error "❌ Add todo failed"
        echo "$response"
        return 1
    fi
}

test_get_todos() {
    log_test "Testing get_todos..."

    local request='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_todos","arguments":{"userId":"'$TEST_USER'","sessionId":"'$TEST_SESSION'"}},"id":6}'
    local response=$(exec_mcp_request "$request")

    if echo "$response" | grep -q 'Test todo item'; then
        log_info "✅ Listed todos successfully"
        return 0
    else
        log_error "❌ Get todos failed"
        echo "$response"
        return 1
    fi
}

test_session_isolation() {
    log_test "Testing session isolation..."

    # Start planning for user1
    local request1='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"start_planning","arguments":{"task":"User1 private task","userId":"user1","sessionId":"session1"}},"id":10}'
    exec_mcp_request "$request1" >/dev/null 2>&1

    # Start planning for user2
    local request2='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"start_planning","arguments":{"task":"User2 private task","userId":"user2","sessionId":"session2"}},"id":11}'
    exec_mcp_request "$request2" >/dev/null 2>&1

    # Add todos for each user
    local request3='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_todo","arguments":{"description":"User1 todo","userId":"user1","sessionId":"session1"}},"id":12}'
    exec_mcp_request "$request3" >/dev/null 2>&1

    local request4='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_todo","arguments":{"description":"User2 todo","userId":"user2","sessionId":"session2"}},"id":13}'
    exec_mcp_request "$request4" >/dev/null 2>&1

    # Try to access user2's todos with user1
    local request5='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_todos","arguments":{"userId":"user1","sessionId":"session2"}},"id":14}'
    local response=$(exec_mcp_request "$request5")

    if echo "$response" | grep -q "User2 todo"; then
        log_error "❌ Session isolation FAILED - user1 accessed user2's data!"
        return 1
    else
        log_info "✅ Session isolation working correctly"
        return 0
    fi
}

cleanup_test_data() {
    log_test "Cleaning up test data..."

    # Note: There's no explicit clear method in the new API
    # Data will be cleaned up by Redis TTL

    log_info "✅ Test data will be cleaned up by Redis TTL"
}

# Main execution
main() {
    echo "🛠️  MCP Tools Test Suite for K8s"
    echo "================================"
    echo "Namespace: $NAMESPACE"
    echo "Test User: $TEST_USER"
    echo "Test Session: $TEST_SESSION"
    echo ""

    # Check if pod exists
    POD=$(get_pod_name)
    if [ -z "$POD" ]; then
        log_error "No pod found with label $APP_LABEL in namespace $NAMESPACE"
        exit 1
    fi

    log_info "Testing pod: $POD"
    echo ""

    # Run tests
    test_initialize || exit 1
    echo ""

    test_tools_list || exit 1
    echo ""

    test_start_planning || exit 1
    echo ""

    test_save_plan || exit 1
    echo ""

    test_add_todo || exit 1
    echo ""

    test_get_todos || exit 1
    echo ""

    test_session_isolation || exit 1
    echo ""

    cleanup_test_data
    echo ""

    log_info "🎉 All tool tests passed!"
}

# Run main function
main "$@"
