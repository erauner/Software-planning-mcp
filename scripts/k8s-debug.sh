#!/bin/bash
# Debug script for K8s MCP deployment
# Provides detailed debugging information

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${K8S_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"

# Helper functions
section() {
    echo ""
    echo -e "${CYAN}=== $1 ===${NC}"
}

get_pod_name() {
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# Debug functions
debug_deployment() {
    section "Deployment Status"
    kubectl get deployment -n "$NAMESPACE" -l "$APP_LABEL" -o wide

    section "Deployment Details"
    kubectl describe deployment -n "$NAMESPACE" -l "$APP_LABEL" | grep -A10 "Containers:" || true
}

debug_pods() {
    section "Pod Status"
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o wide

    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        section "Pod Events"
        kubectl describe pod -n "$NAMESPACE" "$POD" | grep -A20 "Events:" || true
    fi
}

debug_service() {
    section "Service Status"
    kubectl get svc -n "$NAMESPACE" -l "$APP_LABEL" -o wide

    section "Service Endpoints"
    kubectl get endpoints -n "$NAMESPACE" -l "$APP_LABEL"
}

debug_httproute() {
    section "HTTPRoute Configuration"
    kubectl get httproute -n "$NAMESPACE" | grep -i planning || echo "No HTTPRoute found"

    # Get HTTPRoute details if exists
    local route=$(kubectl get httproute -n "$NAMESPACE" -o name | grep -i planning | head -1)
    if [ -n "$route" ]; then
        kubectl get "$route" -n "$NAMESPACE" -o yaml | grep -E "(hostnames|parentRefs|backendRefs|port)" || true
    fi
}

debug_logs() {
    section "Recent Logs"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        kubectl logs -n "$NAMESPACE" "$POD" --tail=50
    else
        echo "No pod found"
    fi
}

debug_processes() {
    section "Running Processes"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        kubectl exec -n "$NAMESPACE" "$POD" -- ps aux || echo "ps command not available"
    fi
}

debug_environment() {
    section "Environment Variables"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -E "(REDIS|STORAGE|NODE|MCP)" | sort || true
    fi
}

debug_network() {
    section "Network Connectivity Tests"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        echo "Testing localhost:4626..."
        kubectl exec -n "$NAMESPACE" "$POD" -- wget -qO- http://localhost:4626/health 2>&1 || echo "Failed"

        echo ""
        echo "Testing Redis connectivity..."
        kubectl exec -n "$NAMESPACE" "$POD" -- sh -c 'echo "PING" | nc -w 1 ${REDIS_URL#redis://} 2>/dev/null || echo "nc not available or connection failed"'
    fi
}

debug_supergateway() {
    section "Supergateway Status"
    POD=$(get_pod_name)
    if [ -n "$POD" ]; then
        # Check if supergateway is running
        local sg_pid=$(kubectl exec -n "$NAMESPACE" "$POD" -- pgrep -f supergateway 2>/dev/null || echo "")
        if [ -n "$sg_pid" ]; then
            echo "Supergateway PID: $sg_pid"

            # Check listening ports
            echo ""
            echo "Listening ports:"
            kubectl exec -n "$NAMESPACE" "$POD" -- netstat -tlnp 2>/dev/null | grep -E "(4626|LISTEN)" || \
                kubectl exec -n "$NAMESPACE" "$POD" -- ss -tlnp 2>/dev/null | grep -E "(4626|LISTEN)" || \
                echo "netstat/ss not available"
        else
            echo "Supergateway not running"
        fi
    fi
}

# Main execution
main() {
    echo -e "${BLUE}🔍 MCP Software Planning K8s Debug Report${NC}"
    echo "=========================================="
    echo "Timestamp: $(date)"
    echo "Namespace: $NAMESPACE"
    echo "App Label: $APP_LABEL"

    debug_deployment
    debug_pods
    debug_service
    debug_httproute
    debug_processes
    debug_environment
    debug_network
    debug_supergateway
    debug_logs

    section "Debug Complete"
    echo "Use 'kubectl logs -f -n $NAMESPACE -l $APP_LABEL' to follow logs"
    echo "Use 'kubectl exec -it -n $NAMESPACE <pod-name> -- sh' for shell access"
}

# Run main function
main "$@"
