#!/bin/bash
# Redis Inspector for K8s MCP deployment
# Provides direct access to Redis data for debugging and management

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
REDIS_SERVICE="${REDIS_SERVICE:-snapdragon}"
REDIS_PORT="${REDIS_PORT:-6379}"
KEY_PREFIX="${KEY_PREFIX:-planning}"

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

section() {
    echo ""
    echo -e "${CYAN}=== $1 ===${NC}"
}

# Execute Redis command via port-forward
redis_cmd() {
    local cmd="$1"
    # Start port-forward in background
    kubectl port-forward -n "$NAMESPACE" "svc/$REDIS_SERVICE" 6380:$REDIS_PORT >/dev/null 2>&1 &
    local pf_pid=$!

    # Wait for port-forward to be ready
    sleep 2

    # Execute Redis command
    echo "$cmd" | redis-cli -p 6380 2>/dev/null || echo "Command failed"

    # Kill port-forward
    kill $pf_pid 2>/dev/null || true
    wait $pf_pid 2>/dev/null || true
}

# Execute Redis command and return raw output
redis_cmd_raw() {
    local cmd="$1"
    kubectl port-forward -n "$NAMESPACE" "svc/$REDIS_SERVICE" 6380:$REDIS_PORT >/dev/null 2>&1 &
    local pf_pid=$!
    sleep 2
    local result=$(echo "$cmd" | redis-cli -p 6380 --raw 2>/dev/null || echo "")
    kill $pf_pid 2>/dev/null || true
    wait $pf_pid 2>/dev/null || true
    echo "$result"
}

# List all MCP-related keys
list_keys() {
    section "MCP Redis Keys"
    log_info "Listing all keys with prefix: $KEY_PREFIX"

    local keys=$(redis_cmd_raw "KEYS ${KEY_PREFIX}:*")
    if [ -z "$keys" ]; then
        echo "No keys found"
        return
    fi

    echo "$keys" | while read -r key; do
        if [ -n "$key" ]; then
            local ttl=$(redis_cmd_raw "TTL \"$key\"")
            local type=$(redis_cmd_raw "TYPE \"$key\"")
            echo -e "${BLUE}$key${NC} (type: $type, TTL: $ttl seconds)"
        fi
    done
}

# Show session data
show_sessions() {
    section "Active Sessions"

    local session_keys=$(redis_cmd_raw "KEYS ${KEY_PREFIX}:session:*")
    if [ -z "$session_keys" ]; then
        echo "No active sessions found"
        return
    fi

    echo "$session_keys" | while read -r key; do
        if [ -n "$key" ]; then
            echo -e "\n${YELLOW}Session: $key${NC}"
            local data=$(redis_cmd_raw "GET \"$key\"")
            if [ -n "$data" ]; then
                echo "$data" | jq '.' 2>/dev/null || echo "$data"
            fi
        fi
    done
}

# Show user repository data
show_user_data() {
    section "User Repository Data"

    local user_keys=$(redis_cmd_raw "KEYS ${KEY_PREFIX}:user:*:repo:*")
    if [ -z "$user_keys" ]; then
        echo "No user repository data found"
        return
    fi

    echo "$user_keys" | while read -r key; do
        if [ -n "$key" ]; then
            echo -e "\n${YELLOW}User Data: $key${NC}"
            local data=$(redis_cmd_raw "GET \"$key\"")
            if [ -n "$data" ]; then
                echo "$data" | jq '.' 2>/dev/null || echo "$data"
            fi
        fi
    done
}

# Get specific key value
get_key() {
    local key="$1"
    section "Key Value: $key"

    local type=$(redis_cmd_raw "TYPE \"$key\"")
    echo "Type: $type"

    case "$type" in
        string)
            local value=$(redis_cmd_raw "GET \"$key\"")
            echo "$value" | jq '.' 2>/dev/null || echo "$value"
            ;;
        hash)
            redis_cmd "HGETALL \"$key\""
            ;;
        list)
            redis_cmd "LRANGE \"$key\" 0 -1"
            ;;
        set)
            redis_cmd "SMEMBERS \"$key\""
            ;;
        zset)
            redis_cmd "ZRANGE \"$key\" 0 -1 WITHSCORES"
            ;;
        *)
            echo "Unknown type: $type"
            ;;
    esac
}

# Delete specific key
delete_key() {
    local key="$1"
    echo -e "${YELLOW}Deleting key: $key${NC}"

    redis_cmd "DEL \"$key\""
    echo "Key deleted"
}

# Clear all MCP data (dangerous!)
clear_all_data() {
    echo -e "${RED}WARNING: This will delete ALL MCP data from Redis!${NC}"
    echo -n "Are you sure? (yes/no): "
    read -r confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted"
        return
    fi

    local keys=$(redis_cmd_raw "KEYS ${KEY_PREFIX}:*")
    if [ -z "$keys" ]; then
        echo "No keys to delete"
        return
    fi

    echo "$keys" | while read -r key; do
        if [ -n "$key" ]; then
            redis_cmd "DEL \"$key\"" >/dev/null
            echo "Deleted: $key"
        fi
    done

    echo -e "${GREEN}All MCP data cleared${NC}"
}

