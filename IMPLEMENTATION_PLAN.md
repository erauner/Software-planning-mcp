# Implementation Plan: Software Planning MCP - Branch-Aware Todo Storage

## Overview
This document provides a step-by-step implementation plan for adding project-relative, git branch-aware file persistence to the Software Planning MCP server.

**Plane Ticket Reference**: ERAUN-22 - "Add Project-Relative File Persistence to Software Planning MCP"
*Note to implementer: You can view the full ticket details in Plane using the ticket ID above for additional context and updates.*

## Project Setup

### Repository Information
- **Fork Repository**: https://github.com/erauner/Software-planning-mcp
- **Original Repository**: https://github.com/NightTrek/Software-planning-mcp
- **Current Storage**: `~/.software-planning-tool/data.json` (global, all projects mixed)
- **Target Storage**: `.planning/[branch-name].todos.json` (per-project, per-branch)

### Development Environment
1. Clone the fork:
   ```bash
   git clone https://github.com/erauner/Software-planning-mcp.git
   cd Software-planning-mcp
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build and test current version:
   ```bash
   pnpm run build
   pnpm run inspector
   ```

## Implementation Steps

### Phase 1: Refactor Storage Class (4-6 hours)

#### 1.1 Update Storage Constructor
**File**: `src/storage.ts`

```typescript
// Add imports
import { execSync } from 'child_process';

// Update constructor to accept projectPath and detect git branch
constructor(projectPath?: string, overrideBranch?: string) {
  this.projectPath = projectPath || process.cwd();
  this.currentBranch = overrideBranch || this.getCurrentGitBranch();
  
  const dataDir = path.join(this.projectPath, '.planning');
  const safeBranch = this.sanitizeBranchName(this.currentBranch);
  this.storagePath = path.join(dataDir, `${safeBranch}.todos.json`);
  
  // Update data structure
  this.data = {
    branch: this.currentBranch,
    projectPath: this.projectPath,
    goals: {},
    plans: {},
    lastUpdated: null
  };
}
```

#### 1.2 Add Git Branch Detection Methods
```typescript
private getCurrentGitBranch(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: this.projectPath,
      encoding: 'utf-8'
    }).trim();
    return branch || 'main';
  } catch (error) {
    // Not a git repo or git not available
    console.log('Not a git repository, using default branch name');
    return 'default';
  }
}

private sanitizeBranchName(branch: string): string {
  // Replace problematic characters for filenames
  // feature/auth-system -> feature-auth-system
  // fix/bug#123 -> fix-bug-123
  return branch.replace(/[^a-zA-Z0-9-_]/g, '-');
}
```

#### 1.3 Update Initialize Method
```typescript
async initialize(): Promise<void> {
  try {
    const dataDir = path.dirname(this.storagePath);
    await fs.mkdir(dataDir, { recursive: true });
    
    // Try to read existing data for this branch
    const data = await fs.readFile(this.storagePath, 'utf-8');
    this.data = JSON.parse(data);
    
    console.log(`Loaded existing todos from ${this.storagePath}`);
    console.log(`Branch: ${this.data.branch}, Todos: ${this.getTodoCount()}`);
  } catch (error) {
    // First time - create new file
    console.log(`Creating new todo file for branch: ${this.currentBranch}`);
    await this.save();
  }
}
```

### Phase 2: Update Server Class (3-4 hours)

#### 2.1 Modify Server to Support Multiple Storage Instances
**File**: `src/index.ts`

```typescript
class SoftwarePlanningServer {
  private server: Server;
  private storageInstances: Map<string, Storage> = new Map();
  private currentStorage: Storage | null = null;
  private currentGoal: Goal | null = null;

