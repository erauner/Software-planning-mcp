#!/bin/bash
# Redis Data Viewer for MCP Software Planning
# User-friendly display of Redis data

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
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

    local redis_host=$(kubectl exec -n "$NAMESPACE" "$pod" -- sh -c 'echo ${REDIS_URL#redis://}' 2>/dev/null)
    kubectl exec -n "$NAMESPACE" "$pod" -- sh -c "printf '$cmd\r\n' | nc -w 1 $redis_host 2>/dev/null | tail -n +2" 2>/dev/null || echo ""
}

# Get and parse JSON value
get_json_value() {
    local key="$1"
    local value=$(redis_exec "GET $key")

    if [ -n "$value" ]; then
        # Remove Redis protocol markers and parse JSON
        echo "$value" | grep -v '^\$' | grep -v '^*' | grep -v '^+OK'
    fi
}

# Display session summary
show_sessions_summary() {
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║         Active Sessions Summary          ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    local sessions=$(redis_exec "KEYS ${KEY_PREFIX}:session:*")
    local count=0

    echo "$sessions" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            ((count++)) || true

            local data=$(get_json_value "$key")
            if [ -n "$data" ]; then
                local userId=$(echo "$data" | jq -r '.userId // "unknown"')
                local sessionId=$(echo "$data" | jq -r '.sessionId // "unknown"')
                local repo=$(echo "$data" | jq -r '.repository.repoIdentifier // "none"')
                local branch=$(echo "$data" | jq -r '.repository.branch // "none"')
                local created=$(echo "$data" | jq -r '.createdAt // "unknown"')

                echo -e "${YELLOW}Session #$count${NC}"
                echo -e "  User:      ${GREEN}$userId${NC}"
                echo -e "  Session:   $sessionId"
                echo -e "  Repo:      $repo / $branch"
                echo -e "  Created:   $created"
                echo ""
            fi
        fi
    done
}

# Display user todos
show_user_todos() {
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║            User Todos by Repo            ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    local user_keys=$(redis_exec "KEYS ${KEY_PREFIX}:user:*:repo:*")

    echo "$user_keys" | grep -v '^\$' | grep -v '^*' | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            # Extract user from key
            local user=$(echo "$key" | sed -n 's/.*:user:\([^:]*\):repo:.*/\1/p')
            local repo=$(echo "$key" | sed -n 's/.*:repo:\([^:]*\):branch:.*/\1/p')
            local branch=$(echo "$key" | sed -n 's/.*:branch:\(.*\)/\1/p')

            local data=$(get_json_value "$key")
            if [ -n "$data" ]; then
                echo -e "${YELLOW}User: $user${NC} | Repo: ${BLUE}$repo/$branch${NC}"
                echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

                # Extract goals
                local goals=$(echo "$data" | jq -r '.goals | to_entries[] | .key' 2>/dev/null)
                if [ -n "$goals" ]; then
                    echo "$goals" | while read -r goalId; do
                        if [ -n "$goalId" ]; then
                            echo -e "  ${GREEN}Goal: $goalId${NC}"

                            # Get todos for this goal
                            local todos=$(echo "$data" | jq -r ".plans[\"$goalId\"].todos[]" 2>/dev/null)
                            if [ -n "$todos" ]; then
                                echo "$todos" | jq -r '. | "    \(if .isComplete then "✓" else "○" end) \(.description // .title) (ID: \(.id[0:8]))"' 2>/dev/null || echo "    (unable to parse todos)"
                            fi
                        fi
                    done
                else
                    echo "  (no goals found)"
                fi
                echo ""
            fi
        fi
    done
}

# Show statistics dashboard
show_dashboard() {
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       MCP Redis Dashboard                ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # Count different types
    local all_keys=$(redis_exec "KEYS ${KEY_PREFIX}:*")
    local session_count=0
    local user_count=0
    local total_todos=0
    local completed_todos=0

    # Count sessions
    echo "$all_keys" | grep -v '^\$' | grep -v '^*' | grep "session:" | while read -r key; do
        ((session_count++)) || true
    done

    # Get unique users
    local users=$(echo "$all_keys" | grep -v '^\$' | grep -v '^*' | grep "user:" | sed -n 's/.*:user:\([^:]*\):.*/\1/p' | sort -u)
    user_count=$(echo "$users" | grep -v '^$' | wc -l)

    # Count todos
    echo "$all_keys" | grep -v '^\$' | grep -v '^*' | grep "user:.*:repo:" | while read -r key; do
        if [ -n "$key" ] && [[ ! "$key" =~ ^\+OK ]]; then
            local data=$(get_json_value "$key")
            if [ -n "$data" ]; then
                local todos=$(echo "$data" | jq -r '.plans[].todos[]' 2>/dev/null)
                if [ -n "$todos" ]; then
                    local todo_count=$(echo "$todos" | jq -s 'length' 2>/dev/null || echo "0")
                    local completed=$(echo "$todos" | jq -r 'select(.isComplete == true)' | jq -s 'length' 2>/dev/null || echo "0")
                    ((total_todos += todo_count)) || true
                    ((completed_todos += completed)) || true
                fi
            fi
        fi
    done

    # Display stats
    echo -e "  ${GREEN}Active Sessions:${NC}  $session_count"
    echo -e "  ${GREEN}Unique Users:${NC}     $user_count"
    echo -e "  ${GREEN}Total Todos:${NC}      $total_todos"
    echo -e "  ${GREEN}Completed:${NC}        $completed_todos"
    echo ""

    # Show users
    if [ -n "$users" ]; then
        echo -e "  ${YELLOW}Active Users:${NC}"
        echo "$users" | grep -v '^$' | while read -r user; do
            echo "    • $user"
        done
    fi

    echo ""

    # Redis health
    local pong=$(redis_exec "PING")
    if [[ "$pong" == *"PONG"* ]]; then
        echo -e "  ${GREEN}Redis Status: ✅ Connected${NC}"
    else
        echo -e "  ${RED}Redis Status: ❌ Disconnected${NC}"
    fi
}

# Main menu
main() {
    case "${1:-dashboard}" in
        dashboard)
            show_dashboard
            ;;
        sessions)
            show_sessions_summary
            ;;
        todos)
            show_user_todos
            ;;
        all)
            show_dashboard
            echo ""
            show_sessions_summary
            echo ""
            show_user_todos
            ;;
        *)
            echo -e "${BLUE}MCP Redis Data Viewer${NC}"
            echo "====================="
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  dashboard  - Show statistics dashboard (default)"
            echo "  sessions   - Show active sessions"
            echo "  todos      - Show user todos by repository"
            echo "  all        - Show everything"
            echo ""
            echo "Examples:"
            echo "  $0"
            echo "  $0 sessions"
            echo "  $0 todos"
            ;;
    esac
}

main "$@"
