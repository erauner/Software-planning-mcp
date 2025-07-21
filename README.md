# Software Planning Tool 🚀
[![smithery badge](https://smithery.ai/badge/@NightTrek/Software-planning-mcp)](https://smithery.ai/server/@NightTrek/Software-planning-mcp)

A Model Context Protocol (MCP) server designed to facilitate software development planning through an interactive, structured approach. This tool helps break down complex software projects into manageable tasks, track implementation progress, and maintain detailed development plans.

<a href="https://glama.ai/mcp/servers/a35c7qc7ie">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/a35c7qc7ie/badge" alt="Software Planning Tool MCP server" />
</a>

## Features ✨

- **Interactive Planning Sessions**: Start and manage development planning sessions
- **Todo Management**: Create, update, and track development tasks
- **Complexity Scoring**: Assign complexity scores to tasks for better estimation
- **Code Examples**: Include relevant code snippets in task descriptions
- **Implementation Plans**: Save and manage detailed implementation plans

## Installation 🛠️

### Installing via Smithery

To install Software Planning Tool for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@NightTrek/Software-planning-mcp):

```bash
npx -y @smithery/cli install @NightTrek/Software-planning-mcp --client claude
```

### Manual Installation
1. Clone the repository
2. Install dependencies:
```bash
pnpm install
```
3. Build the project:
```bash
pnpm run build
```
4. Add to your MCP settings configuration (typically located at `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "software-planning-tool": {
      "command": "node",
      "args": [
        "/path/to/software-planning-tool/build/index.js"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Available Tools 🔧

### start_planning
Start a new planning session with a specific goal.
```typescript
{
  goal: string  // The software development goal to plan
}
```

### add_todo
Add a new todo item to the current plan.
```typescript
{
  title: string,         // Title of the todo item
  description: string,   // Detailed description
  complexity: number,    // Complexity score (0-10)
  codeExample?: string  // Optional code example
}
```

### get_todos
Retrieve all todos in the current plan.
```typescript
// No parameters required
```

### update_todo_status
Update the completion status of a todo item.
```typescript
{
  todoId: string,     // ID of the todo item
  isComplete: boolean // New completion status
}
```

### save_plan
Save the current implementation plan.
```typescript
{
  plan: string  // The implementation plan text
}
```

### remove_todo
Remove a todo item from the current plan.
```typescript
{
  todoId: string  // ID of the todo item to remove
}
```

## Example Usage 📝

Here's a complete example of using the software planning tool:

1. Start a planning session:
```typescript
await client.callTool("software-planning-tool", "start_planning", {
  goal: "Create a React-based dashboard application"
});
```

2. Add a todo item:
```typescript
const todo = await client.callTool("software-planning-tool", "add_todo", {
  title: "Set up project structure",
  description: "Initialize React project with necessary dependencies",
  complexity: 3,
  codeExample: `
npx create-react-app dashboard
cd dashboard
npm install @material-ui/core @material-ui/icons
  `
});
```

3. Update todo status:
```typescript
await client.callTool("software-planning-tool", "update_todo_status", {
  todoId: todo.id,
  isComplete: true
});
```

4. Save the implementation plan:
```typescript
await client.callTool("software-planning-tool", "save_plan", {
  plan: `
# Dashboard Implementation Plan

## Phase 1: Setup (Complexity: 3)
- Initialize React project
- Install dependencies
- Set up routing

## Phase 2: Core Features (Complexity: 5)
- Implement authentication
- Create dashboard layout
- Add data visualization components
  `
});
```

## Development 🔨

### Project Structure
```
software-planning-tool/
  ├── src/
  │   ├── index.ts        # Main server implementation
  │   ├── prompts.ts      # Planning prompts and templates
  │   ├── storage.ts      # Data persistence
  │   └── types.ts        # TypeScript type definitions
  ├── build/              # Compiled JavaScript
  ├── package.json
  └── tsconfig.json
```

### Building
```bash
pnpm run build
```

### Testing
Test all features using the MCP inspector:
```bash
pnpm run inspector
```

## Storage Modes 💾

The Software Planning Tool supports two storage modes:

### File Mode (Default)
- Stores planning data in local `.planning/` directory
- Perfect for single-user, local development
- No additional configuration required

### Redis Mode (Multi-User/Remote)
- Stores planning data in Redis/Dragonfly
- Enables multi-user collaboration
- Session isolation by user and repository
- Perfect for remote deployment

#### Configuration

Set environment variables to enable Redis mode:

```bash
# Enable Redis storage
STORAGE_MODE=redis
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=planning
REDIS_TTL=2592000  # 30 days

# Repository settings
REPO_ID_MODE=auto
ENABLE_MULTI_REPO=true
```

#### Docker Deployment

Run with Docker for easy deployment:

```bash
# File mode
docker run -e STORAGE_MODE=file \
  ghcr.io/erauner/software-planning-mcp:latest

# Redis mode
docker run -e STORAGE_MODE=redis \
  -e REDIS_URL=redis://your-redis:6379 \
  ghcr.io/erauner/software-planning-mcp:latest
```

#### Session Management

In Redis mode, all tools accept additional parameters:

```typescript
{
  goal: string,
  userId?: string,      // Required for Redis mode
  sessionId?: string,   // Optional, auto-generated if not provided
  repository?: string,  // Repository identifier
  branch?: string       // Git branch name
}
```

## Remote Usage 🌐

For remote deployment (e.g., Kubernetes), use with an HTTP-to-MCP bridge:

```json
{
  "mcpServers": {
    "software-planning-remote": {
      "command": "/path/to/http-mcp-client.js",
      "args": ["https://your-domain.com/mcp"],
      "description": "Remote Software Planning Server"
    }
  }
}
```

## License 📄

MIT

---

Made with ❤️ using the Model Context Protocol