  // Add method to get or create storage for a project/branch
  private async getStorage(projectPath?: string, branch?: string): Promise<Storage> {
    const path = projectPath || process.cwd();
    const key = `${path}:${branch || 'auto'}`;
    
    if (!this.storageInstances.has(key)) {
      const storage = new Storage(path, branch);
      await storage.initialize();
      this.storageInstances.set(key, storage);
    }
    
    return this.storageInstances.get(key)!;
  }
}
```

#### 2.2 Update start_planning Function
```typescript
case 'start_planning': {
  const { goal, projectPath, branch } = request.params.arguments as {
    goal: string;
    projectPath?: string;
    branch?: string;
  };
  
  // Get storage for this project/branch
  this.currentStorage = await this.getStorage(projectPath, branch);
  
  // Check for existing goal/todos
  const existingGoals = await this.currentStorage.getGoals();
  const existingTodos = await this.currentStorage.getAllTodos();
  
  if (existingTodos.length > 0) {
    // Continue existing session
    this.currentGoal = Object.values(existingGoals)[0]; // Get most recent
    
    return {
      content: [{
        type: 'text',
        text: `⏺ Continuing: ${goal} (branch: ${this.currentStorage.getCurrentBranch()})\n\n${formatTodosForDisplay(existingTodos, this.currentStorage.getCurrentBranch())}\n\n${SEQUENTIAL_THINKING_PROMPT}`
      }]
    };
  } else {
    // Start new session
    this.currentGoal = await this.currentStorage.createGoal(goal);
    await this.currentStorage.createPlan(this.currentGoal.id);
    
    return {
      content: [{
        type: 'text',
        text: `⏺ Starting: ${goal} (branch: ${this.currentStorage.getCurrentBranch()})\n\n${SEQUENTIAL_THINKING_PROMPT}`
      }]
    };
  }
}
```

### Phase 3: Add Visual Formatting (2-3 hours)

#### 3.1 Create Todo Display Formatter
**File**: `src/prompts.ts`

```typescript
export function formatTodosForDisplay(todos: Todo[], branch: string): string {
  const completed = todos.filter(t => t.isComplete);
  const pending = todos.filter(t => !t.isComplete);
  
  let output = `⏺ Current Todos (branch: ${branch})\n\n`;
  
  if (pending.length > 0) {
    output += '  ⎿ Active Tasks:\n';
    pending.forEach(todo => {
      output += `     ☐ ${todo.title}`;
      if (todo.complexity !== undefined) {
        output += ` (Complexity: ${todo.complexity})`;
      }
      output += '\n';
    });
  }
  
  if (completed.length > 0) {
    output += '\n  ⎿ Completed:\n';
    completed.forEach(todo => {
      output += `     ☒ ${todo.title}\n`;
    });
  }
  
  if (todos.length === 0) {
    output += '  ⎿ No todos yet. Start adding tasks!\n';
  }
  
  return output;
}
```

### Phase 4: Add New Functions (3-4 hours)

#### 4.1 Add Branch Management Functions
```typescript
// In setupToolHandlers() method
{
  name: 'list_branch_todos',
  description: 'Show todo summary across all git branches',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project directory path (defaults to current directory)'
      }
    }
  }
},
{
  name: 'switch_branch',
  description: 'Switch to todos for a different branch',
  inputSchema: {
    type: 'object', 
    properties: {
      branch: {
        type: 'string',
        description: 'Branch name to switch to'
      },
      projectPath: {
        type: 'string',
        description: 'Project directory path'
      }
    },
    required: ['branch']
  }
}
```

#### 4.2 Implement Branch Functions
```typescript
case 'list_branch_todos': {
  const { projectPath } = request.params.arguments as { projectPath?: string };
  const path = projectPath || process.cwd();
  
  // List all todo files in .planning directory
  const planningDir = path.join(path, '.planning');
  const files = await fs.readdir(planningDir).catch(() => []);
  
  const branchSummaries = [];
  for (const file of files) {
    if (file.endsWith('.todos.json')) {
      const branchName = file.replace('.todos.json', '');
      const data = await fs.readFile(path.join(planningDir, file), 'utf-8');
      const parsed = JSON.parse(data);
      
      const todos = Object.values(parsed.plans)
        .flatMap((plan: any) => plan.todos || []);
      
      branchSummaries.push({
        branch: branchName,
        total: todos.length,
        completed: todos.filter((t: any) => t.isComplete).length,
        percentage: todos.length > 0 
          ? Math.round((todos.filter((t: any) => t.isComplete).length / todos.length) * 100)
          : 0
      });
    }
  }
  
  return {
    content: [{
      type: 'text',
      text: formatBranchSummary(branchSummaries)
    }]
  };
}
```

### Phase 5: Update Type Definitions (1 hour)

#### 5.1 Update StorageData Interface
**File**: `src/types.ts`

```typescript
export interface StorageData {
  branch: string;
  projectPath: string;
  goals: Record<string, Goal>;
  plans: Record<string, ImplementationPlan>;
  lastUpdated: string | null;
}

