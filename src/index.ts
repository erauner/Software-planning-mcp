#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Storage } from './storage.js';
import { SEQUENTIAL_THINKING_PROMPT, formatPlanAsTodos, formatTodosForDisplay, formatBranchSummary } from './prompts.js';
import { Goal, Todo } from './types.js';

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

  constructor() {
    this.server = new Server(
      {
        name: 'software-planning-tool',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'planning://current-goal',
          name: 'Current Goal',
          description: 'The current software development goal being planned',
          mimeType: 'application/json',
        },
        {
          uri: 'planning://implementation-plan',
          name: 'Implementation Plan',
          description: 'The current implementation plan with todos',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      switch (request.params.uri) {
        case 'planning://current-goal': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No active goal. Start a new planning session first.'
            );
          }
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.currentGoal, null, 2),
              },
            ],
          };
        }
        case 'planning://implementation-plan': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No active goal. Start a new planning session first.'
            );
          }
          const plan = await this.currentStorage.getPlan(this.currentGoal.id);
          if (!plan) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No implementation plan found for current goal.'
            );
          }
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(plan, null, 2),
              },
            ],
          };
        }
        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource URI: ${request.params.uri}`
          );
      }
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_planning',
          description: 'Start a new planning session with a goal',
          inputSchema: {
            type: 'object',
            properties: {
              goal: {
                type: 'string',
                description: 'The software development goal to plan',
              },
              projectPath: {
                type: 'string',
                description: 'Project directory path (defaults to current directory)',
              },
              branch: {
                type: 'string',
                description: 'Git branch name (auto-detected if not provided)',
              },
            },
            required: ['goal'],
          },
        },
        {
          name: 'save_plan',
          description: 'Save the current implementation plan',
          inputSchema: {
            type: 'object',
            properties: {
              plan: {
                type: 'string',
                description: 'The implementation plan text to save',
              },
            },
            required: ['plan'],
          },
        },
        {
          name: 'add_todo',
          description: 'Add a new todo item to the current plan',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title of the todo item',
              },
              description: {
                type: 'string',
                description: 'Detailed description of the todo item',
              },
              complexity: {
                type: 'number',
                description: 'Complexity score (0-10)',
                minimum: 0,
                maximum: 10,
              },
              codeExample: {
                type: 'string',
                description: 'Optional code example',
              },
            },
            required: ['title', 'description', 'complexity'],
          },
        },
        {
          name: 'remove_todo',
          description: 'Remove a todo item from the current plan',
          inputSchema: {
            type: 'object',
            properties: {
              todoId: {
                type: 'string',
                description: 'ID of the todo item to remove',
              },
            },
            required: ['todoId'],
          },
        },
        {
          name: 'get_todos',
          description: 'Get all todos in the current plan',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'update_todo_status',
          description: 'Update the completion status of a todo item',
          inputSchema: {
            type: 'object',
            properties: {
              todoId: {
                type: 'string',
                description: 'ID of the todo item',
              },
              isComplete: {
                type: 'boolean',
                description: 'New completion status',
              },
            },
            required: ['todoId', 'isComplete'],
          },
        },
        {
          name: 'list_branch_todos',
          description: 'Show todo summary across all git branches',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Project directory path (defaults to current directory)',
              },
            },
          },
        },
        {
          name: 'switch_branch',
          description: 'Switch to todos for a different branch',
          inputSchema: {
            type: 'object',
            properties: {
              branch: {
                type: 'string',
                description: 'Branch name to switch to',
              },
              projectPath: {
                type: 'string',
                description: 'Project directory path',
              },
            },
            required: ['branch'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
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

        case 'save_plan': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { plan } = request.params.arguments as { plan: string };
          const todos = formatPlanAsTodos(plan);

          for (const todo of todos) {
            await this.currentStorage.addTodo(this.currentGoal.id, todo);
          }

          return {
            content: [
              {
                type: 'text',
                text: `Successfully saved ${todos.length} todo items to the implementation plan.`,
              },
            ],
          };
        }

        case 'add_todo': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const todo = request.params.arguments as Omit<
            Todo,
            'id' | 'isComplete' | 'createdAt' | 'updatedAt'
          >;
          const newTodo = await this.currentStorage.addTodo(this.currentGoal.id, todo);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(newTodo, null, 2),
              },
            ],
          };
        }

        case 'remove_todo': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { todoId } = request.params.arguments as { todoId: string };
          await this.currentStorage.removeTodo(this.currentGoal.id, todoId);

          return {
            content: [
              {
                type: 'text',
                text: `Successfully removed todo ${todoId}`,
              },
            ],
          };
        }

        case 'get_todos': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const todos = await this.currentStorage.getTodos(this.currentGoal.id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(todos, null, 2),
              },
            ],
          };
        }

        case 'update_todo_status': {
          if (!this.currentGoal || !this.currentStorage) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { todoId, isComplete } = request.params.arguments as {
            todoId: string;
            isComplete: boolean;
          };
          const updatedTodo = await this.currentStorage.updateTodoStatus(
            this.currentGoal.id,
            todoId,
            isComplete
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(updatedTodo, null, 2),
              },
            ],
          };
        }

        case 'list_branch_todos': {
          const { projectPath } = request.params.arguments as { projectPath?: string };
          const projectDir = projectPath || process.cwd();
          
          // List all todo files in .planning directory
          const planningDir = path.join(projectDir, '.planning');
          let files = [];
          try {
            files = await fs.readdir(planningDir);
          } catch {
            // Directory doesn't exist
            return {
              content: [{
                type: 'text',
                text: 'No .planning directory found. Start a planning session to create todos.'
              }]
            };
          }
          
          const branchSummaries = [];
          for (const file of files) {
            if (file.endsWith('.todos.json')) {
              try {
                const branchName = file.replace('.todos.json', '').replace(/-/g, '/');
                const data = await fs.readFile(path.join(planningDir, file), 'utf-8');
                const parsed = JSON.parse(data);
                
                const todos = Object.values(parsed.plans || {})
                  .flatMap((plan: any) => plan.todos || []);
                
                branchSummaries.push({
                  branch: branchName,
                  total: todos.length,
                  completed: todos.filter((t: any) => t.isComplete).length,
                  percentage: todos.length > 0 
                    ? Math.round((todos.filter((t: any) => t.isComplete).length / todos.length) * 100)
                    : 0
                });
              } catch (error) {
                console.error(`Error reading ${file}:`, error);
              }
            }
          }
          
          return {
            content: [{
              type: 'text',
              text: formatBranchSummary(branchSummaries)
            }]
          };
        }

        case 'switch_branch': {
          const { branch, projectPath } = request.params.arguments as { 
            branch: string; 
            projectPath?: string; 
          };
          
          // Get storage for the new branch
          this.currentStorage = await this.getStorage(projectPath, branch);
          
          // Get existing todos for this branch
          const existingTodos = await this.currentStorage.getAllTodos();
          const existingGoals = await this.currentStorage.getGoals();
          
          if (existingTodos.length > 0) {
            // Set current goal to the most recent one
            this.currentGoal = Object.values(existingGoals)[0];
            
            return {
              content: [{
                type: 'text',
                text: `🔄 Switched to branch: ${branch}\n\n${formatTodosForDisplay(existingTodos, branch)}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `🔄 Switched to branch: ${branch}\n\n⎿ No todos found. Use start_planning to begin.`
              }]
            };
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Software Planning MCP server running on stdio');
  }
}

const server = new SoftwarePlanningServer();
server.run().catch(console.error);
