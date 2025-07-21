import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('Storage Mode E2E Tests', () => {
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-test-'));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const runMCPCommand = async (env, input) => {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['build/index.js'], {
        env: { ...process.env, ...env },
        cwd: process.cwd()
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => output += data.toString());
      child.stderr.on('data', (data) => errorOutput += data.toString());

      child.stdin.write(JSON.stringify(input) + '\n');
      child.stdin.end();

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Process timeout'));
      }, 10000);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}. Stderr: ${errorOutput}`));
        } else {
          try {
            // MCP responses should be JSON-RPC messages
            const lines = output.trim().split('\n');
            const response = JSON.parse(lines[lines.length - 1]); // Last line should be the response
            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse output as JSON: ${output}`));
          }
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  };

  describe('File Mode', () => {
    it('should work without userId/sessionId', async () => {
      const response = await runMCPCommand(
        { STORAGE_MODE: 'file' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: {
              goal: 'Test file mode',
              projectPath: tempDir
            }
          }
        }
      );

      assert(response.result);
      assert(!response.error);
      assert(response.result.content);
      assert(response.result.content[0].text.includes('Starting: Test file mode'));
    });

    it('should handle todos in file mode', async () => {
      // First start planning
      await runMCPCommand(
        { STORAGE_MODE: 'file' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: {
              goal: 'File mode todos test',
              projectPath: tempDir
            }
          }
        }
      );

      // Then add a todo
      const response = await runMCPCommand(
        { STORAGE_MODE: 'file' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              title: 'Test todo',
              description: 'Test description',
              complexity: 5
            }
          }
        }
      );

      assert(response.result);
      assert(!response.error);
      const todo = JSON.parse(response.result.content[0].text);
      assert.equal(todo.title, 'Test todo');
      assert.equal(todo.complexity, 5);
    });
  });

  describe('Redis Mode', () => {
    const isRedisAvailable = async () => {
      try {
        // Try to connect to Redis
        const testResponse = await runMCPCommand(
          {
            STORAGE_MODE: 'redis',
            REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379'
          },
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {}
          }
        );
        return !testResponse.error;
      } catch {
        return false;
      }
    };

    it('should require userId', async () => {
      if (!(await isRedisAvailable())) {
        console.log('Skipping Redis E2E test - Redis not available');
        return;
      }

      const response = await runMCPCommand(
        {
          STORAGE_MODE: 'redis',
          REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379'
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: {
              goal: 'Test redis mode'
              // Missing userId - should fail
            }
          }
        }
      );

      assert(response.error);
      assert(response.error.message.includes('userId required'));
    });

    it('should work with full session context', async () => {
      if (!(await isRedisAvailable())) {
        console.log('Skipping Redis E2E test - Redis not available');
        return;
      }

      const response = await runMCPCommand(
        {
          STORAGE_MODE: 'redis',
          REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379',
          REDIS_KEY_PREFIX: 'e2e-test'
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: {
              goal: 'Test redis mode',
              userId: 'test-user',
              repository: 'github.com/test/repo',
              branch: 'main'
            }
          }
        }
      );

      assert(response.result);
      assert(!response.error);
      assert(response.result.content[0].text.includes('Session ID:'));
      assert(response.result.content[0].text.includes('github.com/test/repo:main'));
    });

    it('should handle Redis todos with session context', async () => {
      if (!(await isRedisAvailable())) {
        console.log('Skipping Redis E2E test - Redis not available');
        return;
      }

      // First start planning
      const startResponse = await runMCPCommand(
        {
          STORAGE_MODE: 'redis',
          REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379',
          REDIS_KEY_PREFIX: 'e2e-test-todos'
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: {
              goal: 'Redis todos test',
              userId: 'todo-user',
              repository: 'github.com/test/todos',
              branch: 'main'
            }
          }
        }
      );

      assert(startResponse.result);

      // Extract session ID from response
      const sessionIdMatch = startResponse.result.content[0].text.match(/Session ID: ([^\s\n]+)/);
      assert(sessionIdMatch, 'Should contain Session ID in response');
      const sessionId = sessionIdMatch[1];

      // Add a todo with session context
      const todoResponse = await runMCPCommand(
        {
          STORAGE_MODE: 'redis',
          REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379',
          REDIS_KEY_PREFIX: 'e2e-test-todos'
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              title: 'Redis test todo',
              description: 'Test Redis functionality',
              complexity: 7,
              userId: 'todo-user',
              sessionId: sessionId
            }
          }
        }
      );

      assert(todoResponse.result);
      assert(!todoResponse.error);
      const todo = JSON.parse(todoResponse.result.content[0].text);
      assert.equal(todo.title, 'Redis test todo');
      assert.equal(todo.complexity, 7);
    });
  });

  describe('Mode Configuration', () => {
    it('should list tools in both modes', async () => {
      // Test file mode
      const fileResponse = await runMCPCommand(
        { STORAGE_MODE: 'file' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        }
      );

      assert(fileResponse.result);
      assert(Array.isArray(fileResponse.result.tools));
      assert(fileResponse.result.tools.some(t => t.name === 'start_planning'));

      // Test Redis mode (should work even without Redis connection for listing tools)
      const redisResponse = await runMCPCommand(
        { STORAGE_MODE: 'redis' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        }
      );

      assert(redisResponse.result);
      assert(Array.isArray(redisResponse.result.tools));
      assert(redisResponse.result.tools.some(t => t.name === 'start_planning'));

      // Both modes should have the same tools
      assert.equal(fileResponse.result.tools.length, redisResponse.result.tools.length);
    });

    it('should list resources in both modes', async () => {
      // Test file mode
      const fileResponse = await runMCPCommand(
        { STORAGE_MODE: 'file' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/list',
          params: {}
        }
      );

      assert(fileResponse.result);
      assert(Array.isArray(fileResponse.result.resources));

      // Test Redis mode
      const redisResponse = await runMCPCommand(
        { STORAGE_MODE: 'redis' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/list',
          params: {}
        }
      );

      assert(redisResponse.result);
      assert(Array.isArray(redisResponse.result.resources));

      // Both modes should have the same resources
      assert.equal(fileResponse.result.resources.length, redisResponse.result.resources.length);
    });
  });
});
