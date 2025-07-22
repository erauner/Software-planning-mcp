#!/bin/bash
# Direct Redis access via K8s pod
# No local redis-cli required - uses Redis commands through kubectl exec

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${REDIS_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"
KEY_PREFIX="${KEY_PREFIX:-planning}"

# Get MCP pod name
get_pod() {
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# Execute Redis command via nc in pod
redis_exec() {
    local cmd="$1"
    local pod=$(get_pod)

    if [ -z "$pod" ]; then
        echo -e "${RED}No MCP pod found${NC}"
        return 1
    fi

    # Get Redis host from environment
    local redis_host=$(kubectl exec -n "$NAMESPACE" "$pod" -- sh -c 'echo ${REDIS_URL#redis://}' 2>/dev/null)

    # Execute Redis command using printf and nc
    kubectl exec -n "$NAMESPACE" "$pod" -- sh -c "printf '$cmd\r\n' | nc -w 1 $redis_host 2>/dev/null | tail -n +2" 2>/dev/null || echo ""
}

# List all MCP keys
list_keys() {
    echo -e "${CYAN}=== MCP Redis Keys ===${NC}"
    echo "Listing keys with prefix: $KEY_PREFIX"
    echo ""

    local keys=$(redis_exec "KEYS ${KEY_PREFIX}:*")
    if [ -z "$keys" ] || [[ "$keys" == *"(empty"* ]]; then
        echo "No keys found"
        return
    fi

    echo "$keys" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            echo -e "${BLUE}$key${NC}"
        fi
    done
}

# Get key value
get_value() {
    local key="$1"
    echo -e "${CYAN}=== Key: $key ===${NC}"

    local value=$(redis_exec "GET $key")
    if [ -n "$value" ]; then
        # Remove Redis protocol markers
        echo "$value" | grep -v '^\$' | grep -v '^*' | jq '.' 2>/dev/null || echo "$value"
    else
        echo "(empty or not found)"
    fi
}

# Show statistics
show_stats() {
    echo -e "${CYAN}=== Redis Statistics ===${NC}"

    # Count different key types
    local total=0
    local sessions=0
    local users=0

    local keys=$(redis_exec "KEYS ${KEY_PREFIX}:*")

    echo "$keys" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            ((total++)) || true

            if [[ "$key" == *"session:"* ]]; then
                ((sessions++)) || true
            elif [[ "$key" == *"user:"* ]]; then
                ((users++)) || true
            fi
        fi
    done

    echo "Key prefix: $KEY_PREFIX"
    echo "Total keys found: $total"
    echo ""

    # Test Redis connectivity
    local pong=$(redis_exec "PING")
    if [[ "$pong" == *"PONG"* ]]; then
        echo -e "Redis connection: ${GREEN}✅ OK${NC}"
    else
        echo -e "Redis connection: ${RED}❌ Failed${NC}"
    fi
}

# Quick data dump
dump_all() {
    echo -e "${CYAN}=== MCP Redis Data Dump ===${NC}"
    echo "Timestamp: $(date)"
    echo ""

    local keys=$(redis_exec "KEYS ${KEY_PREFIX}:*")

    echo "$keys" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]] && [[ ! "$key" =~ ^\*0 ]]; then
            echo -e "\n${YELLOW}Key: $key${NC}"
            get_value "$key"
        fi
    done
}

# Delete key
delete_key() {
    local key="$1"
    echo -e "${YELLOW}Deleting key: $key${NC}"

    local result=$(redis_exec "DEL $key")
    if [[ "$result" == *":1"* ]]; then
        echo -e "${GREEN}✅ Key deleted${NC}"
    else
        echo -e "${RED}❌ Failed to delete key${NC}"
    fi
}

# Clear all MCP data
clear_all() {
    echo -e "${RED}WARNING: This will delete ALL MCP data from Redis!${NC}"
    echo -n "Are you sure? (yes/no): "
    read -r confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted"
        return
    fi

    local keys=$(redis_exec "KEYS ${KEY_PREFIX}:*")
    local count=0

    echo "$keys" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            redis_exec "DEL $key" >/dev/null 2>&1
            ((count++)) || true
            echo "Deleted: $key"
        fi
    done

    echo -e "${GREEN}Cleared $count keys${NC}"
}

# Main menu
main() {
    case "${1:-help}" in
        list)
            list_keys
            ;;
        get)
            if [ -z "$2" ]; then
                echo "Usage: $0 get <key>"
                exit 1
            fi
            get_value "$2"
            ;;
        stats)
            show_stats
            ;;
        dump)
            dump_all
            ;;
        delete)
            if [ -z "$2" ]; then
                echo "Usage: $0 delete <key>"
                exit 1
            fi
            delete_key "$2"
            ;;
        clear)
            clear_all
            ;;
        *)
            echo -e "${BLUE}MCP Redis Direct Access${NC}"
            echo "======================="
            echo "Usage: $0 <command> [args]"
            echo ""
            echo "Commands:"
            echo "  list           - List all MCP keys"
            echo "  get <key>      - Get value of specific key"
            echo "  stats          - Show Redis statistics"
            echo "  dump           - Dump all MCP data"
            echo "  delete <key>   - Delete specific key"
            echo "  clear          - Clear ALL MCP data (dangerous!)"
            echo ""
            echo "Environment variables:"
            echo "  REDIS_NAMESPACE - K8s namespace (default: devops)"
            echo "  KEY_PREFIX      - Redis key prefix (default: planning)"
            ;;
    esac
}

main "$@"
