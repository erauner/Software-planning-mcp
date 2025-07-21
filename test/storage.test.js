import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Storage } from '../build/storage.js';

describe('Storage', () => {
  let tempDir;
  let gitRepo;
  let storage;

  before(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
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
    // Cleanup temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up any .planning directories created during tests
    const planningDir = path.join(gitRepo, '.planning');
    await fs.rm(planningDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default branch in git repo', async () => {
      // Switch to main branch
      execSync('git checkout -b main', { cwd: gitRepo }).catch(() => {});
      
      storage = new Storage(gitRepo);
      await storage.initialize();
      
      assert.equal(storage.getCurrentBranch(), 'main');
      assert.equal(storage.getProjectPath(), gitRepo);
    });

    it('should use "default" branch in non-git directory', async () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      await fs.mkdir(nonGitDir);
      
      storage = new Storage(nonGitDir);
      await storage.initialize();
      
      assert.equal(storage.getCurrentBranch(), 'default');
      assert.equal(storage.getProjectPath(), nonGitDir);
    });

    it('should use override branch when provided', async () => {
      storage = new Storage(gitRepo, 'feature/test');
      await storage.initialize();
      
      assert.equal(storage.getCurrentBranch(), 'feature/test');
    });

    it('should sanitize branch names for file paths', async () => {
      storage = new Storage(gitRepo, 'feature/auth#123');
      await storage.initialize();
      
      // Check that .planning directory exists with sanitized filename
      const planningDir = path.join(gitRepo, '.planning');
      const files = await fs.readdir(planningDir);
      
      assert.ok(files.some(f => f === 'feature-auth-123.todos.json'));
    });
  });

  describe('Goal Management', () => {
    beforeEach(async () => {
      storage = new Storage(gitRepo);
      await storage.initialize();
    });

    it('should create and retrieve goals', async () => {
      const goal = await storage.createGoal('Test goal');
      
      assert.ok(goal.id);
      assert.equal(goal.description, 'Test goal');
      assert.ok(goal.createdAt);
      
      const retrieved = await storage.getGoal(goal.id);
      assert.deepEqual(retrieved, goal);
    });

    it('should return null for non-existent goal', async () => {
      const goal = await storage.getGoal('non-existent');
      assert.equal(goal, null);
    });

    it('should get all goals', async () => {
      const goal1 = await storage.createGoal('Goal 1');
      const goal2 = await storage.createGoal('Goal 2');
      
      const goals = await storage.getGoals();
      assert.equal(Object.keys(goals).length, 2);
      assert.ok(goals[goal1.id]);
      assert.ok(goals[goal2.id]);
    });
  });

  describe('Plan Management', () => {
    let goal;
    
    beforeEach(async () => {
      storage = new Storage(gitRepo);
      await storage.initialize();
      goal = await storage.createGoal('Test goal');
    });

    it('should create and retrieve implementation plans', async () => {
      const plan = await storage.createPlan(goal.id);
      
      assert.equal(plan.goalId, goal.id);
      assert.equal(plan.todos.length, 0);
      assert.ok(plan.updatedAt);
      
      const retrieved = await storage.getPlan(goal.id);
      assert.deepEqual(retrieved, plan);
    });

    it('should return null for non-existent plan', async () => {
      const plan = await storage.getPlan('non-existent');
      assert.equal(plan, null);
    });
  });

  describe('Todo Management', () => {
    let goal, plan;
    
    beforeEach(async () => {
      storage = new Storage(gitRepo);
      await storage.initialize();
      goal = await storage.createGoal('Test goal');
      plan = await storage.createPlan(goal.id);
    });

    it('should add todos to a plan', async () => {
      const todoData = {
        title: 'Test todo',
        description: 'Test description',
        complexity: 5,
        codeExample: 'console.log("test");'
      };
      
      const todo = await storage.addTodo(goal.id, todoData);
      
      assert.ok(todo.id);
      assert.equal(todo.title, todoData.title);
      assert.equal(todo.description, todoData.description);
      assert.equal(todo.complexity, todoData.complexity);
      assert.equal(todo.codeExample, todoData.codeExample);
      assert.equal(todo.isComplete, false);
      assert.ok(todo.createdAt);
      assert.ok(todo.updatedAt);
    });

    it('should retrieve todos for a goal', async () => {
      const todoData1 = { title: 'Todo 1', description: 'Desc 1', complexity: 3 };
      const todoData2 = { title: 'Todo 2', description: 'Desc 2', complexity: 7 };
      
      await storage.addTodo(goal.id, todoData1);
      await storage.addTodo(goal.id, todoData2);
      
      const todos = await storage.getTodos(goal.id);
      assert.equal(todos.length, 2);
      assert.equal(todos[0].title, 'Todo 1');
      assert.equal(todos[1].title, 'Todo 2');
    });

    it('should update todo completion status', async () => {
      const todoData = { title: 'Test todo', description: 'Test description', complexity: 5 };
      const todo = await storage.addTodo(goal.id, todoData);
      
      const updatedTodo = await storage.updateTodoStatus(goal.id, todo.id, true);
      
      assert.equal(updatedTodo.isComplete, true);
      assert.notEqual(updatedTodo.updatedAt, todo.updatedAt);
    });

    it('should remove todos', async () => {
      const todoData = { title: 'Test todo', description: 'Test description', complexity: 5 };
      const todo = await storage.addTodo(goal.id, todoData);
      
      await storage.removeTodo(goal.id, todo.id);
      
      const todos = await storage.getTodos(goal.id);
      assert.equal(todos.length, 0);
    });

    it('should get all todos across all plans', async () => {
      const goal2 = await storage.createGoal('Goal 2');
      await storage.createPlan(goal2.id);
      
      await storage.addTodo(goal.id, { title: 'Todo 1', description: 'Desc 1', complexity: 3 });
      await storage.addTodo(goal2.id, { title: 'Todo 2', description: 'Desc 2', complexity: 7 });
      
      const allTodos = await storage.getAllTodos();
      assert.equal(allTodos.length, 2);
    });

    it('should get todo count', async () => {
      await storage.addTodo(goal.id, { title: 'Todo 1', description: 'Desc 1', complexity: 3 });
      await storage.addTodo(goal.id, { title: 'Todo 2', description: 'Desc 2', complexity: 7 });
      
      assert.equal(storage.getTodoCount(), 2);
    });

    it('should throw error when adding todo to non-existent goal', async () => {
      const todoData = { title: 'Test todo', description: 'Test description', complexity: 5 };
      
      try {
        await storage.addTodo('non-existent', todoData);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.message.includes('No plan found for goal'));
      }
    });
  });

  describe('Branch Isolation', () => {
    it('should isolate todos between branches', async () => {
      // Create storage for main branch
      const mainStorage = new Storage(gitRepo, 'main');
      await mainStorage.initialize();
      const mainGoal = await mainStorage.createGoal('Main goal');
      await mainStorage.createPlan(mainGoal.id);
      await mainStorage.addTodo(mainGoal.id, { title: 'Main todo', description: 'Main desc', complexity: 5 });
      
      // Create storage for feature branch
      const featureStorage = new Storage(gitRepo, 'feature/branch');
      await featureStorage.initialize();
      const featureGoal = await featureStorage.createGoal('Feature goal');
      await featureStorage.createPlan(featureGoal.id);
      await featureStorage.addTodo(featureGoal.id, { title: 'Feature todo', description: 'Feature desc', complexity: 3 });
      
      // Verify isolation
      const mainTodos = await mainStorage.getAllTodos();
      const featureTodos = await featureStorage.getAllTodos();
      
      assert.equal(mainTodos.length, 1);
      assert.equal(featureTodos.length, 1);
      assert.equal(mainTodos[0].title, 'Main todo');
      assert.equal(featureTodos[0].title, 'Feature todo');
    });

    it('should persist data across storage instances for same branch', async () => {
      // Create first storage instance
      const storage1 = new Storage(gitRepo, 'test-branch');
      await storage1.initialize();
      const goal = await storage1.createGoal('Persistent goal');
      await storage1.createPlan(goal.id);
      await storage1.addTodo(goal.id, { title: 'Persistent todo', description: 'Persistent desc', complexity: 8 });
      
      // Create second storage instance for same branch
      const storage2 = new Storage(gitRepo, 'test-branch');
      await storage2.initialize();
      
      const todos = await storage2.getAllTodos();
      assert.equal(todos.length, 1);
      assert.equal(todos[0].title, 'Persistent todo');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      storage = new Storage(gitRepo);
      await storage.initialize();
    });

    it('should handle missing goal gracefully in updateTodoStatus', async () => {
      try {
        await storage.updateTodoStatus('non-existent', 'todo-id', true);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.message.includes('No plan found for goal'));
      }
    });

    it('should handle missing todo gracefully in updateTodoStatus', async () => {
      const goal = await storage.createGoal('Test goal');
      await storage.createPlan(goal.id);
      
      try {
        await storage.updateTodoStatus(goal.id, 'non-existent', true);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.message.includes('No todo found with id'));
      }
    });
  });

  describe('File System Integration', () => {
    beforeEach(async () => {
      storage = new Storage(gitRepo);
      await storage.initialize();
    });

    it('should create .planning directory', async () => {
      const planningDir = path.join(gitRepo, '.planning');
      const stats = await fs.stat(planningDir);
      assert.ok(stats.isDirectory());
    });

    it('should create branch-specific JSON files', async () => {
      const goal = await storage.createGoal('Test goal');
      await storage.createPlan(goal.id);
      
      const planningDir = path.join(gitRepo, '.planning');
      const files = await fs.readdir(planningDir);
      
      // Should have main.todos.json or similar based on current branch
      assert.ok(files.some(f => f.endsWith('.todos.json')));
    });

    it('should save and load data correctly', async () => {
      const goal = await storage.createGoal('Test goal');
      await storage.createPlan(goal.id);
      await storage.addTodo(goal.id, { title: 'Test todo', description: 'Test desc', complexity: 5 });
      
      // Create new storage instance to test loading
      const newStorage = new Storage(gitRepo);
      await newStorage.initialize();
      
      const loadedTodos = await newStorage.getAllTodos();
      assert.equal(loadedTodos.length, 1);
      assert.equal(loadedTodos[0].title, 'Test todo');
    });
  });
});
