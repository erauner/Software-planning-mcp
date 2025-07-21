import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

describe('MCP Server Integration', () => {
  let tempDir;
  let gitRepo;
  let serverProcess;

  before(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-test-'));
    console.log('Created temp dir:', tempDir);

    // Create a git repository for testing
    gitRepo = path.join(tempDir, 'test-repo');
    await fs.mkdir(gitRepo);

    // Initialize git repo
    execSync('git init', { cwd: gitRepo });
    execSync('git config user.email "test@example.com"', { cwd: gitRepo });
    execSync('git config user.name "Test User"', { cwd: gitRepo });

    // Create initial commit
    await fs.writeFile(path.join(gitRepo, 'README.md'), '# Test Repo');
    execSync('git add README.md', { cwd: gitRepo });
    execSync('git commit -m "Initial commit"', { cwd: gitRepo });
  });

  after(async () => {
    // Stop server if running
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }

    // Cleanup temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Stop server after each test
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }

    // Clean up any .planning directories created during tests
    const planningDir = path.join(gitRepo, '.planning');
    await fs.rm(planningDir, { recursive: true, force: true }).catch(() => {});
  });

  // Helper function to start MCP server
  const startServer = () => {
    return new Promise((resolve, reject) => {
      const serverPath = path.resolve('./build/index.js');

      serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: gitRepo
      });

      let initData = '';
      let errorData = '';

      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);

      serverProcess.stdout.on('data', (data) => {
        initData += data.toString();
      });

      serverProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorData += chunk;

        // Look for server ready message
        if (chunk.includes('Software Planning MCP server running on stdio')) {
          clearTimeout(timeout);
          resolve(serverProcess);
        }
      });

      serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      serverProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}. stderr: ${errorData}`));
        }
      });
    });
  };

  // Helper function to send MCP request
  const sendRequest = (server, request) => {
    return new Promise((resolve, reject) => {
      let responseData = '';

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 5000);

      const onData = (data) => {
        responseData += data.toString();

        // Try to parse JSON response
        try {
          const lines = responseData.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const response = JSON.parse(lastLine);

          clearTimeout(timeout);
          server.stdout.off('data', onData);
          resolve(response);
        } catch (e) {
          // Continue waiting for complete response
        }
      };

      server.stdout.on('data', onData);
      server.stdin.write(JSON.stringify(request) + '\n');
    });
  };

  describe('Server Initialization', () => {
    it('should start server successfully', async () => {
      const server = await startServer();
      assert.ok(server);
      assert.ok(!server.killed);
    });
  });

  describe('List Tools', () => {
    it('should return all available tools', async () => {
      const server = await startServer();

      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      const response = await sendRequest(server, request);

      assert.equal(response.id, 1);
      assert.ok(response.result);
      assert.ok(Array.isArray(response.result.tools));

      const toolNames = response.result.tools.map(tool => tool.name);
      assert.ok(toolNames.includes('start_planning'));
      assert.ok(toolNames.includes('add_todo'));
      assert.ok(toolNames.includes('get_todos'));
      assert.ok(toolNames.includes('list_branch_todos'));
      assert.ok(toolNames.includes('switch_branch'));
    });
  });

  describe('List Resources', () => {
    it('should return available resources', async () => {
      const server = await startServer();

      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/list'
      };

      const response = await sendRequest(server, request);

      assert.equal(response.id, 2);
      assert.ok(response.result);
      assert.ok(Array.isArray(response.result.resources));

      const resourceNames = response.result.resources.map(r => r.name);
      assert.ok(resourceNames.includes('Current Goal'));
      assert.ok(resourceNames.includes('Implementation Plan'));
    });
  });

  describe('Planning Workflow', () => {
    it('should complete basic planning workflow', async () => {
      const server = await startServer();

      // Start planning
      const startPlanningRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Test planning workflow'
          }
        }
      };

      const startResponse = await sendRequest(server, startPlanningRequest);
      assert.equal(startResponse.id, 3);
      assert.ok(startResponse.result);
      assert.ok(startResponse.result.content);
      assert.ok(startResponse.result.content[0].text.includes('Starting: Test planning workflow'));

      // Add a todo
      const addTodoRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            title: 'Test todo item',
            description: 'A test todo for validation',
            complexity: 5
          }
        }
      };

      const addTodoResponse = await sendRequest(server, addTodoRequest);
      assert.equal(addTodoResponse.id, 4);
      assert.ok(addTodoResponse.result);

      // Get todos
      const getTodosRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_todos',
          arguments: {}
        }
      };

      const getTodosResponse = await sendRequest(server, getTodosRequest);
      assert.equal(getTodosResponse.id, 5);
      assert.ok(getTodosResponse.result);

      const todos = JSON.parse(getTodosResponse.result.content[0].text);
      assert.ok(Array.isArray(todos));
      assert.equal(todos.length, 1);
      assert.equal(todos[0].title, 'Test todo item');
    });

    it('should handle branch switching', async () => {
      const server = await startServer();

      // Start planning on main branch
      const startMainRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Main branch goal',
            branch: 'main'
          }
        }
      };

      const startMainResponse = await sendRequest(server, startMainRequest);
      assert.ok(startMainResponse.result.content[0].text.includes('main'));

      // Switch to feature branch
      const switchBranchRequest = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'switch_branch',
          arguments: {
            branch: 'feature/test'
          }
        }
      };

      const switchResponse = await sendRequest(server, switchBranchRequest);
      assert.ok(switchResponse.result.content[0].text.includes('feature/test'));
      assert.ok(switchResponse.result.content[0].text.includes('No todos found'));
    });

    it('should list branch todos', async () => {
      const server = await startServer();

      // Create todos on different branches
      await sendRequest(server, {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Branch A goal',
            branch: 'branch-a'
          }
        }
      });

      await sendRequest(server, {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            title: 'Branch A todo',
            description: 'Todo for branch A',
            complexity: 3
          }
        }
      });

      // List branch todos
      const listBranchRequest = {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'list_branch_todos',
          arguments: {}
        }
      };

      const listResponse = await sendRequest(server, listBranchRequest);
      assert.ok(listResponse.result.content[0].text.includes('Todo Summary'));
      assert.ok(listResponse.result.content[0].text.includes('branch-a'));
    });
  });

  describe('Error Handling', () => {
    it('should handle missing goal error', async () => {
      const server = await startServer();

      // Try to add todo without starting planning
      const addTodoRequest = {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            title: 'Test todo',
            description: 'Test description',
            complexity: 5
          }
        }
      };

      const response = await sendRequest(server, addTodoRequest);
      assert.ok(response.error);
      assert.ok(response.error.message.includes('No active goal'));
    });

    it('should handle invalid tool name', async () => {
      const server = await startServer();

      const request = {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'invalid_tool',
          arguments: {}
        }
      };

      const response = await sendRequest(server, request);
      assert.ok(response.error);
      assert.ok(response.error.message.includes('Unknown tool'));
    });
  });

  describe('Resource Access', () => {
    it('should read current goal resource', async () => {
      const server = await startServer();

      // Start planning first
      await sendRequest(server, {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Resource test goal'
          }
        }
      });

      // Read current goal resource
      const readGoalRequest = {
        jsonrpc: '2.0',
        id: 14,
        method: 'resources/read',
        params: {
          uri: 'planning://current-goal'
        }
      };

      const response = await sendRequest(server, readGoalRequest);
      assert.equal(response.id, 14);
      assert.ok(response.result);
      assert.ok(response.result.contents);

      const goalData = JSON.parse(response.result.contents[0].text);
      assert.equal(goalData.description, 'Resource test goal');
    });

    it('should read implementation plan resource', async () => {
      const server = await startServer();

      // Start planning and add a todo
      await sendRequest(server, {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Plan resource test'
          }
        }
      });

      await sendRequest(server, {
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            title: 'Test todo for plan',
            description: 'Test description',
            complexity: 4
          }
        }
      });

      // Read implementation plan resource
      const readPlanRequest = {
        jsonrpc: '2.0',
        id: 17,
        method: 'resources/read',
        params: {
          uri: 'planning://implementation-plan'
        }
      };

      const response = await sendRequest(server, readPlanRequest);
      assert.equal(response.id, 17);
      assert.ok(response.result);
      assert.ok(response.result.contents);

      const planData = JSON.parse(response.result.contents[0].text);
      assert.ok(planData.goalId);
      assert.ok(Array.isArray(planData.todos));
      assert.equal(planData.todos.length, 1);
      assert.equal(planData.todos[0].title, 'Test todo for plan');
    });
  });
});
