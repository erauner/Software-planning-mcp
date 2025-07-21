import { v4 as uuidv4 } from 'uuid';
import { RedisStorageClient } from '../redis-client.js';
import { Goal, ImplementationPlan, IStorage, SessionContext, Todo } from '../types.js';

export class RedisStorage implements IStorage {
  private redis: RedisStorageClient;
  private userId: string;
  private sessionId: string;
  private repository: string;
  private branch: string;

  constructor(
    redis: RedisStorageClient,
    context: SessionContext
  ) {
    this.redis = redis;
    this.userId = context.userId;
    this.sessionId = context.sessionId;
    this.repository = context.repository.repoIdentifier;
    this.branch = context.repository.branch;
  }

  private getDataKey(): string {
    return this.redis.userRepoDataKey(this.userId, this.repository, this.branch);
  }

  async initialize(): Promise<void> {
    // Redis doesn't need explicit initialization
    // Data is created on first write
  }

  async save(): Promise<void> {
    // Save is implicit in Redis operations
    // Update last accessed time
    const sessionKey = this.redis.sessionKey(this.userId, this.sessionId);
    const sessionData = await this.redis.get(sessionKey);

    if (sessionData) {
      const session = JSON.parse(sessionData);
      session.lastAccessed = new Date().toISOString();
      await this.redis.set(sessionKey, JSON.stringify(session));
    }
  }