# Interactive Redis CLI
interactive_redis() {
    section "Interactive Redis CLI"
    echo "Starting Redis CLI (use 'exit' to quit)..."
    echo "Prefix your keys with: $KEY_PREFIX:"
    echo ""

    kubectl port-forward -n "$NAMESPACE" "svc/$REDIS_SERVICE" 6380:$REDIS_PORT
}

# Show statistics
show_stats() {
    section "Redis Statistics"

    local total_keys=$(redis_cmd_raw "EVAL \"return #redis.call('keys', '${KEY_PREFIX}:*')\" 0")
    echo "Total MCP keys: $total_keys"

    local sessions=$(redis_cmd_raw "EVAL \"return #redis.call('keys', '${KEY_PREFIX}:session:*')\" 0")
    echo "Active sessions: $sessions"

    local users=$(redis_cmd_raw "EVAL \"return #redis.call('keys', '${KEY_PREFIX}:user:*')\" 0")
    echo "User data entries: $users"

    echo ""
    echo "Memory usage:"
    redis_cmd "INFO memory" | grep -E "(used_memory_human|used_memory_peak_human)" || true
}

# Export data to JSON
export_data() {
    local output_file="${1:-mcp-redis-export.json}"
    section "Exporting Data"

    echo "{" > "$output_file"
    echo '  "exported_at": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",' >> "$output_file"
    echo '  "data": {' >> "$output_file"

    local first=true
    local keys=$(redis_cmd_raw "KEYS ${KEY_PREFIX}:*")

    echo "$keys" | while read -r key; do
        if [ -n "$key" ]; then
            if [ "$first" = false ]; then
                echo "," >> "$output_file"
            fi
            first=false

            printf '    "%s": ' "$key" >> "$output_file"
            local value=$(redis_cmd_raw "GET \"$key\"")
            if [ -n "$value" ]; then
                echo "$value" | jq -c '.' >> "$output_file" 2>/dev/null || printf '"%s"' "$value" >> "$output_file"
            else
                echo "null" >> "$output_file"
            fi
        fi
    done

    echo "" >> "$output_file"
    echo "  }" >> "$output_file"
    echo "}" >> "$output_file"

    echo -e "${GREEN}Data exported to: $output_file${NC}"
}

# Main menu
show_menu() {
    echo -e "${BLUE}MCP Redis Inspector${NC}"
    echo "==================="
    echo "1. List all keys"
    echo "2. Show sessions"
    echo "3. Show user data"
    echo "4. Get specific key"
    echo "5. Delete specific key"
    echo "6. Show statistics"
    echo "7. Export all data"
    echo "8. Interactive Redis CLI"
    echo "9. Clear ALL data (dangerous!)"
    echo "0. Exit"
    echo ""
    echo -n "Select option: "
}

# Main execution
main() {
    # Check if Redis service exists
    if ! kubectl get svc -n "$NAMESPACE" "$REDIS_SERVICE" &>/dev/null; then
        log_error "Redis service '$REDIS_SERVICE' not found in namespace '$NAMESPACE'"
        exit 1
    fi

    # Check if redis-cli is installed
    if ! command -v redis-cli &>/dev/null; then
        log_error "redis-cli not found. Please install Redis client tools."
        echo "On macOS: brew install redis"
        echo "On Ubuntu: sudo apt-get install redis-tools"
        exit 1
    fi

    # Handle command line arguments
    case "${1:-menu}" in
        list) list_keys ;;
        sessions) show_sessions ;;
        users) show_user_data ;;
        stats) show_stats ;;
        export) export_data "${2:-mcp-redis-export.json}" ;;
        get)
            if [ -z "$2" ]; then
                echo "Usage: $0 get <key>"
                exit 1
            fi
            get_key "$2"
            ;;
        delete)
            if [ -z "$2" ]; then
                echo "Usage: $0 delete <key>"
                exit 1
            fi
            delete_key "$2"
            ;;
        clear) clear_all_data ;;
        cli) interactive_redis ;;
        menu|*)
            while true; do
                show_menu
                read -r choice

                case $choice in
                    1) list_keys ;;
                    2) show_sessions ;;
                    3) show_user_data ;;
                    4)
                        echo -n "Enter key: "
                        read -r key
                        get_key "$key"
                        ;;
                    5)
                        echo -n "Enter key to delete: "
                        read -r key
                        delete_key "$key"
                        ;;
                    6) show_stats ;;
                    7)
                        echo -n "Export filename (default: mcp-redis-export.json): "
                        read -r filename
                        export_data "${filename:-mcp-redis-export.json}"
                        ;;
                    8) interactive_redis ;;
                    9) clear_all_data ;;
                    0) exit 0 ;;
                    *) echo "Invalid option" ;;
                esac

                echo ""
                echo "Press Enter to continue..."
                read -r
            done
            ;;
    esac
}

# Run main function
main "$@"
