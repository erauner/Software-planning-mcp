import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Storage } from '../build/storage.js';
import { RedisStorage } from '../build/storage-adapters/redis-storage.js';
import { RedisStorageClient } from '../build/redis-client.js';

describe('Storage Adapters', () => {
  describe('File Storage', () => {
    let storage;
    let tempDir;
    let gitRepo;

    before(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-planning-'));
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
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      storage = new Storage(gitRepo, 'test-branch');
      await storage.initialize();
    });

    afterEach(async () => {
      // Clean up test files
      const planningDir = path.join(gitRepo, '.planning');
      await fs.rm(planningDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should create and retrieve goals', async () => {
      const goal = await storage.createGoal('Test goal');
      assert(goal.id);
      assert.equal(goal.description, 'Test goal');

      const retrieved = await storage.getGoal(goal.id);
      assert.deepEqual(retrieved, goal);
    });

    it('should handle todos lifecycle', async () => {
      const goal = await storage.createGoal('Test goal');
      const plan = await storage.createPlan(goal.id);

      const todo = await storage.addTodo(goal.id, {
        title: 'Test todo',
        description: 'Test description',
        complexity: 5
      });

      assert(todo.id);
      assert.equal(todo.isComplete, false);

      // Update status
      const updated = await storage.updateTodoStatus(goal.id, todo.id, true);
      assert.equal(updated.isComplete, true);

      // Remove todo
      await storage.removeTodo(goal.id, todo.id);
      const todos = await storage.getTodos(goal.id);
      assert.equal(todos.length, 0);
    });

    it('should isolate data between branches', async () => {
      // Create storage for first branch
      const storage1 = new Storage(gitRepo, 'branch1');
      await storage1.initialize();
      const goal1 = await storage1.createGoal('Branch 1 goal');
      await storage1.createPlan(goal1.id);
      await storage1.addTodo(goal1.id, {
        title: 'Branch 1 todo',
        description: 'Test',
        complexity: 3
      });

      // Create storage for second branch
      const storage2 = new Storage(gitRepo, 'branch2');
      await storage2.initialize();

      // Branch 2 should not see branch 1's todos
      const todos2 = await storage2.getAllTodos();
      assert.equal(todos2.length, 0);
    });
  });

  describe('Redis Storage', () => {
    let storage;
    let redisClient;
    const testContext = {
      userId: 'test-user',
      sessionId: 'test-session',
      repository: {
        repoIdentifier: 'github.com/test/repo',
        branch: 'test-branch'
      },
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };

    before(async () => {
      // Skip Redis tests if Redis is not available
      const redisUrl = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

      try {
        redisClient = new RedisStorageClient({
          url: redisUrl,
          keyPrefix: 'test-planning',
          ttl: 3600
        });
        await redisClient.client.ping();
      } catch (error) {
        console.log('Skipping Redis tests - Redis not available');
        return;
      }
    });

    beforeEach(async () => {
      if (!redisClient) return;

      storage = new RedisStorage(redisClient, testContext);
      await storage.initialize();
    });

    afterEach(async () => {
      if (!redisClient) return;

      // Clean up test keys
      const keys = await redisClient.client.keys('test-planning:*');
      if (keys.length > 0) {
        await redisClient.client.del(...keys);
      }
    });

    after(async () => {
      if (redisClient) {
        await redisClient.disconnect();
      }
    });

    it('should create and retrieve goals with repository context', async () => {
      if (!redisClient) return; // Skip if Redis not available

      const goal = await storage.createGoal('Test Redis goal');
      assert(goal.repository === 'github.com/test/repo');
      assert(goal.branch === 'test-branch');

      const goals = await storage.getGoals();
      assert(goals[goal.id]);
    });

    it('should isolate data by user and repository', async () => {
      if (!redisClient) return; // Skip if Redis not available

      // Create todo for user1
      const goal1 = await storage.createGoal('User 1 goal');
      await storage.createPlan(goal1.id);
      await storage.addTodo(goal1.id, {
        title: 'User 1 todo',
        description: 'Test',
        complexity: 3
      });

      // Create different context for user2
      const context2 = { ...testContext, userId: 'test-user-2' };
      const storage2 = new RedisStorage(redisClient, context2);
      await storage2.initialize();

      // User 2 should not see user 1's todos
      const todos2 = await storage2.getAllTodos();
      assert.equal(todos2.length, 0);
    });

    it('should handle full todo lifecycle in Redis', async () => {
      if (!redisClient) return; // Skip if Redis not available

      const goal = await storage.createGoal('Redis lifecycle test');
      await storage.createPlan(goal.id);

      const todo = await storage.addTodo(goal.id, {
        title: 'Redis todo',
        description: 'Test Redis operations',
        complexity: 7,
        codeExample: 'console.log("redis");'
      });

      assert(todo.id);
      assert.equal(todo.title, 'Redis todo');
      assert.equal(todo.complexity, 7);
      assert.equal(todo.isComplete, false);

      // Update status
      const updated = await storage.updateTodoStatus(goal.id, todo.id, true);
      assert.equal(updated.isComplete, true);

      // Verify persistence
      const todos = await storage.getTodos(goal.id);
      assert.equal(todos[0].isComplete, true);

      // Remove todo
      await storage.removeTodo(goal.id, todo.id);
      const finalTodos = await storage.getTodos(goal.id);
      assert.equal(finalTodos.length, 0);
    });
  });
});
