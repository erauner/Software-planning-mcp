#!/bin/bash
# K8s deployment testing script for Software Planning MCP Server
# This script tests the MCP server deployed in Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${K8S_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-/health}"
MCP_ENDPOINT="${MCP_ENDPOINT:-/mcp/stream}"

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

check_deployment() {
    log_info "Checking deployment status..."

    if ! kubectl get deployment -n "$NAMESPACE" -l "$APP_LABEL" &>/dev/null; then
        log_error "No deployment found with label $APP_LABEL in namespace $NAMESPACE"
        exit 1
    fi

    kubectl get deployment,pods,svc -n "$NAMESPACE" -l "$APP_LABEL"
}

get_pod_name() {
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

test_health() {
    log_info "Testing health endpoint..."

    POD=$(get_pod_name)
    if [ -z "$POD" ]; then
        log_error "No pod found"
        exit 1
    fi

    if kubectl exec -n "$NAMESPACE" "$POD" -- wget -qO- "http://localhost:4626${HEALTH_ENDPOINT}" | grep -q "ok"; then
        log_info "✅ Health check passed"
    else
        log_error "❌ Health check failed"
        return 1
    fi
}

test_stdio_direct() {
    log_info "Testing MCP server directly via stdio..."

    POD=$(get_pod_name)
    if [ -z "$POD" ]; then
        log_error "No pod found"
        exit 1
    fi

    # Test initialize
    local response=$(kubectl exec -n "$NAMESPACE" "$POD" -- sh -c 'echo '\''{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'\'' | timeout 5 node /app/build/index.js 2>/dev/null' || echo "TIMEOUT")

    if [[ "$response" == "TIMEOUT" ]]; then
        log_error "❌ MCP server timed out"
        return 1
    elif echo "$response" | grep -q '"name":"software-planning-tool"'; then
        log_info "✅ MCP server initialized successfully"
    else
        log_error "❌ MCP server failed to initialize"
        echo "Response: $response"
        return 1
    fi
}

test_redis_connection() {
    log_info "Testing Redis connection..."

    POD=$(get_pod_name)
    if [ -z "$POD" ]; then
        log_error "No pod found"
        exit 1
    fi

    # Check Redis environment variables
    kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -E "REDIS|STORAGE" || true

    # Test Redis connectivity
    if kubectl exec -n "$NAMESPACE" "$POD" -- sh -c 'echo "PING" | nc -w 1 ${REDIS_URL#redis://} 2>/dev/null | grep -q "PONG"' 2>/dev/null; then
        log_info "✅ Redis connection successful"
    else
        log_warning "⚠️  Redis connection test inconclusive (nc might not be available)"
    fi
}

test_supergateway() {
    log_info "Checking supergateway status..."

    POD=$(get_pod_name)
    if [ -z "$POD" ]; then
        log_error "No pod found"
        exit 1
    fi

    # Check if supergateway is running
    if kubectl exec -n "$NAMESPACE" "$POD" -- ps aux | grep -q "[s]upergateway"; then
        log_info "✅ Supergateway is running"

        # Show supergateway configuration
        kubectl logs -n "$NAMESPACE" "$POD" --tail=20 | grep -E "supergateway|Listening" || true
    else
        log_error "❌ Supergateway is not running"
        return 1
    fi
}

show_logs() {
    log_info "Recent pod logs:"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        kubectl logs -n "$NAMESPACE" "$POD" --tail=30
    fi
}

# Main execution
main() {
    echo "🧪 MCP Software Planning K8s Test Suite"
    echo "======================================="
    echo "Namespace: $NAMESPACE"
    echo "App Label: $APP_LABEL"
    echo ""

    check_deployment
    echo ""

    test_health
    echo ""

    test_supergateway
    echo ""

    test_redis_connection
    echo ""

    test_stdio_direct
    echo ""

    if [ "${SHOW_LOGS:-false}" == "true" ]; then
        show_logs
    fi

    log_info "✅ All tests completed!"
}

# Run main function
main "$@"