// Add new method signatures to Storage class
export interface Storage {
  getCurrentBranch(): string;
  getProjectPath(): string;
  getTodoCount(): number;
  getAllTodos(): Promise<Todo[]>;
}
```

### Phase 6: Add Configuration Support (2 hours)

#### 6.1 Create Config Types
```typescript
export interface PlanningConfig {
  branchStrategy: 'separate' | 'unified';
  autoLoadOnSwitch: boolean;
  excludeBranches: string[];
  defaultBranch: string;
  showBranchInPrompt: boolean;
}
```

#### 6.2 Load Configuration
```typescript
private async loadConfig(): Promise<PlanningConfig> {
  const configPath = path.join(this.projectPath, '.planning', 'config.json');
  
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Return default config
    return {
      branchStrategy: 'separate',
      autoLoadOnSwitch: true,
      excludeBranches: ['temp/*', 'dependabot/*'],
      defaultBranch: 'main',
      showBranchInPrompt: true
    };
  }
}
```

### Phase 7: Testing (2-3 hours)

#### 7.1 Manual Testing Checklist
- [ ] Create todos in a git repository
- [ ] Switch branches and verify todos change
- [ ] Create todos in non-git directory (should use 'default')
- [ ] Test with various branch names (feature/auth, fix/bug-123, etc.)
- [ ] Verify file names are sanitized correctly
- [ ] Test loading existing todos on restart
- [ ] Test multiple projects simultaneously

#### 7.2 Test Commands
```bash
# Test in current project
pnpm run build
software-planning-tool

# Start planning
start_planning({ goal: "Test branch awareness" })
add_todo({ title: "Test todo", description: "Testing", complexity: 3 })

# Switch branches
git checkout -b feature/test-branch
start_planning({ goal: "Test on new branch" })

# List branch todos
list_branch_todos({})
```

### Phase 8: Documentation (1 hour)

#### 8.1 Update README.md
- Add section on branch-aware storage
- Update usage examples
- Add configuration documentation

#### 8.2 Create Migration Guide
- Instructions for users with existing global todos
- Script to migrate old format to new format

## Potential Issues & Solutions

### Issue 1: Performance with Many Branches
**Solution**: Implement lazy loading and caching for branch summaries

### Issue 2: Branch Name Conflicts
**Solution**: Use full branch path in filename (feature-auth-system.todos.json)

### Issue 3: Concurrent Access
**Solution**: Implement file locking or use atomic writes

### Issue 4: Git Submodules
**Solution**: Detect and handle submodule boundaries correctly

## Success Verification

1. **Unit Tests Pass**: All existing tests should still pass
2. **Branch Isolation**: Todos from different branches don't mix
3. **Persistence**: Todos survive MCP restart
4. **Visual Feedback**: Clear branch indication in displays
5. **Performance**: No noticeable lag when switching branches

## Next Steps for Future Enhancements

1. **Git Hook Integration**: Auto-display todos on branch switch
2. **Merge Handling**: Smart todo merging when branches merge
3. **Team Sync**: Option to sync todos via git
4. **VS Code Extension**: Direct integration with editor
5. **CLI Tool**: Standalone command for viewing todos

## Notes for Implementer

- The current implementation uses a global `currentGoal` in memory - this needs to be refactored to support per-branch goals
- Consider backward compatibility - maybe auto-migrate old global todos
- Test thoroughly with different git configurations (worktrees, bare repos, etc.)
- Keep the visual formatting clean and consistent with the examples provided

Good luck with the implementation! Feel free to update the Plane ticket with progress and any blockers encountered.