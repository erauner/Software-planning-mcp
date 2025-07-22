#!/bin/bash
# Example usage of MCP Software Planning server in K8s
# Shows how to interact with the server using kubectl exec

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${K8S_NAMESPACE:-devops}"
APP_LABEL="${APP_LABEL:-app=mcp-software-planning}"
USER_ID="${USER_ID:-demo-user}"
SESSION_ID="${SESSION_ID:-demo-session}"

# Get pod name
get_pod() {
    kubectl get pods -n "$NAMESPACE" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# Execute MCP request
mcp_request() {
    local method="$1"
    local params="$2"
    local id="${3:-1}"
    local pod=$(get_pod)

    local request='{"jsonrpc":"2.0","method":"'$method'","params":'$params',"id":'$id'}'

    kubectl exec -n "$NAMESPACE" "$pod" -- sh -c "echo '$request' | timeout 10 node /app/build/index.js 2>/dev/null" | jq '.' 2>/dev/null || echo "Request failed"
}

# Tool wrapper functions
initialize() {
    echo -e "${BLUE}Initializing MCP connection...${NC}"
    mcp_request "initialize" '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"k8s-demo","version":"1.0"}}'
}

list_tools() {
    echo -e "${BLUE}Listing available tools...${NC}"
    mcp_request "tools/list" '{}'
}

start_planning() {
    local task="$1"
    echo -e "${BLUE}Starting planning: $task${NC}"
    mcp_request "tools/call" '{"name":"start_planning","arguments":{"task":"'"$task"'","userId":"'"$USER_ID"'","sessionId":"'"$SESSION_ID"'"}}'
}

save_plan() {
    local plan="$1"
    echo -e "${BLUE}Saving plan...${NC}"
    mcp_request "tools/call" '{"name":"save_plan","arguments":{"plan":"'"$plan"'","userId":"'"$USER_ID"'","sessionId":"'"$SESSION_ID"'"}}'
}

add_todo() {
    local description="$1"
    echo -e "${BLUE}Adding todo: $description${NC}"
    mcp_request "tools/call" '{"name":"add_todo","arguments":{"description":"'"$description"'","userId":"'"$USER_ID"'","sessionId":"'"$SESSION_ID"'"}}'
}

get_todos() {
    echo -e "${BLUE}Getting todos...${NC}"
    mcp_request "tools/call" '{"name":"get_todos","arguments":{"userId":"'"$USER_ID"'","sessionId":"'"$SESSION_ID"'"}}'
}

update_todo_status() {
    local todo_id="$1"
    local is_complete="$2"
    echo -e "${BLUE}Updating todo $todo_id to complete=$is_complete...${NC}"
    mcp_request "tools/call" '{"name":"update_todo_status","arguments":{"todoId":"'"$todo_id"'","isComplete":'$is_complete',"userId":"'"$USER_ID"'","sessionId":"'"$SESSION_ID"'"}}'
}

# Demo scenario
demo() {
    echo -e "${GREEN}🎯 MCP Software Planning Demo${NC}"
    echo "=============================="
    echo "User: $USER_ID"
    echo "Session: $SESSION_ID"
    echo ""

    # Initialize
    initialize
    echo ""

    # Start planning
    start_planning "Implement user authentication system"
    echo ""

    # Save plan
    save_plan "Build a secure authentication system with JWT tokens and OAuth2 support"
    echo ""

    # Add todos
    add_todo "Research authentication best practices"
    add_todo "Design database schema for users"
    add_todo "Implement JWT token generation"
    add_todo "Add OAuth2 provider integration"
    add_todo "Write unit tests"
    echo ""

    # Get todos
    echo -e "${YELLOW}Current todos:${NC}"
    get_todos | jq -r '.result.content[0].text' 2>/dev/null || echo "Failed to get todos"
    echo ""

    # Get todos to find IDs
    echo -e "${YELLOW}Getting todo IDs...${NC}"
    TODOS=$(get_todos)

    # Extract first todo ID (this is a simplified extraction)
    # In a real script, you'd parse the JSON properly
    echo "Note: Todo status updates require specific todo IDs from the previous response"
    echo ""

    # Get updated todos
    echo -e "${YELLOW}Updated todos:${NC}"
    get_todos | jq -r '.result.content[0].text' 2>/dev/null || echo "Failed to get todos"

    echo ""
    echo -e "${GREEN}✅ Demo complete!${NC}"
}

# Interactive mode
interactive() {
    echo -e "${GREEN}🎮 Interactive MCP Client${NC}"
    echo "========================="
    echo "Commands:"
    echo "  init          - Initialize connection"
    echo "  tools         - List available tools"
    echo "  plan <task>   - Start planning a task"
    echo "  save <plan>   - Save plan description"
    echo "  todo <desc>   - Add a todo item"
    echo "  list          - List todos"
    echo "  done <index>  - Mark todo as completed"
    echo  " demo          - Run demo scenario"
    echo "  quit          - Exit"
    echo ""

    while true; do
        echo -n "> "
        read -r cmd args

        case "$cmd" in
            init) initialize ;;
            tools) list_tools ;;
            plan) start_planning "$args" ;;
            save) save_plan "$args" ;;
            todo) add_todo "$args" ;;
            list) get_todos ;;
            done) update_todo_status "$args" "completed" ;;
            demo) demo ;;
            quit|exit) break ;;
            *) echo "Unknown command: $cmd" ;;
        esac
        echo ""
    done
}

# Main
main() {
    POD=$(get_pod)
    if [ -z "$POD" ]; then
        echo -e "${RED}❌ No pod found with label $APP_LABEL in namespace $NAMESPACE${NC}"
        exit 1
    fi

    if [ "$1" == "demo" ]; then
        demo
    elif [ "$1" == "interactive" ]; then
        interactive
    else
        echo "Usage: $0 [demo|interactive]"
        echo ""
        echo "  demo         - Run a demo scenario"
        echo "  interactive  - Start interactive mode"
        echo ""
        echo "Environment variables:"
        echo "  K8S_NAMESPACE - Kubernetes namespace (default: devops)"
        echo "  USER_ID       - User ID for session (default: demo-user)"
        echo "  SESSION_ID    - Session ID (default: demo-session)"
    fi
}

main "$@"