  async getTodos(goalId?: string): Promise<Todo[]> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      return [];
    }

    const storageData = JSON.parse(data);

    if (goalId) {
      const plan = storageData.plans[goalId];
      return plan ? plan.todos : [];
    }

    return Object.values(storageData.plans || {})
      .flatMap((plan: any) => plan.todos || []);
  }

  async addTodo(goalId: string, todo: Omit<Todo, 'id' | 'isComplete' | 'createdAt' | 'updatedAt'>): Promise<Todo> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    let storageData: any = {
      branch: this.branch,
      repository: this.repository,
      goals: {},
      plans: {},
      lastUpdated: null,
    };

    if (data) {
      storageData = JSON.parse(data);
    }

    // Create todo with ID and timestamps
    const newTodo: Todo = {
      id: uuidv4(),
      ...todo,
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Use provided goalId or find/create one
    const activeGoalId = goalId || Object.keys(storageData.goals)[0] || uuidv4();

    if (!storageData.plans[activeGoalId]) {
      storageData.plans[activeGoalId] = {
        goalId: activeGoalId,
        todos: [],
        updatedAt: new Date().toISOString(),
      };
    }

    storageData.plans[activeGoalId].todos.push(newTodo);
    storageData.plans[activeGoalId].updatedAt = new Date().toISOString();
    storageData.lastUpdated = new Date().toISOString();

    await this.redis.set(dataKey, JSON.stringify(storageData));
    return newTodo;
  }

  async updateTodo(id: string, updates: Partial<Todo>): Promise<void> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      throw new Error('No data found for this repository/branch');
    }

    const storageData = JSON.parse(data);

    // Find the todo across all plans
    for (const planId of Object.keys(storageData.plans)) {
      const plan = storageData.plans[planId];
      const todoIndex = plan.todos.findIndex((t: Todo) => t.id === id);

      if (todoIndex !== -1) {
        plan.todos[todoIndex] = {
          ...plan.todos[todoIndex],
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        plan.updatedAt = new Date().toISOString();
        storageData.lastUpdated = new Date().toISOString();

        await this.redis.set(dataKey, JSON.stringify(storageData));
        return;
      }
    }

    throw new Error(`Todo with id ${id} not found`);
  }
  async removeTodo(goalId: string, todoId: string): Promise<void> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      throw new Error('No data found for this repository/branch');
    }

    const storageData = JSON.parse(data);

    // Find and remove the todo from the specific plan
    const plan = storageData.plans[goalId];
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todoIndex = plan.todos.findIndex((t: Todo) => t.id === todoId);

    if (todoIndex !== -1) {
      plan.todos.splice(todoIndex, 1);
      plan.updatedAt = new Date().toISOString();
      storageData.lastUpdated = new Date().toISOString();

      await this.redis.set(dataKey, JSON.stringify(storageData));
      return;
    }

    throw new Error(`Todo with id ${todoId} not found`);
  }

  async setGoal(goal: Goal): Promise<void> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    let storageData: any = {
      branch: this.branch,
      repository: this.repository,
      goals: {},
      plans: {},
      lastUpdated: null,
    };

    if (data) {
      storageData = JSON.parse(data);
    }

    storageData.goals[goal.id] = {
      ...goal,
      repository: this.repository,
      branch: this.branch,
    };
    storageData.lastUpdated = new Date().toISOString();

    await this.redis.set(dataKey, JSON.stringify(storageData));
  }

  async getGoal(id: string): Promise<Goal | null> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      return null;
    }

    const storageData = JSON.parse(data);
    return storageData.goals[id] || null;
  }
  async savePlan(plan: string): Promise<void> {
    // This method converts a plan text into todos and saves them
    const todos = this.formatPlanAsTodos(plan);

    // Find or create a goal ID
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    let storageData: any = {
      branch: this.branch,
      repository: this.repository,
      goals: {},
      plans: {},
      lastUpdated: null,
    };

    if (data) {
      storageData = JSON.parse(data);
    }

    const goalId = Object.keys(storageData.goals)[0] || 'default';

    for (const todo of todos) {
      await this.addTodo(goalId, todo);
    }
  }

  private formatPlanAsTodos(plan: string): Omit<Todo, 'id' | 'isComplete' | 'createdAt' | 'updatedAt'>[] {
    // Simple plan parsing - split by lines and create todos
    const lines = plan.split('\n').filter(line => line.trim());

    return lines.map((line, index) => ({
      title: `Step ${index + 1}`,
      description: line.trim(),
      complexity: 3, // Default complexity
    }));
  }

  async getPlan(goalId: string): Promise<ImplementationPlan | null> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      return null;
    }

    const storageData = JSON.parse(data);
    return storageData.plans[goalId] || null;
  }

  async createGoal(description: string): Promise<Goal> {
    const goal: Goal = {
      id: uuidv4(),
      description,
      createdAt: new Date().toISOString(),
      repository: this.repository,
      branch: this.branch,
    };

    await this.setGoal(goal);
    return goal;
  }

  async createPlan(goalId: string): Promise<ImplementationPlan> {
    const plan: ImplementationPlan = {
      goalId,
      todos: [],
      updatedAt: new Date().toISOString(),
    };

    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    let storageData: any = {
      branch: this.branch,
      repository: this.repository,
      goals: {},
      plans: {},
      lastUpdated: null,
    };

    if (data) {
      storageData = JSON.parse(data);
    }

    storageData.plans[goalId] = plan;
    storageData.lastUpdated = new Date().toISOString();

    await this.redis.set(dataKey, JSON.stringify(storageData));
    return plan;
  }
  async updateTodoStatus(goalId: string, todoId: string, isComplete: boolean): Promise<Todo> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      throw new Error('No data found for this repository/branch');
    }

    const storageData = JSON.parse(data);
    const plan = storageData.plans[goalId];

    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todo = plan.todos.find((t: Todo) => t.id === todoId);
    if (!todo) {
      throw new Error(`No todo found with id ${todoId}`);
    }

    todo.isComplete = isComplete;
    todo.updatedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    storageData.lastUpdated = new Date().toISOString();

    await this.redis.set(dataKey, JSON.stringify(storageData));
    return todo;
  }

  async getGoals(): Promise<Record<string, Goal>> {
    const dataKey = this.getDataKey();
    const data = await this.redis.get(dataKey);

    if (!data) {
      return {};
    }

    const storageData = JSON.parse(data);
    return storageData.goals || {};
  }
}
