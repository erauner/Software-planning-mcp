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
import { loadConfig } from './config.js';
import { StorageFactory } from './storage-factory.js';
import { SessionManager } from './session-manager.js';
import { RedisStorageClient } from './redis-client.js';
import { detectRepositoryId, detectCurrentBranch } from './utils/repo-identifier.js';
import { SEQUENTIAL_THINKING_PROMPT, formatPlanAsTodos, formatTodosForDisplay, formatBranchSummary } from './prompts.js';
import { Goal, SessionContext, RepositoryContext, IStorage } from './types.js';

class SoftwarePlanningServer {
  private server: Server;
  private config: ReturnType<typeof loadConfig>;
  private storageFactory: StorageFactory;
  private sessionManager?: SessionManager;
  private redisClient?: RedisStorageClient;

  // Legacy storage for backward compatibility
  private legacyStorageInstances: Map<string, IStorage> = new Map();
  private currentStorage: IStorage | null = null;
  private currentGoal: Goal | null = null;

  constructor() {
    this.config = loadConfig();
    this.storageFactory = new StorageFactory(this.config);

    // Initialize Redis components if needed
    if (this.config.storage.type === 'redis' && this.config.storage.redis) {
      this.redisClient = new RedisStorageClient(this.config.storage.redis);
      this.sessionManager = new SessionManager(this.redisClient);
    }

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
  // Resolve session context from arguments
  private async resolveContext(args: any): Promise<SessionContext> {
    const userId = args.userId || 'local';

    if (this.config.storage.type === 'redis') {
      if (!args.userId) {
        throw new Error('userId required for Redis storage mode');
      }

      // Auto-detect or use provided repository info
      const repoId = args.repository ||
                     (args.gitRemoteUrl && this.extractRepoIdentifier(args.gitRemoteUrl)) ||
                     (await detectRepositoryId(args.projectPath));

      const branch = args.branch || await detectCurrentBranch(args.projectPath);

      const repository: RepositoryContext = {
        repoIdentifier: repoId,
        branch: branch,
        repoUrl: args.gitRemoteUrl,
        localPath: args.projectPath
      };

      // Find existing session or create new one
      if (args.sessionId && this.sessionManager) {
        const existingSession = await this.sessionManager.getSessionByIds(userId, args.sessionId);
        if (existingSession) {
          return existingSession;
        }
      }

      // Create new session
      if (this.sessionManager) {
        return await this.sessionManager.createOrUpdateSession({
          userId,
          sessionId: args.sessionId,
          repository
        });
      }
    }

    // Fallback for file mode - create legacy session context
    const repoId = await detectRepositoryId(args.projectPath);
    const branch = await detectCurrentBranch(args.projectPath);

    return {
      userId: 'local',
      sessionId: `${repoId}:${branch}`,
      repository: {
        repoIdentifier: repoId,
        branch: branch,
        localPath: args.projectPath || process.cwd()
      },
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };
  }

  private extractRepoIdentifier(gitRemoteUrl: string): string {
    const patterns = [
      /https?:\/\/([^\/]+)\/(.+?)(?:\.git)?$/,
      /git@([^:]+):(.+?)(?:\.git)?$/,
      /ssh:\/\/git@([^\/]+)\/(.+?)(?:\.git)?$/
    ];

    for (const pattern of patterns) {
      const match = gitRemoteUrl.match(pattern);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    }

    throw new Error(`Unable to parse repository URL: ${gitRemoteUrl}`);
  }

  // Get storage instance for session context
  private async getStorage(context: SessionContext): Promise<IStorage> {
    return await this.storageFactory.createStorage(context);
  }

  // Legacy method for backward compatibility
  private async getLegacyStorage(projectPath?: string, branch?: string): Promise<IStorage> {
    const path = projectPath || process.cwd();
    const key = `${path}:${branch || 'auto'}`;

    if (!this.legacyStorageInstances.has(key)) {
      const context: SessionContext = {
        userId: 'local',
        sessionId: key,
        repository: {
          repoIdentifier: await detectRepositoryId(path),
          branch: branch || await detectCurrentBranch(path),
          localPath: path
        },
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
      };

      const storage = await this.storageFactory.createFileStorage(context);
      this.legacyStorageInstances.set(key, storage);
    }

    return this.legacyStorageInstances.get(key)!;
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
              repository: {
                type: 'string',
                description: 'Repository identifier (e.g., github.com/user/repo)',
              },
              branch: {
                type: 'string',
                description: 'Git branch name (auto-detected if not provided)',
              },
              gitRemoteUrl: {
                type: 'string',
                description: 'Git remote URL for repository identification',
              },
              projectPath: {
                type: 'string',
                description: 'Project directory path (defaults to current directory)',
              },
              userId: {
                type: 'string',
                description: 'User ID for session management (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID to resume (optional, creates new if not provided)',
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
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID',
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
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID',
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
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID',
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
            properties: {
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID',
              },
            },
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
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              sessionId: {
                type: 'string',
                description: 'Session ID',
              },
            },
            required: ['todoId', 'isComplete'],
          },
        },
        {
          name: 'list_repository_todos',
          description: 'List todos across all repositories for a user',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'User ID (required for Redis mode)',
              },
              repositories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by specific repositories (optional)',
              },
            },
            required: ['userId'],
          },
        },
        {
          name: 'switch_context',
          description: 'Switch between repository contexts',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'User ID',
              },
              repository: {
                type: 'string',
                description: 'Repository identifier',
              },
              branch: {
                type: 'string',
                description: 'Branch name',
              },
              createIfMissing: {
                type: 'boolean',
                description: 'Create new session if not found',
              },
            },
            required: ['userId', 'repository', 'branch'],
          },
        },
        // Legacy tools for backward compatibility
        {
          name: 'list_branch_todos',
          description: 'Show todo summary across all git branches (legacy)',
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
          description: 'Switch to todos for a different branch (legacy)',
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
          const args = request.params.arguments as {
            goal: string;
            repository?: string;
            branch?: string;
            gitRemoteUrl?: string;
            projectPath?: string;
            userId?: string;
            sessionId?: string;
          };

          try {
            // Resolve session context
            const context = await this.resolveContext(args);

            // Get storage for this context
            const storage = await this.getStorage(context);
            this.currentStorage = storage;

            // Check for existing goals/todos
            const existingGoals = await storage.getGoals();
            const existingTodos = await storage.getTodos();

            if (existingTodos.length > 0) {
              // Continue existing session
              this.currentGoal = Object.values(existingGoals)[0];

              return {
                content: [{
                  type: 'text',
                  text: `⏺ Continuing: ${args.goal} (${context.repository.repoIdentifier}:${context.repository.branch})\n` +
                        `Session ID: ${context.sessionId}\n\n` +
                        `${formatTodosForDisplay(existingTodos, context.repository.branch)}\n\n` +
                        `${SEQUENTIAL_THINKING_PROMPT}`
                }]
              };
            } else {
              // Start new session
              this.currentGoal = await storage.createGoal(args.goal);
              await storage.createPlan(this.currentGoal.id);

              return {
                content: [{
                  type: 'text',
                  text: `⏺ Starting: ${args.goal} (${context.repository.repoIdentifier}:${context.repository.branch})\n` +
                        `Session ID: ${context.sessionId}\n\n` +
                        `${SEQUENTIAL_THINKING_PROMPT}`
                }]
              };
            }
          } catch (error) {
            console.error('Error in start_planning:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to start planning session: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        case 'save_plan': {
          const args = request.params.arguments as {
            plan: string;
            userId?: string;
            sessionId?: string;
          };

          try {
            let storage: IStorage;

            if (args.userId && args.sessionId && this.sessionManager) {
              // Redis mode - get storage from session
              const context = await this.sessionManager.getSessionByIds(args.userId, args.sessionId);
              if (!context) {
                throw new Error('Session not found');
              }
              storage = await this.getStorage(context);
            } else {
              // Legacy mode
              if (!this.currentStorage) {
                throw new Error('No active session. Start a planning session first.');
              }
              storage = this.currentStorage;
            }

            await storage.savePlan(args.plan);

            return {
              content: [{
                type: 'text',
                text: 'Successfully saved implementation plan.'
              }]
            };
          } catch (error) {
            console.error('Error in save_plan:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to save plan: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        case 'add_todo': {
          const args = request.params.arguments as {
            title: string;
            description: string;
            complexity: number;
            codeExample?: string;
            userId?: string;
            sessionId?: string;
          };

          try {
            let storage: IStorage;
            let goalId: string;

            if (args.userId && args.sessionId && this.sessionManager) {
              // Redis mode - get storage from session
              const context = await this.sessionManager.getSessionByIds(args.userId, args.sessionId);
              if (!context) {
                throw new Error('Session not found');
              }
              storage = await this.getStorage(context);

              // Find the goal ID from existing goals
              const goals = await storage.getGoals();
              goalId = Object.keys(goals)[0];
              if (!goalId) {
                throw new Error('No goal found for this session');
              }
            } else {
              // Legacy mode
              if (!this.currentStorage || !this.currentGoal) {
                throw new Error('No active session. Start a planning session first.');
              }
              storage = this.currentStorage;
              goalId = this.currentGoal.id;
            }

            const newTodo = await storage.addTodo(goalId, {
              title: args.title,
              description: args.description,
              complexity: args.complexity,
              codeExample: args.codeExample,
            });

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(newTodo, null, 2)
              }]
            };
          } catch (error) {
            console.error('Error in add_todo:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to add todo: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        case 'remove_todo': {
          const args = request.params.arguments as {
            todoId: string;
            userId?: string;
            sessionId?: string;
          };

          try {
            let storage: IStorage;
            let goalId: string;

            if (args.userId && args.sessionId && this.sessionManager) {
              const context = await this.sessionManager.getSessionByIds(args.userId, args.sessionId);
              if (!context) {
                throw new Error('Session not found');
              }
              storage = await this.getStorage(context);

              // Find the goal ID from existing goals
              const goals = await storage.getGoals();
              goalId = Object.keys(goals)[0];
              if (!goalId) {
                throw new Error('No goal found for this session');
              }
            } else {
              if (!this.currentStorage || !this.currentGoal) {
                throw new Error('No active session. Start a planning session first.');
              }
              storage = this.currentStorage;
              goalId = this.currentGoal.id;
            }

            await storage.removeTodo(goalId, args.todoId);

            return {
              content: [{
                type: 'text',
                text: `Successfully removed todo ${args.todoId}`
              }]
            };
          } catch (error) {
            console.error('Error in remove_todo:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to remove todo: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        case 'get_todos': {
          const args = request.params.arguments as {
            userId?: string;
            sessionId?: string;
          };

          try {
            let storage: IStorage;

            if (args.userId && args.sessionId && this.sessionManager) {
              const context = await this.sessionManager.getSessionByIds(args.userId, args.sessionId);
              if (!context) {
                throw new Error('Session not found');
              }
              storage = await this.getStorage(context);
            } else {
              if (!this.currentStorage) {
                throw new Error('No active session. Start a planning session first.');
              }
              storage = this.currentStorage;
            }

            const todos = await storage.getTodos();

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(todos, null, 2)
              }]
            };
          } catch (error) {
            console.error('Error in get_todos:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to get todos: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        case 'update_todo_status': {
          const args = request.params.arguments as {
            todoId: string;
            isComplete: boolean;
            userId?: string;
            sessionId?: string;
          };

          try {
            let storage: IStorage;
            let goalId: string | undefined;

            if (args.userId && args.sessionId && this.sessionManager) {
              const context = await this.sessionManager.getSessionByIds(args.userId, args.sessionId);
              if (!context) {
                throw new Error('Session not found');
              }
              storage = await this.getStorage(context);

              // Find the goal ID from existing goals
              const goals = await storage.getGoals();
              goalId = Object.keys(goals)[0];
            } else {
              if (!this.currentStorage || !this.currentGoal) {
                throw new Error('No active session. Start a planning session first.');
              }
              storage = this.currentStorage;
              goalId = this.currentGoal.id;
            }

            if (!goalId) {
              throw new Error('No goal found for this session');
            }

            const updatedTodo = await storage.updateTodoStatus(goalId, args.todoId, args.isComplete);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(updatedTodo, null, 2)
              }]
            };
          } catch (error) {
            console.error('Error in update_todo_status:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to update todo status: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        case 'list_repository_todos': {
          const args = request.params.arguments as {
            userId: string;
            repositories?: string[];
          };

          try {
            if (!this.sessionManager) {
              throw new Error('Redis session management not available');
            }

            const sessions = await this.sessionManager.getUserSessions(args.userId);
            const todosByRepo = new Map<string, any[]>();

            for (const session of sessions) {
              if (args.repositories && !args.repositories.includes(session.repository.repoIdentifier)) {
                continue;
              }

              const storage = await this.getStorage(session);
              const todos = await storage.getTodos();

              const key = `${session.repository.repoIdentifier}:${session.repository.branch}`;
              todosByRepo.set(key, todos.map(t => ({
                ...t,
                repository: session.repository.repoIdentifier,
                branch: session.repository.branch
              })));
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(Object.fromEntries(todosByRepo), null, 2)
              }]
            };
          } catch (error) {
            console.error('Error in list_repository_todos:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to list repository todos: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        case 'switch_context': {
          const args = request.params.arguments as {
            userId: string;
            repository: string;
            branch: string;
            createIfMissing?: boolean;
          };

          try {
            if (!this.sessionManager) {
              throw new Error('Redis session management not available');
            }

            let session = await this.sessionManager.findSession({
              userId: args.userId,
              repository: args.repository,
              branch: args.branch
            });

            if (!session && args.createIfMissing) {
              // Create new session
              session = await this.sessionManager.createOrUpdateSession({
                userId: args.userId,
                repository: {
                  repoIdentifier: args.repository,
                  branch: args.branch
                }
              });

              // Create initial goal
              const storage = await this.getStorage(session);
              await storage.createGoal(`Continue work on ${args.repository}:${args.branch}`);
            }

            if (!session) {
              throw new Error('Session not found and createIfMissing is false');
            }

            // Update current storage
            this.currentStorage = await this.getStorage(session);
            const goals = await this.currentStorage.getGoals();
            this.currentGoal = Object.values(goals)[0] || null;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(session, null, 2)
              }]
            };
          } catch (error) {
            console.error('Error in switch_context:', error);
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to switch context: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        // Legacy handlers for backward compatibility
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
                const data = await fs.readFile(path.join(planningDir, file), 'utf-8');
                const parsed = JSON.parse(data);

                // Use the branch name stored in the file data, not the filename
                const branchName = parsed.branch || file.replace('.todos.json', '');

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
          this.currentStorage = await this.getLegacyStorage(projectPath, branch);

          // Get existing todos for this branch
          const existingTodos = await this.currentStorage.getTodos();
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

    // Perform health check if Redis is configured
    if (this.config.storage.type === 'redis') {
      const isHealthy = await this.storageFactory.healthCheck();
      if (!isHealthy) {
        console.error('Warning: Redis health check failed');
      } else {
        console.error('Redis connection established');
      }
    }

    console.error(`Software Planning MCP server running on stdio (storage: ${this.config.storage.type})`);
  }
}

const server = new SoftwarePlanningServer();
server.run().catch(console.error);
